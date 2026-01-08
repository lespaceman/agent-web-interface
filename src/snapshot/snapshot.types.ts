/**
 * BaseSnapshot Types
 *
 * Canonical semantic representation of a web page.
 * Designed to be:
 * - Compact: No raw HTML, no class soup
 * - Semantic: Preserves meaning, order, hierarchy
 * - Actionable: Interactive elements have stable locators
 * - Token-efficient: Suitable for LLM context
 */

import { BBox } from '../shared/types/base.types.js';

// Re-export BBox as BoundingBox for semantic clarity in this module
export type { BBox };
export type BoundingBox = BBox;

// ============================================================================
// Core Snapshot Types
// ============================================================================

/**
 * Canonical snapshot of a web page.
 * Single source of truth for page state at a point in time.
 */
export interface BaseSnapshot {
  /** Unique identifier for this snapshot */
  snapshot_id: string;

  /** Page URL at capture time */
  url: string;

  /** Page title */
  title: string;

  /** Document language (from <html lang="...">) */
  language?: string;

  /** ISO 8601 timestamp of capture */
  captured_at: string;

  /** Viewport dimensions at capture time */
  viewport: Viewport;

  /** Ordered list of semantic nodes (preserves visual/DOM order) */
  nodes: ReadableNode[];

  /** Metadata about the snapshot */
  meta: SnapshotMeta;
}

/**
 * Viewport dimensions
 */
export interface Viewport {
  width: number;
  height: number;
}

/**
 * Snapshot metadata
 */
export interface SnapshotMeta {
  /** True if snapshot is incomplete (e.g., timeout, cross-origin frames) */
  partial?: boolean;

  /** Warnings encountered during capture */
  warnings?: string[];

  /** Total node count in snapshot */
  node_count: number;

  /** Count of interactive nodes */
  interactive_count: number;

  /** Capture duration in milliseconds */
  capture_duration_ms?: number;
}

// ============================================================================
// Node Types
// ============================================================================

/**
 * Semantic node representation.
 * Captures essential information for both reading and interaction.
 */
export interface ReadableNode {
  /** Unique identifier within snapshot (e.g., "n1", "n2") */
  node_id: string;

  /** CDP backend node ID - stable within session, guaranteed unique per DOM element.
   * Used for direct CDP interactions to avoid Playwright locator ambiguity. */
  backend_node_id: number;

  /** Semantic classification */
  kind: NodeKind;

  /** Human-readable label (accessible name, text content, placeholder, etc.) */
  label: string;

  /** Semantic location within page */
  where: NodeLocation;

  /** Layout/positioning information */
  layout: NodeLayout;

  /** State for interactive elements */
  state?: NodeState;

  /** Locator strategies for finding/acting on this element */
  find?: NodeLocators;

  /** Additional attributes for specific node types */
  attributes?: NodeAttributes;
}

/**
 * Semantic node classification.
 * Covers interactive elements and readable content.
 */
export type NodeKind =
  // Interactive elements
  | 'link'
  | 'button'
  | 'input'
  | 'textarea'
  | 'select'
  | 'combobox'
  | 'checkbox'
  | 'radio'
  | 'switch'
  | 'slider'
  | 'tab'
  | 'menuitem'
  // Readable content
  | 'heading'
  | 'paragraph'
  | 'text'
  | 'list'
  | 'listitem'
  | 'image'
  | 'media'
  | 'table'
  // Structural
  | 'form'
  | 'dialog'
  | 'navigation'
  | 'section'
  // Fallback
  | 'generic';

/**
 * Semantic region classification.
 * Based on ARIA landmarks and common page structure.
 */
export type SemanticRegion =
  | 'header'
  | 'nav'
  | 'main'
  | 'aside'
  | 'footer'
  | 'dialog'
  | 'search'
  | 'form'
  | 'contentinfo'
  | 'unknown';

/**
 * Semantic location within the page.
 */
export interface NodeLocation {
  /** Page region (header, nav, main, footer, etc.) */
  region: SemanticRegion;

  /** Group identifier (section/menu/card/form cluster) */
  group_id?: string;

  /** Hierarchy path for nested elements (e.g., ["Men", "Shoes", "Running"]) */
  group_path?: string[];

  /** Nearest heading context */
  heading_context?: string;
}

/**
 * Layout and positioning information.
 */
export interface NodeLayout {
  /** Bounding box in viewport coordinates */
  bbox: BoundingBox;

  /** CSS display value */
  display?: string;

  /** CSS position value */
  positioning?: string;

  /** Container flow direction (row/column for flex, etc.) */
  flow?: 'row' | 'column' | 'grid' | 'block' | 'inline';

  /** Coarse screen position */
  screen_zone?: ScreenZone;
}

/**
 * Coarse screen zone (for spatial reasoning).
 */
export type ScreenZone =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'above-fold'
  | 'below-fold';

/**
 * State for interactive elements.
 */
export interface NodeState {
  /** Element is visible (not hidden, not zero-size) */
  visible: boolean;

  /** Element is enabled (not disabled, not aria-disabled) */
  enabled: boolean;

  /** Checked state for checkboxes/radios/switches */
  checked?: boolean;

  /** Expanded state for accordions/dropdowns */
  expanded?: boolean;

  /** Selected state for tabs/options */
  selected?: boolean;

  /** Focused state */
  focused?: boolean;

  /** Required for form inputs */
  required?: boolean;

  /** Invalid state for form inputs */
  invalid?: boolean;

  /** Read-only state */
  readonly?: boolean;
}

/**
 * Locator strategies for element identification.
 * Ordered by reliability/stability.
 */
export interface NodeLocators {
  /** Primary (most reliable) locator */
  primary: string;

  /** Alternative locators (fallbacks) */
  alternates?: string[];

  /** Frame path if element is in iframe */
  frame_path?: string[];

  /** Shadow DOM path if element is in shadow root */
  shadow_path?: string[];
}

/**
 * Additional attributes for specific node types.
 */
export interface NodeAttributes {
  /** Input type (text, email, password, etc.) */
  input_type?: string;

  /** Placeholder text */
  placeholder?: string;

  /** Current value (redacted by default for sensitive fields) */
  value?: string;

  /** Link href */
  href?: string;

  /** Image alt text */
  alt?: string;

  /** Image src (domain + path only, no query params) */
  src?: string;

  /** Heading level (1-6) */
  heading_level?: number;

  /** Form action URL */
  action?: string;

  /** Form method */
  method?: string;

  /** Autocomplete attribute */
  autocomplete?: string;

  /** ARIA role (if different from implied role) */
  role?: string;

  /** Data-testid or similar test identifier */
  test_id?: string;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Snapshot capture options.
 */
export interface SnapshotOptions {
  /** Include hidden elements (default: false) */
  include_hidden?: boolean;

  /** Maximum nodes to capture (default: unlimited) */
  max_nodes?: number;

  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Redact sensitive values like passwords (default: true) */
  redact_sensitive?: boolean;

  /** Include value attribute for inputs (default: false for security) */
  include_values?: boolean;
}

/**
 * Snapshot capture result returned by MCP tool.
 */
export interface SnapshotResult {
  /** Snapshot identifier */
  snapshot_id: string;

  /** Page URL */
  url: string;

  /** Page title */
  title: string;

  /** Capture statistics */
  stats: {
    node_count: number;
    interactive_count: number;
    captured_at: string;
    duration_ms: number;
  };
}

/**
 * Type guard for interactive nodes.
 */
export function isInteractiveNode(node: ReadableNode): boolean {
  const interactiveKinds: NodeKind[] = [
    'link',
    'button',
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
  ];
  return interactiveKinds.includes(node.kind);
}

/**
 * Type guard for readable content nodes.
 */
export function isReadableNode(node: ReadableNode): boolean {
  const readableKinds: NodeKind[] = [
    'heading',
    'paragraph',
    'text',
    'list',
    'listitem',
    'image',
    'media',
    'table',
  ];
  return readableKinds.includes(node.kind);
}

/**
 * Type guard for structural nodes.
 */
export function isStructuralNode(node: ReadableNode): boolean {
  const structuralKinds: NodeKind[] = ['form', 'dialog', 'navigation', 'section'];
  return structuralKinds.includes(node.kind);
}
