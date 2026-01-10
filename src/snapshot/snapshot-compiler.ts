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

import type { Page } from 'playwright';
import type { CdpClient } from '../cdp/cdp-client.interface.js';
import type {
  BaseSnapshot,
  ReadableNode,
  NodeKind,
  SnapshotOptions,
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
  type RawNodeData,
  type RawDomNode,
  type RawAxNode,
  type DomExtractionResult,
  type AxExtractionResult,
  type LayoutExtractionResult,
  type ExtractorContext,
} from './extractors/index.js';
import { getTextContent } from '../lib/text-utils.js';

/**
 * Adjacency maps for efficient shadow root and content document lookup.
 */
interface AdjacencyMaps {
  /** Maps shadow host backendNodeId -> array of shadow root backendNodeIds */
  shadowRootsByHost: Map<number, number[]>;
  /** Maps iframe backendNodeId -> array of content document backendNodeIds */
  contentDocsByFrame: Map<number, number[]>;
}

type IdMapsByContext = Map<string, Map<string, RawDomNode>>;

const ROOT_CONTEXT = 'root';
const LIGHT_DOM_CONTEXT = 'light';

/**
 * Build a context key based on iframe and shadow ancestry.
 */
function buildContextKey(node: RawDomNode): string {
  const frameKey = node.framePath?.length ? node.framePath.join('/') : ROOT_CONTEXT;
  const shadowKey = node.shadowPath?.length ? node.shadowPath.join('/') : LIGHT_DOM_CONTEXT;
  return `${frameKey}|${shadowKey}`;
}

/**
 * Build context-scoped ID maps to avoid cross-frame/shadow collisions.
 */
function buildIdMapsByContext(domResult: DomExtractionResult): IdMapsByContext {
  const idMaps = new Map<string, Map<string, RawDomNode>>();

  for (const node of domResult.nodes.values()) {
    const id = node.attributes?.id;
    if (!id) continue;

    const contextKey = buildContextKey(node);
    let map = idMaps.get(contextKey);
    if (!map) {
      map = new Map<string, RawDomNode>();
      idMaps.set(contextKey, map);
    }
    map.set(id, node);
  }

  return idMaps;
}

/**
 * Get the ID map scoped to a node's frame/shadow context.
 */
function getIdMapForNode(
  node: RawDomNode | undefined,
  idMapsByContext: IdMapsByContext
): Map<string, RawDomNode> | undefined {
  if (!node) return undefined;
  return idMapsByContext.get(buildContextKey(node));
}

/**
 * Build adjacency maps for shadow roots and iframe content documents.
 * Single O(n) pass through all nodes.
 *
 * @param domResult - DOM extraction result
 * @returns Adjacency maps for shadow roots and content documents
 */
function buildAdjacencyMaps(domResult: DomExtractionResult): AdjacencyMaps {
  const shadowRootsByHost = new Map<number, number[]>();
  const contentDocsByFrame = new Map<number, number[]>();

  for (const [nodeId, node] of domResult.nodes) {
    if (node.parentId === undefined) continue;

    if (node.nodeName === '#document-fragment') {
      // This is a shadow root - add to shadow host's children
      const existing = shadowRootsByHost.get(node.parentId) ?? [];
      existing.push(nodeId);
      shadowRootsByHost.set(node.parentId, existing);
    } else if (node.nodeName === '#document') {
      // This is a content document - add to iframe's children
      const existing = contentDocsByFrame.get(node.parentId) ?? [];
      existing.push(nodeId);
      contentDocsByFrame.set(node.parentId, existing);
    }
  }

  return { shadowRootsByHost, contentDocsByFrame };
}

/**
 * Build DOM pre-order index by traversing the DOM tree.
 * Also traverses into shadow roots and iframe content documents.
 *
 * @param domResult - DOM extraction result with nodes and rootId
 * @param adjacencyMaps - Precomputed maps for shadow roots and content documents
 * @returns Map of backendNodeId -> DOM order index
 */
function buildDomOrderIndex(
  domResult: DomExtractionResult,
  adjacencyMaps: AdjacencyMaps
): Map<number, number> {
  const orderIndex = new Map<number, number>();
  const shadowHostSet = new Set(domResult.shadowRoots);
  let index = 0;

  function traverse(nodeId: number): void {
    const node = domResult.nodes.get(nodeId);
    if (!node) return;

    orderIndex.set(nodeId, index++);

    // 1. Process light DOM children first (pre-order DFS)
    if (node.childNodeIds) {
      for (const childId of node.childNodeIds) {
        traverse(childId);
      }
    }

    // 2. If this node hosts a shadow root, traverse shadow content (O(1) lookup)
    if (shadowHostSet.has(nodeId)) {
      const shadowRoots = adjacencyMaps.shadowRootsByHost.get(nodeId) ?? [];
      for (const shadowRootId of shadowRoots) {
        traverse(shadowRootId);
      }
    }

    // 3. If this node is an iframe, traverse content document (O(1) lookup)
    if (node.frameId || node.nodeName.toUpperCase() === 'IFRAME') {
      const contentDocs = adjacencyMaps.contentDocsByFrame.get(nodeId) ?? [];
      for (const contentDocId of contentDocs) {
        traverse(contentDocId);
      }
    }
  }

  traverse(domResult.rootId);
  return orderIndex;
}

/**
 * Build heading index mapping each backendNodeId to its heading context.
 * Uses DOM order to determine the most recent preceding heading.
 * Also traverses into shadow roots and iframe content documents.
 *
 * Heading context is isolated at iframe boundaries:
 * - Heading from parent document does NOT propagate into iframe
 * - Heading from iframe does NOT propagate back to parent document
 * - Shadow DOM shares heading context with its host document
 *
 * @param domResult - DOM extraction result
 * @param axResult - AX extraction result for heading names
 * @param idMap - Map of DOM ID to RawDomNode for aria-labelledby resolution
 * @param adjacencyMaps - Precomputed maps for shadow roots and content documents
 * @returns Map of backendNodeId -> heading context string
 */
function buildHeadingIndex(
  domResult: DomExtractionResult,
  axResult: AxExtractionResult | undefined,
  idMapsByContext: IdMapsByContext,
  adjacencyMaps: AdjacencyMaps
): Map<number, string> {
  const headingIndex = new Map<number, string>();
  const shadowHostSet = new Set(domResult.shadowRoots);

  // Helper to check if a node is a heading and resolve its name
  function isHeading(backendNodeId: number): { isHeading: boolean; name?: string } {
    const domNode = domResult.nodes.get(backendNodeId);
    const axNode = axResult?.nodes.get(backendNodeId);

    // Check AX role first
    const scopedIdMap = domNode ? getIdMapForNode(domNode, idMapsByContext) : undefined;

    if (axNode?.role === 'heading') {
      // Priority: AX name -> resolveLabel -> DOM text content
      let name = axNode.name;
      if (!name && domNode) {
        const labelResult = resolveLabel(domNode, axNode, scopedIdMap);
        if (labelResult.source !== 'none') {
          name = labelResult.label;
        }
      }
      name ??= getTextContent(backendNodeId, domResult.nodes);
      return { isHeading: true, name };
    }

    // Check DOM tag (H1-H6)
    if (domNode?.nodeName?.match(/^H[1-6]$/i)) {
      // Priority: AX name -> resolveLabel -> DOM text content
      let name = axNode?.name;
      if (!name) {
        const labelResult = resolveLabel(domNode, axNode, scopedIdMap);
        if (labelResult.source !== 'none') {
          name = labelResult.label;
        }
      }
      name ??= getTextContent(backendNodeId, domResult.nodes);
      return { isHeading: true, name };
    }

    return { isHeading: false };
  }

  // Traverse DOM in pre-order, passing and returning heading context
  function traverse(nodeId: number, currentHeading: string | undefined): string | undefined {
    const node = domResult.nodes.get(nodeId);
    if (!node) return currentHeading;

    // Check if this node is a heading
    const headingInfo = isHeading(nodeId);
    if (headingInfo.isHeading && headingInfo.name) {
      currentHeading = headingInfo.name;
    }

    // Record the current heading context for this node
    if (currentHeading) {
      headingIndex.set(nodeId, currentHeading);
    }

    // 1. Process light DOM children first (pre-order DFS)
    // Heading context propagates and updates through light DOM
    if (node.childNodeIds) {
      for (const childId of node.childNodeIds) {
        currentHeading = traverse(childId, currentHeading) ?? currentHeading;
      }
    }

    // 2. If this node hosts a shadow root, traverse shadow content (O(1) lookup)
    // Shadow DOM shares heading context with host document (same logical document)
    if (shadowHostSet.has(nodeId)) {
      const shadowRoots = adjacencyMaps.shadowRootsByHost.get(nodeId) ?? [];
      for (const shadowRootId of shadowRoots) {
        currentHeading = traverse(shadowRootId, currentHeading) ?? currentHeading;
      }
    }

    // 3. If this node is an iframe, traverse content document (O(1) lookup)
    // IMPORTANT: Heading context resets at iframe boundary (separate document)
    // - Pass undefined to reset context inside iframe
    // - Discard returned heading (iframe headings don't affect parent)
    if (node.frameId || node.nodeName.toUpperCase() === 'IFRAME') {
      const contentDocs = adjacencyMaps.contentDocsByFrame.get(nodeId) ?? [];
      for (const contentDocId of contentDocs) {
        traverse(contentDocId, undefined);
      }
    }

    return currentHeading;
  }

  traverse(domResult.rootId, undefined);
  return headingIndex;
}

/**
 * Snapshot compiler options
 */
export interface CompileOptions extends Partial<SnapshotOptions> {
  /** Include readable content nodes (headings, paragraphs). Default: true */
  includeReadable?: boolean;
  /** Extract bounding boxes and layout info. Default: true */
  includeLayout?: boolean;
}

/**
 * Default compile options
 */
const DEFAULT_OPTIONS: Required<CompileOptions> = {
  include_hidden: false,
  max_nodes: 2000,
  timeout: 30000,
  redact_sensitive: true,
  include_values: false,
  includeReadable: true,
  includeLayout: true,
};

/**
 * Map AX role to NodeKind.
 */
function mapRoleToKind(role: string | undefined): NodeKind | undefined {
  if (!role) return undefined;

  const normalized = role.toLowerCase();
  const kindMap: Record<string, NodeKind> = {
    // Interactive
    button: 'button',
    link: 'link',
    textbox: 'input',
    searchbox: 'input',
    combobox: 'combobox',
    listbox: 'select',
    checkbox: 'checkbox',
    radio: 'radio',
    switch: 'switch',
    slider: 'slider',
    spinbutton: 'slider',
    tab: 'tab',
    menuitem: 'menuitem',
    menuitemcheckbox: 'menuitem',
    menuitemradio: 'menuitem',
    option: 'menuitem',
    // Readable
    heading: 'heading',
    paragraph: 'paragraph',
    text: 'text',
    statictext: 'text',
    list: 'list',
    listitem: 'listitem',
    tree: 'list',
    treeitem: 'listitem',
    image: 'image',
    img: 'image',
    figure: 'image',
    table: 'table',
    grid: 'table',
    treegrid: 'table',
    // Structural
    form: 'form',
    dialog: 'dialog',
    alertdialog: 'dialog',
    navigation: 'navigation',
    region: 'section',
    article: 'section',
    main: 'section',
    banner: 'section',
    complementary: 'section',
    contentinfo: 'section',
  };

  return kindMap[normalized];
}

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
   * @param page - Playwright Page instance
   * @param _pageId - Page identifier (for logging/tracking)
   * @returns Complete BaseSnapshot
   */
  async compile(cdp: CdpClient, page: Page, _pageId: string): Promise<BaseSnapshot> {
    const startTime = Date.now();

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    const ctx = createExtractorContext(cdp, viewport, this.options);

    let partial = false;
    const warnings: string[] = [];

    // Phase 1: Parallel extraction of DOM and AX trees
    let domResult: DomExtractionResult | undefined;
    let axResult: AxExtractionResult | undefined;
    let domOrderAvailable = false;

    try {
      [domResult, axResult] = await Promise.all([
        extractDom(ctx).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(`DOM extraction failed: ${message}`);
          partial = true;
          return undefined;
        }),
        extractAx(ctx).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(`AX extraction failed: ${message}`);
          partial = true;
          return undefined;
        }),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Extraction failed: ${message}`);
      partial = true;
    }

    const idMapsByContext: IdMapsByContext = domResult
      ? buildIdMapsByContext(domResult)
      : new Map<string, Map<string, RawDomNode>>();

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

        if (isInteractive || isReadable || isEssentialStructural) {
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
        if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'FORM', 'DIALOG'].includes(tagName)) {
          nodesToProcess.push({
            backendNodeId,
            domNode,
          });
        }
      }
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

    // Limit nodes (now respects DOM order)
    const limitedNodes = nodesToProcess.slice(0, this.options.max_nodes);

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
        headingIndex
      );

      // Filter by visibility (unless include_hidden)
      if (this.options.include_hidden || node.state?.visible !== false) {
        transformedNodes.push(node);
      }
    }

    // Phase 4.5: Filter noise nodes (empty containers, duplicate text)
    const nodes = this.filterNoiseNodes(
      transformedNodes,
      domResult?.nodes ?? new Map<number, RawDomNode>(),
      axResult?.nodes ?? new Map<number, RawAxNode>()
    );

    // Phase 5: Build BaseSnapshot
    const duration = Date.now() - startTime;
    const interactiveCount = nodes.filter((n) =>
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
      ].includes(n.kind)
    ).length;

    const meta: SnapshotMeta = {
      node_count: nodes.length,
      interactive_count: interactiveCount,
      capture_duration_ms: duration,
    };

    if (partial) {
      meta.partial = true;
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
    headingIndex?: Map<number, string>
  ): ReadableNode {
    const { domNode, axNode, layout, backendNodeId } = nodeData;

    // Determine kind
    let kind: NodeKind = 'generic';
    if (axNode?.role) {
      kind = mapRoleToKind(axNode.role) ?? 'generic';
    } else if (domNode) {
      const tagKind = this.getKindFromTag(domNode.nodeName);
      if (tagKind) kind = tagKind;
    }

    // Resolve label
    const scopedIdMap = getIdMapForNode(domNode, idMapsByContext);
    const labelResult = resolveLabel(domNode, axNode, scopedIdMap);
    const label = labelResult.label;

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

    return node;
  }

  /**
   * Get NodeKind from HTML tag name.
   */
  private getKindFromTag(tagName: string): NodeKind | undefined {
    const tag = tagName.toUpperCase();
    const tagMap: Record<string, NodeKind> = {
      BUTTON: 'button',
      A: 'link',
      INPUT: 'input',
      TEXTAREA: 'textarea',
      SELECT: 'select',
      H1: 'heading',
      H2: 'heading',
      H3: 'heading',
      H4: 'heading',
      H5: 'heading',
      H6: 'heading',
      P: 'paragraph',
      IMG: 'image',
      TABLE: 'table',
      UL: 'list',
      OL: 'list',
      LI: 'listitem',
      FORM: 'form',
      DIALOG: 'dialog',
      NAV: 'navigation',
    };
    return tagMap[tag];
  }

  /**
   * Filter out noise nodes to reduce snapshot size.
   *
   * Filters:
   * 1. Empty list/listitem containers with no semantic name AND no interactive descendants
   * 2. StaticText/text nodes that mirror their parent's label exactly
   */
  private filterNoiseNodes(
    nodes: ReadableNode[],
    domTree: Map<number, RawDomNode>,
    axTree: Map<number, RawAxNode>
  ): ReadableNode[] {
    // Build set of interactive node backend IDs for descendant checking
    const interactiveKinds = new Set([
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
    ]);
    const interactiveBackendIds = new Set(
      nodes.filter((n) => interactiveKinds.has(n.kind)).map((n) => n.backend_node_id)
    );

    // Build parent-child relationship from DOM tree
    const childToParent = new Map<number, number>();
    for (const [nodeId, domNode] of domTree) {
      if (domNode.parentId !== undefined) {
        childToParent.set(nodeId, domNode.parentId);
      }
    }

    // Check if a node has any interactive descendants in the DOM tree
    const hasInteractiveDescendant = (nodeId: number): boolean => {
      const domNode = domTree.get(nodeId);
      if (!domNode) return false;

      // Check direct children
      if (domNode.childNodeIds) {
        for (const childId of domNode.childNodeIds) {
          if (interactiveBackendIds.has(childId)) {
            return true;
          }
          if (hasInteractiveDescendant(childId)) {
            return true;
          }
        }
      }
      return false;
    };

    // Get label of parent node in the node list
    const getParentLabel = (nodeId: number): string | undefined => {
      const parentId = childToParent.get(nodeId);
      if (parentId === undefined) return undefined;

      // Look up parent in our node list
      const parentNode = nodes.find((n) => n.backend_node_id === parentId);
      if (parentNode) {
        return parentNode.label;
      }

      // Parent might be further up - check AX tree for parent's name
      const parentAx = axTree.get(parentId);
      return parentAx?.name;
    };

    // Container kinds that can be noisy when empty
    const containerKinds = new Set(['list', 'listitem']);

    // Text kinds that can duplicate parent labels
    const textKinds = new Set(['text']);

    return nodes.filter((node) => {
      // Rule 1: Filter empty container nodes without interactive descendants
      if (containerKinds.has(node.kind)) {
        const hasSemanticName = node.label && node.label.trim().length > 0;
        if (!hasSemanticName) {
          const hasInteractive = hasInteractiveDescendant(node.backend_node_id);
          if (!hasInteractive) {
            return false; // Filter out empty container without interactive content
          }
        }
      }

      // Rule 2: Filter text nodes that mirror parent's label
      if (textKinds.has(node.kind)) {
        const parentLabel = getParentLabel(node.backend_node_id);
        if (parentLabel && node.label) {
          // Normalize and compare
          const normalizedParent = parentLabel.trim().toLowerCase();
          const normalizedNode = node.label.trim().toLowerCase();
          if (normalizedNode === normalizedParent) {
            return false; // Filter out duplicate text
          }
        }
      }

      return true; // Keep the node
    });
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
