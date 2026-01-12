/**
 * Delta Module
 *
 * Exports for intelligent, incremental page state delivery.
 * Mutation tools use these to return delta FactPacks showing what changed.
 */

// ============================================================================
// Core Types
// ============================================================================

export type {
  // Element references
  ScopedElementRef,
  CompositeNodeKey,
  SerializedRef,

  // Delta computation
  ComputedDelta,
  ModifiedNode,

  // Versioning
  VersionedSnapshot,
  ValidationResult,

  // Responses
  SnapshotResponse,
  SnapshotResponseType,
  DeltaPayload,
  DeltaPayloadDelta,
  DeltaPayloadFull,
  DeltaPayloadNoChange,
  DeltaPayloadOverlayOpened,
  DeltaPayloadOverlayClosed,
  DeltaCounts,
  DeltaNodeSummary,
  DeltaModifiedSummary,
  DeltaToolResult,
  DeltaFormatOptions,
  ActionStatus,
  ActionDeltaPayload,

  // Overlay
  OverlayState,

  // Stabilization
  StabilizationResult,
  StabilizationOptions,

  // Action types
  ActionType,
} from './types.js';

// ============================================================================
// Utilities
// ============================================================================

export {
  makeCompositeKey,
  makeCompositeKeyFromNode,
  hashSnapshot,
  hashNodeContent,
  createVersionedSnapshot,
  buildRefFromNode,
  computeDeltaConfidence,
} from './utils.js';

// ============================================================================
// Frame Tracker
// ============================================================================

export { FrameTracker } from './frame-tracker.js';

// ============================================================================
// DOM Stabilizer
// ============================================================================

export { stabilizeDom } from './dom-stabilizer.js';

// ============================================================================
// Snapshot Version Manager
// ============================================================================

export { SnapshotVersionManager } from './snapshot-version-manager.js';

// ============================================================================
// Delta Formatter
// ============================================================================

export {
  formatFullSnapshot,
  formatDelta,
  formatOverlayOpened,
  formatOverlayClosed,
  formatNoChange,
  formatNode,
} from './delta-formatter.js';

// ============================================================================
// Page Snapshot State
// ============================================================================

export { PageSnapshotState } from './page-snapshot-state.js';

// ============================================================================
// Execute With Delta
// ============================================================================

export {
  executeWithDelta,
  getPageSnapshotState,
  clearPageState,
  extractDeltaFields,
} from './execute-with-delta.js';
