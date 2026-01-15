/**
 * State System Types
 *
 * Type definitions for the StateHandle + Diff + Actionables system.
 * Universal and domain-agnostic - works on any website.
 */

import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type { ObservationGroups } from '../observation/observation.types.js';

// ============================================================================
// State Handle Types
// ============================================================================

/**
 * Complete state response returned after every action.
 * Now returned as a dense XML string.
 */
export type StateResponse = string;

/**
 * Internal state response object before rendering.
 */
export interface StateResponseObject {
  /** Current state metadata */
  state: StateHandle;

  /** Diff or baseline mode */
  diff: DiffResponse | BaselineResponse;

  /** Capped list of actionable elements */
  actionables: ActionableInfo[];

  /** Count metadata */
  counts: {
    shown: number;
    total_in_layer: number;
  };

  /** Limits applied to response */
  limits: {
    max_actionables: number;
    actionables_capped: boolean;
  };

  /** Universal UI state atoms */
  atoms: Atoms;

  /** Estimated token count for this response */
  tokens: number;

  /**
   * DOM observations - significant elements that appeared or disappeared.
   * Optional, only present if observations were captured.
   */
  observations?: ObservationGroups;
}

/**
 * State handle - always returned with every response.
 */
export interface StateHandle {
  /** Session ID (unique per page) */
  sid: string;

  /** Monotonic step counter */
  step: number;

  /** Document metadata */
  doc: {
    url: string;
    origin: string;
    title: string;
    doc_id: string; // hash of origin + pathname + signature
    nav_type: 'soft' | 'hard';
    history_idx: number;
  };

  /** Layer stack and active layer */
  layer: {
    active: 'main' | 'modal' | 'drawer' | 'popover';
    stack: string[];
    focus_eid?: string;
    pointer_lock: boolean;
  };

  /** Timing metadata */
  timing: {
    ts: string; // ISO 8601 timestamp
    dom_ready: boolean;
    network_busy: boolean;
  };

  /** State hashes for change detection */
  hash: {
    ui: string; // hash of interactive index
    layer: string; // hash of layer stack
  };
}

// ============================================================================
// Diff Types
// ============================================================================

/**
 * Baseline response (full state, no diff).
 *
 * Baselines are only sent when the LLM truly needs full context:
 * - first: No previous snapshot (LLM has no prior context)
 * - navigation: URL changed (old elements no longer exist)
 * - error: State corrupted, need to resync
 *
 * For same-page mutations, diffs are always used regardless of
 * how many elements changed - the LLM already has context.
 */
export interface BaselineResponse {
  mode: 'baseline';
  /** Reason for sending baseline instead of diff */
  reason: 'first' | 'navigation' | 'error';
  /** Error message if reason is 'error' */
  error?: string;
}

/**
 * Text content change in a readable element.
 */
export interface TextChange {
  /** Element ID (rd-* prefix for readable nodes) */
  eid: string;
  /** Previous text content */
  from: string;
  /** Current text content */
  to: string;
}

/**
 * Status/alert element that appeared.
 */
export interface StatusNode {
  /** Element ID (rd-* prefix for readable nodes) */
  eid: string;
  /** ARIA role (status, alert, log, progressbar) */
  role: string;
  /** Text content */
  text: string;
}

/**
 * Diff response (incremental changes).
 */
export interface DiffResponse {
  mode: 'diff';
  diff: {
    doc?: {
      from: { url: string; title: string };
      to: { url: string; title: string };
      nav_type: 'soft' | 'hard';
    };
    layer?: {
      stack_from: string[];
      stack_to: string[];
    };
    actionables: {
      added: string[]; // eids
      removed: string[]; // eids
      changed: DiffChange[];
    };
    /** Readable content mutations (status changes, text updates) */
    mutations: {
      /** Text content that changed in status/alert/log/progressbar elements */
      textChanged: TextChange[];
      /** Status/alert/log/progressbar elements that appeared */
      statusAppeared: StatusNode[];
    };
    /** True if no actionables or mutations changed */
    isEmpty: boolean;
    atoms: AtomChange[];
  };
}

/**
 * A single property change in an actionable.
 */
export interface DiffChange {
  eid: string;
  k: string; // property key (vis, ena, val, chk, etc.)
  from: unknown;
  to: unknown;
}

/**
 * A single property change in atoms.
 */
export interface AtomChange {
  k: string; // atom key (viewport.w, scroll.y, etc.)
  from: unknown;
  to: unknown;
}

// ============================================================================
// Actionables Types
// ============================================================================

/**
 * Element target reference for direct interaction.
 * Enables action tools to target elements directly without re-querying.
 */
export interface ElementTargetRef {
  /** Snapshot that produced this ref */
  snapshot_id: string;
  /** CDP backend node ID - primary targeting method */
  backend_node_id: number;
  /** CDP frame ID - for cross-frame targeting */
  frame_id?: string;
  /** CDP loader ID - changes on navigation */
  loader_id?: string;
}

/**
 * Actionable element information (returned to LLM).
 */
export interface ActionableInfo {
  /** Stable semantic element ID */
  eid: string;

  /** Element kind */
  kind: string;

  /** Accessible name / label */
  name: string;

  /** ARIA role */
  role: string;

  /** Visible */
  vis: boolean;

  /** Enabled */
  ena: boolean;

  /** Element target reference for direct interaction */
  ref: ElementTargetRef;

  /** Locators for this element */
  loc: LocatorInfo;

  /** Context metadata */
  ctx: {
    layer: string;
    region: string;
    group?: string;
  };

  /** Optional state flags (only if true) */
  chk?: boolean; // checked
  sel?: boolean; // selected
  exp?: boolean; // expanded
  foc?: boolean; // focused
  req?: boolean; // required
  inv?: boolean; // invalid
  rdo?: boolean; // readonly

  /** Optional attributes */
  val_hint?: string; // input value (truncated)
  placeholder?: string;
  href?: string;
  type?: string; // input type
}

/**
 * Locator information for an element.
 */
export interface LocatorInfo {
  /** Preferred locator (accessibility tree) */
  preferred: { ax: string };

  /** Fallback locator (CSS) */
  fallback?: { css: string };
}

// ============================================================================
// Layer Detection Types
// ============================================================================

/**
 * Result of layer detection.
 */
export interface LayerDetectionResult {
  /** Layer stack (bottom to top) */
  stack: LayerInfo[];

  /** Active layer (topmost) */
  active: 'main' | 'modal' | 'drawer' | 'popover';

  /** Currently focused element ID */
  focusEid?: string;

  /** Pointer lock active */
  pointerLock: boolean;
}

/**
 * Information about a detected layer.
 */
export interface LayerInfo {
  type: 'main' | 'modal' | 'drawer' | 'popover';
  rootEid?: string; // eid of layer root node
  zIndex?: number;
  isModal: boolean; // blocks interaction with lower layers
}

/**
 * Internal layer candidate during detection.
 */
export interface LayerCandidate extends LayerInfo {
  confidence: number; // 0-1
}

// ============================================================================
// Atoms Types
// ============================================================================

/**
 * Universal UI state atoms.
 */
export interface Atoms {
  /** Viewport dimensions */
  viewport: {
    w: number;
    h: number;
    dpr: number;
  };

  /** Scroll position */
  scroll: {
    x: number;
    y: number;
  };

  /** Loading indicators (optional) */
  loading?: {
    network_busy: boolean;
    spinners: number;
    progress?: number;
  };

  /** Form state (optional) */
  forms?: {
    dirty: boolean;
    focused_field?: string; // eid
    validation_errors: number;
  };

  /** Notifications (optional) */
  notifications?: {
    toasts: number;
    banners: number;
  };
}

// ============================================================================
// State Manager Internal Types
// ============================================================================

/**
 * State manager context (internal state).
 */
export interface StateManagerContext {
  /** Session tracking */
  sessionId: string;
  pageId: string;
  stepCounter: number;

  /** Snapshot versioning */
  currentSnapshot: BaseSnapshot | null;
  previousSnapshot: BaseSnapshot | null;

  /** Document tracking */
  currentDocId: string | null;

  /** Configuration */
  config: StateManagerConfig;
}

/**
 * State manager configuration.
 */
export interface StateManagerConfig {
  /** Maximum actionables to return */
  maxActionables: number;
}

/**
 * Scoring context for actionables filtering.
 */
export interface ScoringContext {
  /** Primary CTA from FactPack (if available) */
  primaryCTA?: {
    node_id: string;
    label: string;
  };

  /** Active layer */
  activeLayer: string;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Element identity for tracking across snapshots.
 */
export interface ElementIdentity {
  eid: string;
  role: string;
  name: string;
  href?: string;
  landmarkPath: string[];
  nthOfType: number;
  layer: string;
  lastSeenStep: number;
}

/**
 * EID to node mapping.
 */
export type EidMap = Map<string, ReadableNode>;

/**
 * Hash function type.
 */
export type HashFunction = (...components: string[]) => string;
