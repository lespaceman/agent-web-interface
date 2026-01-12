/**
 * Delta FactPack Types
 *
 * Type definitions for intelligent, incremental page state delivery.
 * Enables computing and sending deltas instead of full snapshots.
 */

import type { BaseSnapshot, ReadableNode, NodeKind } from '../snapshot/snapshot.types.js';

// ============================================================================
// Element Reference Types
// ============================================================================

/**
 * Globally unique element reference.
 * Safe across frames and navigations.
 */
export interface ScopedElementRef {
  /** CDP backend node ID (unique within frame + document) */
  backend_node_id: number;

  /** CDP frame ID */
  frame_id: string;

  /** CDP loader ID - changes on frame navigation */
  loader_id: string;
}

/**
 * Serialized ref format for agent communication.
 * ALWAYS includes loaderId to prevent stale ref collisions after navigation.
 * Format: "loaderId:backendNodeId" (main frame) or "frameId:loaderId:backendNodeId" (iframes)
 */
export type SerializedRef = string;

/**
 * Composite key for node lookup maps.
 * Prevents collisions across frames.
 * Format: "frameId:loaderId:backendNodeId"
 */
export type CompositeNodeKey = string;

// ============================================================================
// Frame Tracking Types
// ============================================================================

/**
 * Frame state tracked by FrameTracker.
 */
export interface FrameState {
  frameId: string;
  loaderId: string;
  url: string;
  isMainFrame: boolean;
}

/**
 * CDP Frame info from Page.frameNavigated event.
 */
export interface FrameInfo {
  id: string;
  loaderId: string;
  url: string;
  parentId?: string;
}

/**
 * CDP Frame tree structure from Page.getFrameTree.
 */
export interface FrameTree {
  frame: FrameInfo;
  childFrames?: FrameTree[];
}

// ============================================================================
// Snapshot State Types
// ============================================================================

/**
 * Tracked state for a known node.
 * Stored in baseline/context maps with CompositeNodeKey.
 */
export interface KnownNodeState {
  backend_node_id: number;
  label: string;
  kind: NodeKind;
  contentHash: string;
  ref: ScopedElementRef;
}

/**
 * Versioned snapshot wrapper.
 */
export interface VersionedSnapshot {
  /** Monotonically increasing version number */
  version: number;

  /** The snapshot data */
  snapshot: BaseSnapshot;

  /** Content hash for quick equality check */
  hash: string;

  /** Capture timestamp */
  timestamp: number;
}

/**
 * Page state mode for state machine.
 */
export type PageStateMode = 'uninitialized' | 'base' | 'overlay';

// ============================================================================
// Delta Computation Types
// ============================================================================

/**
 * Computed delta between two snapshots.
 * IMPORTANT: `removed` contains ScopedElementRef (not raw IDs)
 * to ensure proper invalidation formatting.
 */
export interface ComputedDelta {
  /** Nodes that were added (new in current snapshot) */
  added: ReadableNode[];

  /** Refs that were removed (present in old, absent in new) - fully scoped */
  removed: ScopedElementRef[];

  /** Nodes that were modified (same ref, different content) */
  modified: ModifiedNode[];

  /** Confidence score 0-1; low confidence triggers full snapshot fallback */
  confidence: number;
}

/**
 * Modified node details.
 */
export interface ModifiedNode {
  ref: ScopedElementRef;
  kind?: NodeKind;
  previousLabel: string;
  currentLabel: string;
  changeType: 'text' | 'state' | 'attributes';
}

// ============================================================================
// Overlay Types
// ============================================================================

/**
 * Overlay type classification.
 */
export type OverlayType = 'modal' | 'dialog' | 'dropdown' | 'tooltip' | 'unknown';

/**
 * Detected overlay information.
 */
export interface DetectedOverlay {
  rootRef: ScopedElementRef;
  overlayType: OverlayType;
  confidence: number;
  zIndex?: number;
}

/**
 * Overlay state tracked in stack.
 */
export interface OverlayState {
  /** Root element of the overlay */
  rootRef: ScopedElementRef;

  /** Snapshot of overlay content at time of detection */
  snapshot: BaseSnapshot;

  /** Hash for change detection */
  contentHash: string;

  /** Detection confidence (for debugging) */
  confidence: number;

  /** Overlay type for response formatting */
  overlayType: OverlayType;

  /**
   * Refs captured at overlay-open time for invalidation on close.
   * Uses original loaderId to match refs the agent received.
   */
  capturedRefs: ScopedElementRef[];
}

/**
 * Overlay change detection result.
 */
export interface OverlayChangeResult {
  type: 'opened' | 'closed' | 'replaced';
  overlay?: DetectedOverlay;
  closedOverlay?: OverlayState;
  newOverlay?: DetectedOverlay;
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Snapshot response types.
 */
export type SnapshotResponseType =
  | 'full'
  | 'delta'
  | 'no_change'
  | 'overlay_opened'
  | 'overlay_closed';

export interface DeltaCounts {
  invalidated: number;
  added: number;
  modified: number;
  removed: number;
}

export interface DeltaNodeSummary {
  ref: SerializedRef;
  kind: NodeKind;
  label: string;
  state?: ReadableNode['state'];
}

export interface DeltaModifiedSummary {
  ref: SerializedRef;
  kind?: NodeKind;
  change_type: ModifiedNode['changeType'];
  previous_label?: string;
  current_label?: string;
}

export interface DeltaPayloadBase {
  type: SnapshotResponseType;
  summary: string;
}

export interface DeltaPayloadDelta extends DeltaPayloadBase {
  type: 'delta';
  context: 'base' | 'overlay';
  counts: DeltaCounts;
  invalidated_refs: SerializedRef[];
  added: DeltaNodeSummary[];
  modified: DeltaModifiedSummary[];
  removed_refs: SerializedRef[];
}

export interface DeltaPayloadFull extends DeltaPayloadBase {
  type: 'full';
  snapshot: string;
  reason?: string;
}

export interface DeltaPayloadNoChange extends DeltaPayloadBase {
  type: 'no_change';
}

export interface DeltaPayloadOverlayOpened extends DeltaPayloadBase {
  type: 'overlay_opened';
  invalidated_refs: SerializedRef[];
  overlay: {
    overlay_type: OverlayType;
    root_ref: SerializedRef;
  };
  counts: DeltaCounts;
  nodes: DeltaNodeSummary[];
  transition?: 'opened' | 'replaced';
  previous_overlay?: {
    overlay_type: OverlayType;
    root_ref: SerializedRef;
    invalidated_refs: SerializedRef[];
  };
}

export interface DeltaPayloadOverlayClosed extends DeltaPayloadBase {
  type: 'overlay_closed';
  overlay: {
    overlay_type: OverlayType;
    root_ref: SerializedRef;
  };
  invalidated_refs: SerializedRef[];
  base_changes?: {
    counts: DeltaCounts;
    added: DeltaNodeSummary[];
    modified: DeltaModifiedSummary[];
    removed_refs: SerializedRef[];
  };
}

export type DeltaPayload =
  | DeltaPayloadDelta
  | DeltaPayloadFull
  | DeltaPayloadNoChange
  | DeltaPayloadOverlayOpened
  | DeltaPayloadOverlayClosed;

/**
 * Snapshot response returned by computeResponse.
 */
export interface SnapshotResponse {
  type: SnapshotResponseType;
  content: DeltaPayload;
  version: number;
}

/**
 * Validation result from version manager.
 */
export interface ValidationResult {
  status: 'current' | 'stale_with_history' | 'stale_no_history';
  currentVersion: VersionedSnapshot;
  agentVersion?: VersionedSnapshot;
  agentVersionNumber?: number;
  /** Only present when status is 'stale_with_history' or 'stale_no_history' */
  canComputeDelta?: boolean;
}

// ============================================================================
// DOM Stabilization Types
// ============================================================================

/**
 * DOM stabilization result.
 */
export interface StabilizationResult {
  status: 'stable' | 'timeout' | 'error';
  waitTimeMs: number;
  mutationCount?: number;
  warning?: string;
}

/**
 * DOM stabilization options.
 */
export interface StabilizationOptions {
  /** Quiet window - no mutations for this duration = stable (default: 100ms) */
  quietWindowMs?: number;
  /** Hard timeout - return regardless of mutations (default: 2000ms) */
  maxTimeoutMs?: number;
}

// ============================================================================
// Tool Integration Types
// ============================================================================

/**
 * Action types for response formatting.
 */
export type ActionType =
  | 'click'
  | 'type'
  | 'navigate'
  | 'scroll'
  | 'hover'
  | 'select'
  | 'press'
  | 'query';

/**
 * Tool result from executeWithDelta.
 */
export interface ToolResult {
  content: ToolResultContent[];
  isError?: boolean;
}

/**
 * Tool result content block.
 */
export interface ToolResultContent {
  type: 'text';
  text: string;
}

export type ActionStatus = 'completed' | 'failed' | 'skipped';

export interface ActionDeltaPayload {
  action: {
    name: string;
    status: ActionStatus;
  };
  pre_action?: DeltaPayload;
  result: DeltaPayload;
  warnings?: string[];
  error?: string;
}

/**
 * Delta tool result with extracted fields.
 */
export interface DeltaToolResult {
  version: number;
  content: ActionDeltaPayload;
  type: SnapshotResponseType;
  isError?: boolean;
}

// ============================================================================
// Format Options Types
// ============================================================================

/**
 * Delta formatting options.
 */
export interface DeltaFormatOptions {
  context: 'base' | 'overlay';
}
