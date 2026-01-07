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
  NodeAttributes,
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
  type RawNodeData,
  type RawDomNode,
  type RawAxNode,
  type DomExtractionResult,
  type AxExtractionResult,
  type LayoutExtractionResult,
  type ExtractorContext,
} from './extractors/index.js';

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
    list: 'list',
    listitem: 'listitem',
    image: 'image',
    img: 'image',
    figure: 'image',
    table: 'table',
    // Structural
    form: 'form',
    dialog: 'dialog',
    alertdialog: 'dialog',
    navigation: 'navigation',
    region: 'section',
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

  /** Counter for generating unique node IDs within a snapshot */
  private nodeCounter = 0;

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
   * Generate a unique node ID.
   */
  private generateNodeId(): string {
    this.nodeCounter++;
    return `n${this.nodeCounter}`;
  }

  /**
   * Reset node counter for new snapshot.
   */
  private resetNodeCounter(): void {
    this.nodeCounter = 0;
  }

  /**
   * Compile a snapshot from the current page state.
   *
   * @param cdp - CDP client for the page
   * @param page - Playwright Page instance
   * @param _pageId - Page identifier (for logging/tracking)
   * @returns Complete BaseSnapshot
   */
  async compile(
    cdp: CdpClient,
    page: Page,
    _pageId: string
  ): Promise<BaseSnapshot> {
    const startTime = Date.now();
    this.resetNodeCounter();

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    const ctx = createExtractorContext(cdp, viewport, this.options);

    let partial = false;
    const warnings: string[] = [];

    // Phase 1: Parallel extraction of DOM and AX trees
    let domResult: DomExtractionResult | undefined;
    let axResult: AxExtractionResult | undefined;

    try {
      [domResult, axResult] = await Promise.all([
        extractDom(ctx),
        extractAx(ctx).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(`AX extraction failed: ${message}`);
          partial = true;
          return undefined;
        }),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`DOM extraction failed: ${message}`);
      partial = true;
    }

    // Phase 2: Correlate nodes and identify what to include
    const nodesToProcess: RawNodeData[] = [];

    if (axResult) {
      // Build from AX tree (has semantic information)
      for (const [backendNodeId, axNode] of axResult.nodes) {
        const classification = classifyAxRole(axNode.role);
        const isInteractive = classification === 'interactive';
        const isReadable = classification === 'readable' && this.options.includeReadable;

        if (isInteractive || isReadable) {
          const domNode = domResult?.nodes.get(backendNodeId);
          nodesToProcess.push({
            backendNodeId,
            domNode,
            axNode,
          });
        }
      }
    } else if (domResult) {
      // Fallback: Use DOM-only for interactive tags
      for (const [backendNodeId, domNode] of domResult.nodes) {
        const tagName = domNode.nodeName.toUpperCase();
        if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(tagName)) {
          nodesToProcess.push({
            backendNodeId,
            domNode,
          });
        }
      }
    }

    // Limit nodes
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
    const nodes: ReadableNode[] = [];

    for (const nodeData of limitedNodes) {
      const node = this.transformNode(
        nodeData,
        domResult?.nodes ?? new Map<number, RawDomNode>(),
        axResult?.nodes ?? new Map<number, RawAxNode>(),
        limitedNodes
      );

      // Filter by visibility (unless include_hidden)
      if (this.options.include_hidden || node.state?.visible !== false) {
        nodes.push(node);
      }
    }

    // Phase 5: Build BaseSnapshot
    const duration = Date.now() - startTime;
    const interactiveCount = nodes.filter((n) =>
      ['button', 'link', 'input', 'textarea', 'select', 'combobox', 'checkbox', 'radio', 'switch', 'slider', 'tab', 'menuitem'].includes(n.kind)
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
    allNodes: RawNodeData[]
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
    const labelResult = resolveLabel(domNode, axNode);
    const label = labelResult.label;

    // Resolve region
    const region = resolveRegion(domNode, axNode, domTree);

    // Resolve grouping
    const grouping = resolveGrouping(backendNodeId, domTree, axTree, allNodes);

    // Build location
    const where: NodeLocation = {
      region,
      group_id: grouping.group_id,
      group_path: grouping.group_path,
      heading_context: grouping.heading_context,
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

    // Build attributes
    const attributes = this.extractAttributes(domNode, axNode, kind);

    // Build the node
    const node: ReadableNode = {
      node_id: this.generateNodeId(),
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
   * Extract additional attributes for specific node types.
   */
  private extractAttributes(
    domNode: RawDomNode | undefined,
    axNode: RawAxNode | undefined,
    kind: NodeKind
  ): NodeAttributes | undefined {
    const attrs: NodeAttributes = {};
    const domAttrs = domNode?.attributes;

    // Input type
    if (kind === 'input' && domAttrs?.type) {
      attrs.input_type = domAttrs.type;
    }

    // Placeholder
    if (domAttrs?.placeholder) {
      attrs.placeholder = domAttrs.placeholder;
    }

    // Link href
    if (kind === 'link' && domAttrs?.href) {
      attrs.href = domAttrs.href;
    }

    // Image alt and src
    if (kind === 'image') {
      if (domAttrs?.alt) attrs.alt = domAttrs.alt;
      if (domAttrs?.src) {
        // Extract just domain + path
        try {
          const url = new URL(domAttrs.src, 'https://example.com');
          attrs.src = `${url.host}${url.pathname}`;
        } catch {
          attrs.src = domAttrs.src;
        }
      }
    }

    // Heading level
    if (kind === 'heading') {
      const levelProp = axNode?.properties?.find((p) => p.name === 'level');
      if (levelProp?.value?.value) {
        attrs.heading_level = Number(levelProp.value.value);
      } else if (domNode?.nodeName.match(/^H([1-6])$/i)) {
        attrs.heading_level = parseInt(domNode.nodeName.substring(1));
      }
    }

    // Form action and method
    if (kind === 'form') {
      if (domAttrs?.action) attrs.action = domAttrs.action;
      if (domAttrs?.method) attrs.method = domAttrs.method;
    }

    // Autocomplete
    if (domAttrs?.autocomplete) {
      attrs.autocomplete = domAttrs.autocomplete;
    }

    // Test ID
    const testId = domAttrs?.['data-testid'] ?? domAttrs?.['data-test'] ?? domAttrs?.['data-cy'];
    if (testId) {
      attrs.test_id = testId;
    }

    // Role (if explicitly set and different from implied)
    if (domAttrs?.role) {
      attrs.role = domAttrs.role;
    }

    return Object.keys(attrs).length > 0 ? attrs : undefined;
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
