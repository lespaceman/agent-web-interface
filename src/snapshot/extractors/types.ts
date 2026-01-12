/**
 * Extractor Types
 *
 * Shared types for all extractors to ensure consistent data flow.
 * These types represent the raw CDP data structures and intermediate
 * representations used during snapshot compilation.
 *
 * @module snapshot/extractors/types
 *
 * CDP Domains:
 * - DOM: getDocument, describeNode, requestChildNodes
 * - Accessibility: getFullAXTree
 * - CSS: getComputedStyleForNode
 */

import type { CdpClient } from '../../cdp/cdp-client.interface.js';
import type { BBox, Viewport, ScreenZone, SnapshotOptions } from '../snapshot.types.js';

// ============================================================================
// Raw CDP Data Types
// ============================================================================

/**
 * Raw DOM node data from CDP DOM.getDocument / DOM.describeNode
 */
export interface RawDomNode {
  /** CDP node ID (ephemeral, changes between calls) */
  nodeId: number;

  /** Backend node ID (stable within session) */
  backendNodeId: number;

  /** Node name (uppercase tag or #text, #comment, etc.) */
  nodeName: string;

  /** DOM node type (1=Element, 3=Text, etc.) */
  nodeType: number;

  /** Node attributes as key-value pairs */
  attributes?: Record<string, string>;

  /** Child node IDs (backendNodeIds) */
  childNodeIds?: number[];

  /** Shadow root type if this node hosts a shadow root */
  shadowRootType?: 'open' | 'closed';

  /** Frame ID if this node is an iframe content document */
  frameId?: string;

  /** Loader ID from the frame at extraction time.
   * Changes on frame navigation. Used for delta computation. */
  loaderId?: string;

  /** Parent node's backendNodeId */
  parentId?: number;

  /** Text content for text nodes */
  nodeValue?: string;

  /**
   * Frame path - backendNodeIds of iframe ancestors (outermost first).
   * Used to scope selectors to the correct frame context.
   */
  framePath?: number[];

  /**
   * Shadow path - backendNodeIds of shadow host ancestors (outermost first).
   * Used to pierce shadow boundaries when finding elements.
   */
  shadowPath?: number[];
}

/**
 * AX property value structure from CDP
 */
export interface AxPropertyValue {
  type: string;
  value?: unknown;
}

/**
 * AX property structure from CDP
 */
export interface AxProperty {
  name: string;
  value: AxPropertyValue;
}

/**
 * Raw accessibility node data from CDP Accessibility.getFullAXTree
 */
export interface RawAxNode {
  /** AX tree node ID */
  nodeId: string;

  /** Corresponding DOM backend node ID (for correlation) */
  backendDOMNodeId?: number;

  /** ARIA role (button, link, textbox, etc.) */
  role?: string;

  /** Computed accessible name */
  name?: string;

  /** AX properties (focusable, checked, expanded, etc.) */
  properties?: AxProperty[];

  /** Whether this node is ignored in the AX tree */
  ignored?: boolean;

  /** Child AX node IDs */
  childIds?: string[];
}

/**
 * Layout and positioning information for a node
 */
export interface NodeLayoutInfo {
  /** Bounding box in viewport coordinates */
  bbox: BBox;

  /** CSS display value */
  display?: string;

  /** CSS visibility value */
  visibility?: string;

  /** Whether the element is visible (computed from display, visibility, size) */
  isVisible: boolean;

  /** Coarse screen position (above/below fold, quadrant) */
  screenZone?: ScreenZone;
}

/**
 * Combined raw data for a single node from all extraction phases
 */
export interface RawNodeData {
  /** Raw DOM node data */
  domNode?: RawDomNode;

  /** Raw AX node data */
  axNode?: RawAxNode;

  /** Layout information */
  layout?: NodeLayoutInfo;

  /** Backend node ID (primary key for correlation) */
  backendNodeId: number;
}

// ============================================================================
// Extractor Context
// ============================================================================

/**
 * Context passed to all extractors for accessing CDP and configuration
 */
export interface ExtractorContext {
  /** CDP client for making protocol calls */
  cdp: CdpClient;

  /** Viewport dimensions */
  viewport: Viewport;

  /** Snapshot options */
  options: Partial<SnapshotOptions>;
}

/**
 * Create an extractor context.
 *
 * @param cdp - CDP client instance
 * @param viewport - Viewport dimensions
 * @param options - Snapshot capture options
 * @returns ExtractorContext
 */
export function createExtractorContext(
  cdp: CdpClient,
  viewport: Viewport,
  options: Partial<SnapshotOptions> = {}
): ExtractorContext {
  return { cdp, viewport, options };
}

// ============================================================================
// Extraction Results
// ============================================================================

/**
 * Result from DOM extractor
 */
export interface DomExtractionResult {
  /** Map of backendNodeId -> RawDomNode */
  nodes: Map<number, RawDomNode>;

  /** Root document backendNodeId */
  rootId: number;

  /** Frame IDs found during extraction */
  frameIds: string[];

  /** BackendNodeIds of shadow roots */
  shadowRoots: number[];
}

/**
 * Result from AX extractor
 */
export interface AxExtractionResult {
  /** Map of backendDOMNodeId -> RawAxNode */
  nodes: Map<number, RawAxNode>;

  /** BackendDOMNodeIds of interactive elements */
  interactiveIds: Set<number>;

  /** BackendDOMNodeIds of readable content elements */
  readableIds: Set<number>;
}

/**
 * Result from layout extractor
 */
export interface LayoutExtractionResult {
  /** Map of backendNodeId -> NodeLayoutInfo */
  layouts: Map<number, NodeLayoutInfo>;
}

// ============================================================================
// Type Validation Helpers
// ============================================================================

/**
 * Validate that an object is a valid RawDomNode.
 *
 * @param node - Object to validate
 * @returns true if valid RawDomNode
 */
export function isValidRawDomNode(node: RawDomNode): boolean {
  if (!node || typeof node !== 'object') {
    return false;
  }

  return (
    typeof node.nodeId === 'number' &&
    typeof node.backendNodeId === 'number' &&
    typeof node.nodeName === 'string' &&
    typeof node.nodeType === 'number'
  );
}

/**
 * Validate that an object is a valid RawAxNode.
 *
 * @param node - Object to validate
 * @returns true if valid RawAxNode
 */
export function isValidRawAxNode(node: RawAxNode): boolean {
  if (!node || typeof node !== 'object') {
    return false;
  }

  return typeof node.nodeId === 'string';
}

/**
 * Validate that an object is a valid NodeLayoutInfo.
 *
 * @param layout - Object to validate
 * @returns true if valid NodeLayoutInfo
 */
export function isValidNodeLayoutInfo(layout: NodeLayoutInfo): boolean {
  if (!layout || typeof layout !== 'object') {
    return false;
  }

  return (
    layout.bbox !== undefined &&
    typeof layout.bbox === 'object' &&
    typeof layout.bbox.x === 'number' &&
    typeof layout.bbox.y === 'number' &&
    typeof layout.bbox.w === 'number' &&
    typeof layout.bbox.h === 'number' &&
    typeof layout.isVisible === 'boolean'
  );
}

// ============================================================================
// Constants
// ============================================================================

/**
 * DOM node types (subset relevant to extraction)
 */
export const DOM_NODE_TYPES = {
  ELEMENT_NODE: 1,
  TEXT_NODE: 3,
  COMMENT_NODE: 8,
  DOCUMENT_NODE: 9,
  DOCUMENT_TYPE_NODE: 10,
  DOCUMENT_FRAGMENT_NODE: 11,
} as const;

/**
 * AX roles that indicate interactive elements
 */
export const INTERACTIVE_AX_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'checkbox',
  'switch',
  'tab',
  'slider',
  'spinbutton',
  'scrollbar',
]);

/**
 * AX roles that indicate readable content
 */
export const READABLE_AX_ROLES = new Set([
  'heading',
  'paragraph',
  'text',
  'statictext',
  'list',
  'listitem',
  'image',
  'figure',
  'table',
  'row',
  'cell',
  'columnheader',
  'rowheader',
]);

/**
 * AX roles that indicate structural/landmark elements
 */
export const STRUCTURAL_AX_ROLES = new Set([
  'banner',
  'navigation',
  'main',
  'complementary',
  'contentinfo',
  'region',
  'form',
  'search',
  'dialog',
  'alertdialog',
  'article',
  'section',
]);
