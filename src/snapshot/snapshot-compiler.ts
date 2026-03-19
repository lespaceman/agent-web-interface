/**
 * Snapshot Compiler
 *
 * Orchestrates all extractors to produce a complete BaseSnapshot.
 *
 * @module snapshot/snapshot-compiler
 *
 * CDP Domains Required:
 * - DOM: Document structure
 * - Accessibility: Semantic information
 * - CSS: Computed styles (optional, for layout)
 */

import type { Page } from 'puppeteer-core';
import type { CdpClient } from '../cdp/cdp-client.interface.js';
import type {
  BaseSnapshot,
  ReadableNode,
  NodeKind,
  SnapshotMeta,
  NodeLocation,
  NodeLayout,
  NodeState,
  NodeLocators,
} from './snapshot.types.js';
import {
  createExtractorContext,
  extractDom,
  extractAx,
  extractLayout,
  extractState,
  resolveLabel,
  resolveRegion,
  buildLocators,
  resolveGrouping,
  classifyAxRole,
  extractAttributes,
  LIVE_REGION_AX_ROLES,
  type RawNodeData,
  type RawDomNode,
  type RawAxNode,
  type DomExtractionResult,
  type AxExtractionResult,
  type LayoutExtractionResult,
  type ExtractorContext,
} from './extractors/index.js';
import { detectInteractivity } from './extractors/interactivity-detector.js';
import type { InteractivitySignals } from './extractors/types.js';
import { getTextContent } from '../lib/text-utils.js';
import {
  buildIdMapsByContext,
  getIdMapForNode,
  buildAdjacencyMaps,
  buildDomOrderIndex,
  collectFrameLoaderIds,
  type IdMapsByContext,
  type FrameLoaderInfo,
} from './frame-context.js';
import { buildHeadingIndex } from './heading-index.js';
import {
  synthesizeOptionNodes,
  synthesizeCanvasNodes,
  promoteToastNodes,
} from './node-synthesizer.js';
import { filterNoiseNodes, sliceWithOverlayPriority } from './node-filter.js';
import {
  mapRoleToKind,
  getKindFromTag,
  DEFAULT_OPTIONS,
  type CompileOptions,
} from './kind-mapping.js';

/**
 * SnapshotCompiler class
 *
 * Orchestrates the extraction and compilation of page snapshots.
 */
export class SnapshotCompiler {
  private readonly options: Required<CompileOptions>;

  /** Counter for generating unique snapshot IDs */
  private snapshotCounter = 0;

  constructor(options?: Partial<CompileOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate a unique snapshot ID.
   */
  private generateSnapshotId(): string {
    this.snapshotCounter++;
    return `snap-${Date.now()}-${this.snapshotCounter}`;
  }

  /**
   * Compile a snapshot from the current page state.
   *
   * @param cdp - CDP client for the page
   * @param page - Puppeteer Page instance
   * @param _pageId - Page identifier (for logging/tracking)
   * @returns Complete BaseSnapshot
   */
  async compile(cdp: CdpClient, page: Page, _pageId: string): Promise<BaseSnapshot> {
    const startTime = Date.now();

    // Get viewport - prefer page.viewport() but fall back to CDP layout metrics
    // for external browsers where no viewport is explicitly set
    let viewport = page.viewport();
    let viewportFallbackError: string | undefined;
    if (!viewport) {
      try {
        const metrics = await cdp.send('Page.getLayoutMetrics', undefined);
        // Use cssLayoutViewport which gives CSS pixels (not device pixels)
        const cssViewport = metrics.cssLayoutViewport;
        viewport = {
          width: Math.round(cssViewport.clientWidth),
          height: Math.round(cssViewport.clientHeight),
        };
      } catch (err) {
        // Fall back to common desktop viewport if CDP call fails (e.g., target closed, permissions)
        viewport = { width: 1280, height: 720 };
        viewportFallbackError = err instanceof Error ? err.message : String(err);
      }
    }
    const ctx = createExtractorContext(cdp, viewport, this.options);

    let partial = false;
    const warnings: string[] = [];

    // Add viewport fallback warning if CDP detection failed
    if (viewportFallbackError) {
      warnings.push(`Viewport detection failed, using fallback 1280x720: ${viewportFallbackError}`);
    }

    // Phase 1: Extract DOM first to discover frame IDs, then AX with frame context
    let domResult: DomExtractionResult | undefined;
    let axResult: AxExtractionResult | undefined;
    let domOrderAvailable = false;

    // Step 1: Extract DOM tree (discovers iframes and their frame IDs)
    try {
      domResult = await extractDom(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`DOM extraction failed: ${message}`);
      partial = true;
    }

    // Step 2: Extract AX tree with discovered frame IDs for multi-frame support
    // This enables accessibility extraction from iframes (e.g., cookie consent popups)
    try {
      const iframeFrameIds = domResult?.frameIds ?? [];
      axResult = await extractAx(ctx, iframeFrameIds);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`AX extraction failed: ${message}`);
      partial = true;
    }

    const idMapsByContext: IdMapsByContext = domResult
      ? buildIdMapsByContext(domResult)
      : new Map<string, Map<string, RawDomNode>>();

    // Query frame tree for loader IDs (needed for delta computation)
    const frameLoaderIds = new Map<string, FrameLoaderInfo>();
    let mainFrameId: string | undefined;
    let hasUnknownFrames = false;

    try {
      const frameTreeResult = await cdp.send('Page.getFrameTree', undefined);
      collectFrameLoaderIds(frameTreeResult.frameTree, frameLoaderIds);

      // Find main frame ID
      for (const [frameId, info] of frameLoaderIds) {
        if (info.isMainFrame) {
          mainFrameId = frameId;
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Frame tree query failed: ${message}`);
      hasUnknownFrames = true;
    }

    // Build DOM order index for deterministic ordering
    let domOrderIndex: Map<number, number> | undefined;
    let headingIndex: Map<number, string> | undefined;

    if (domResult) {
      const adjacencyMaps = buildAdjacencyMaps(domResult);
      domOrderIndex = buildDomOrderIndex(domResult, adjacencyMaps);
      headingIndex = buildHeadingIndex(domResult, axResult, idMapsByContext, adjacencyMaps);
      domOrderAvailable = true;
    } else {
      // Add warning about DOM order fallback
      warnings.push('DOM order unavailable; using AX order');
    }

    // Phase 2: Correlate nodes and identify what to include
    const nodesToProcess: RawNodeData[] = [];

    // Structural roles that must be included for FactPack features
    // (form detection, dialog detection)
    const essentialStructuralRoles = new Set(['form', 'dialog', 'alertdialog']);

    if (axResult) {
      // Build from AX tree (has semantic information)
      for (const [backendNodeId, axNode] of axResult.nodes) {
        const classification = classifyAxRole(axNode.role);
        const isInteractive = classification === 'interactive';
        const isReadable = classification === 'readable' && this.options.includeReadable;
        const isEssentialStructural =
          classification === 'structural' &&
          essentialStructuralRoles.has(axNode.role?.toLowerCase() ?? '');
        // Live region roles (alert, status, log, tooltip, progressbar, timer)
        // are always included — they carry critical action feedback
        const isLiveRegion = classification === 'live';

        if (isInteractive || isReadable || isEssentialStructural || isLiveRegion) {
          const domNode = domResult?.nodes.get(backendNodeId);
          nodesToProcess.push({
            backendNodeId,
            domNode,
            axNode,
          });
        }
      }
    } else if (domResult) {
      // Fallback: Use DOM-only for interactive tags and essential structural elements
      for (const [backendNodeId, domNode] of domResult.nodes) {
        const tagName = domNode.nodeName.toUpperCase();
        if (
          ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'FORM', 'DIALOG', 'CANVAS'].includes(
            tagName
          )
        ) {
          nodesToProcess.push({
            backendNodeId,
            domNode,
          });
        }
      }
    }

    // Phase 2.1-2.3: Synthesize missing nodes from DOM
    if (domResult) {
      synthesizeOptionNodes(nodesToProcess, domResult);
      synthesizeCanvasNodes(nodesToProcess, domResult);
      promoteToastNodes(nodesToProcess, domResult);
    }

    // Sort by DOM order if available (before max_nodes slicing)
    if (domOrderAvailable && domOrderIndex) {
      const orderMap = domOrderIndex; // Capture for closure to avoid reassignment issues
      nodesToProcess.sort((a, b) => {
        const orderA = orderMap.get(a.backendNodeId);
        const orderB = orderMap.get(b.backendNodeId);
        // If missing from DOM order index (detached/cross-origin), place after ordered nodes
        if (orderA === undefined && orderB === undefined) return 0;
        if (orderA === undefined) return 1;
        if (orderB === undefined) return -1;
        return orderA - orderB;
      });
    }

    // Phase 2.5: Detect implicit interactivity on non-interactive nodes
    // Also check unincluded AX nodes with unknown classification for interactivity
    const nonInteractiveIds: number[] = [];
    const interactiveKindSet = new Set([
      'button',
      'link',
      'input',
      'textarea',
      'select',
      'combobox',
      'checkbox',
      'radio',
      'switch',
      'slider',
      'tab',
      'menuitem',
      'canvas',
    ]);

    // Collect non-interactive nodes already in nodesToProcess (Case A)
    for (const nodeData of nodesToProcess) {
      const kind = nodeData.axNode?.role
        ? (mapRoleToKind(nodeData.axNode.role) ?? 'generic')
        : 'generic';
      if (!interactiveKindSet.has(kind)) {
        nonInteractiveIds.push(nodeData.backendNodeId);
      }
    }

    // Collect unknown-classification AX nodes NOT yet in nodesToProcess (Case B)
    // Cap candidates to bound worst-case CDP call volume on complex pages
    const MAX_CASE_B_CANDIDATES = 200;
    const alreadyIncluded = new Set(nodesToProcess.map((n) => n.backendNodeId));
    const caseB_candidates: number[] = [];
    if (axResult) {
      for (const [backendNodeId, axNode] of axResult.nodes) {
        if (alreadyIncluded.has(backendNodeId)) continue;
        if (caseB_candidates.length >= MAX_CASE_B_CANDIDATES) break;
        const classification = classifyAxRole(axNode.role);
        if (classification === 'unknown') {
          caseB_candidates.push(backendNodeId);
        }
      }
    }

    // Run interactivity detection on both sets
    let interactivityMap = new Map<number, InteractivitySignals>();
    const allCandidates = [...nonInteractiveIds, ...caseB_candidates];
    if (allCandidates.length > 0 && domResult) {
      try {
        interactivityMap = await detectInteractivity(ctx, allCandidates, domResult.nodes);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Interactivity detection failed: ${message}`);
      }
    }

    // Merge interactivity signals into existing nodes (Case A)
    for (const nodeData of nodesToProcess) {
      const signals = interactivityMap.get(nodeData.backendNodeId);
      if (signals) {
        nodeData.interactivity = signals;
      }
    }

    // Add newly discovered interactive nodes (Case B)
    for (const backendNodeId of caseB_candidates) {
      const signals = interactivityMap.get(backendNodeId);
      if (signals) {
        const domNode = domResult?.nodes.get(backendNodeId);
        const axNode = axResult?.nodes.get(backendNodeId);
        nodesToProcess.push({
          backendNodeId,
          domNode,
          axNode,
          interactivity: signals,
        });
      }
    }

    // Re-sort if we added Case B nodes (they need to be in DOM order)
    if (caseB_candidates.some((id) => interactivityMap.has(id))) {
      if (domOrderAvailable && domOrderIndex) {
        const orderMap = domOrderIndex;
        nodesToProcess.sort((a, b) => {
          const orderA = orderMap.get(a.backendNodeId);
          const orderB = orderMap.get(b.backendNodeId);
          if (orderA === undefined && orderB === undefined) return 0;
          if (orderA === undefined) return 1;
          if (orderB === undefined) return -1;
          return orderA - orderB;
        });
      }
    }

    // Limit nodes (now respects DOM order and preserves overlay content)
    const limitedNodes = sliceWithOverlayPriority(nodesToProcess, this.options.max_nodes);

    // Phase 3: Layout extraction (batched)
    let layoutResult: LayoutExtractionResult | undefined;
    if (this.options.includeLayout && limitedNodes.length > 0) {
      const nodeIds = limitedNodes.map((n) => n.backendNodeId);
      layoutResult = await this.extractLayoutSafe(ctx, nodeIds, domResult?.nodes, warnings);
    }

    // Merge layout into node data
    if (layoutResult) {
      for (const nodeData of limitedNodes) {
        nodeData.layout = layoutResult.layouts.get(nodeData.backendNodeId);
      }
    }

    // Phase 4: Transform to ReadableNode[]
    const transformedNodes: ReadableNode[] = [];

    for (const nodeData of limitedNodes) {
      const node = this.transformNode(
        nodeData,
        domResult?.nodes ?? new Map<number, RawDomNode>(),
        axResult?.nodes ?? new Map<number, RawAxNode>(),
        limitedNodes,
        idMapsByContext,
        headingIndex,
        frameLoaderIds,
        mainFrameId
      );

      // Track if any node has unknown frame (loader_id lookup failed)
      if (!node.loader_id) {
        hasUnknownFrames = true;
      }

      // Filter by visibility (unless include_hidden)
      // Option nodes bypass the visibility filter because their bounding boxes
      // are always zero (OS-rendered dropdown content, not CSS-rendered).
      const isOptionNode = nodeData.domNode?.nodeName?.toUpperCase() === 'OPTION';
      if (isOptionNode && node.state?.visible === false) {
        node.state.visible = true;
      }
      if (this.options.include_hidden || node.state?.visible !== false || isOptionNode) {
        transformedNodes.push(node);
      }
    }

    // Phase 4.5: Filter noise nodes (empty containers, duplicate text)
    const nodes = filterNoiseNodes(
      transformedNodes,
      domResult?.nodes ?? new Map<number, RawDomNode>(),
      axResult?.nodes ?? new Map<number, RawAxNode>()
    );

    // Phase 5: Build BaseSnapshot
    const duration = Date.now() - startTime;
    const interactiveCount = nodes.filter(
      (n) =>
        [
          'button',
          'link',
          'input',
          'textarea',
          'select',
          'combobox',
          'checkbox',
          'radio',
          'switch',
          'slider',
          'tab',
          'menuitem',
          'canvas',
        ].includes(n.kind) || n.implicitly_interactive
    ).length;

    const meta: SnapshotMeta = {
      node_count: nodes.length,
      interactive_count: interactiveCount,
      capture_duration_ms: duration,
    };

    if (partial) {
      meta.partial = true;
    }

    if (hasUnknownFrames) {
      warnings.push('Some nodes have unknown frame loaderIds; delta computation may be unreliable');
    }

    if (warnings.length > 0) {
      meta.warnings = warnings;
    }

    return {
      snapshot_id: this.generateSnapshotId(),
      url: page.url(),
      title: await page.title(),
      captured_at: new Date().toISOString(),
      viewport,
      nodes,
      meta,
    };
  }

  /**
   * Extract layout with error handling.
   */
  private async extractLayoutSafe(
    ctx: ExtractorContext,
    nodeIds: number[],
    domNodes: Map<number, RawDomNode> | undefined,
    warnings: string[]
  ): Promise<LayoutExtractionResult | undefined> {
    try {
      return await extractLayout(ctx, nodeIds, domNodes);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Layout extraction failed: ${message}`);
      return undefined;
    }
  }

  /**
   * Transform raw node data to ReadableNode.
   */
  private transformNode(
    nodeData: RawNodeData,
    domTree: Map<number, RawDomNode>,
    axTree: Map<number, RawAxNode>,
    allNodes: RawNodeData[],
    idMapsByContext: IdMapsByContext,
    headingIndex: Map<number, string> | undefined,
    frameLoaderIds: Map<string, FrameLoaderInfo>,
    mainFrameId: string | undefined
  ): ReadableNode {
    const { domNode, axNode, layout, backendNodeId } = nodeData;

    // Determine frame_id and loader_id for this node
    // If domNode has frameId, use it; otherwise default to mainFrameId
    const nodeFrameId = domNode?.frameId ?? mainFrameId ?? 'unknown';
    const frameInfo = frameLoaderIds.get(nodeFrameId);
    const frameId = frameInfo?.frameId ?? nodeFrameId;
    const loaderId = frameInfo?.loaderId ?? '';

    // Determine kind
    let kind: NodeKind = 'generic';
    if (axNode?.role) {
      kind = mapRoleToKind(axNode.role) ?? 'generic';
    } else if (domNode) {
      const tagKind = getKindFromTag(domNode.nodeName);
      if (tagKind) kind = tagKind;
    }

    // Resolve label
    const scopedIdMap = getIdMapForNode(domNode, idMapsByContext);
    const labelResult = resolveLabel(domNode, axNode, scopedIdMap);
    let label = labelResult.label;

    // Fallback for live region containers (alert, status, etc.) with empty labels:
    // Their text typically lives in child StaticText/text nodes, not in the AX name.
    if (
      !label &&
      axNode?.role &&
      LIVE_REGION_AX_ROLES.has(axNode.role.toLowerCase()) &&
      domTree.size > 0
    ) {
      label = getTextContent(backendNodeId, domTree, 3) ?? '';
    }

    // Resolve region (pass axTree for ancestor AX role lookup)
    const region = resolveRegion(domNode, axNode, domTree, axTree);

    // Resolve grouping (for group_id and group_path only)
    const grouping = resolveGrouping(backendNodeId, domTree, axTree, allNodes, {
      includeHeadingContext: !headingIndex,
    });

    // Get heading context from pre-computed heading index (DOM order-based)
    // Fall back to grouping's heading_context if headingIndex not available
    const headingContext = headingIndex
      ? headingIndex.get(backendNodeId)
      : grouping.heading_context;

    // Build location
    const where: NodeLocation = {
      region,
      group_id: grouping.group_id,
      group_path: grouping.group_path,
      heading_context: headingContext,
    };

    // Build layout
    const nodeLayout: NodeLayout = layout
      ? {
          bbox: layout.bbox,
          display: layout.display,
          screen_zone: layout.screenZone,
          zIndex: layout.zIndex,
        }
      : {
          bbox: { x: 0, y: 0, w: 0, h: 0 },
        };

    // Extract state
    const state: NodeState = extractState(domNode, axNode, layout);

    // Build locators
    const locators: NodeLocators = buildLocators(domNode, axNode, label);

    // Build attributes using extractor module
    const attributes = extractAttributes(
      domNode,
      kind,
      {
        includeValues: this.options.include_values,
        redactSensitive: this.options.redact_sensitive,
        sanitizeUrls: true,
      },
      axNode
    );

    // Build the node - node_id is derived from backend_node_id for stability across snapshots
    const node: ReadableNode = {
      node_id: String(backendNodeId),
      backend_node_id: backendNodeId,
      frame_id: frameId,
      loader_id: loaderId,
      kind,
      label,
      where,
      layout: nodeLayout,
      find: locators,
    };

    // Add optional fields
    if (Object.keys(state).length > 0) {
      node.state = state;
    }

    if (attributes && Object.keys(attributes).length > 0) {
      node.attributes = attributes;
    }

    // Set implicitly_interactive flag
    if (nodeData.interactivity) {
      const { has_click_listener, has_cursor_pointer, has_tabindex } = nodeData.interactivity;
      if (has_click_listener || has_cursor_pointer || has_tabindex) {
        node.implicitly_interactive = true;
      }
    }

    return node;
  }
}

/**
 * Export a compile function for simpler usage.
 */
export async function compileSnapshot(
  cdp: CdpClient,
  page: Page,
  pageId: string,
  options?: Partial<CompileOptions>
): Promise<BaseSnapshot> {
  const compiler = new SnapshotCompiler(options);
  return compiler.compile(cdp, page, pageId);
}
