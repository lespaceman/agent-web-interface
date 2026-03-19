/**
 * Snapshot Module
 *
 * Exports snapshot types, compiler, and storage.
 *
 * @module snapshot
 */

// Types
export type {
  BaseSnapshot,
  Viewport,
  SnapshotMeta,
  ReadableNode,
  NodeKind,
  SemanticRegion,
  NodeLocation,
  NodeLayout,
  BBox,
  BoundingBox,
  ScreenZone,
  NodeState,
  NodeLocators,
  NodeAttributes,
  SnapshotOptions,
  SnapshotResult,
} from './snapshot.types.js';

// Type guards
export {
  isInteractiveNode,
  isReadableNode,
  isStructuralNode,
  isLiveRegionNode,
} from './snapshot.types.js';

// Store
export {
  SnapshotStore,
  type SnapshotEntry,
  type SnapshotStoreOptions,
  type SnapshotStoreStats,
} from './snapshot-store.js';

// Element resolver - CDP input functions
export {
  clickByBackendNodeId,
  clickAtCoordinates,
  clickAtElementOffset,
  getElementTopLeft,
  dragBetweenCoordinates,
  dispatchWheelEvent,
  typeByBackendNodeId,
  pressKey,
  selectOption,
  hoverByBackendNodeId,
  scrollIntoView,
  scrollPage,
  clearFocusedText,
  MODIFIER_ALT,
  MODIFIER_CTRL,
  MODIFIER_META,
  MODIFIER_SHIFT,
} from './element-resolver.js';

// Snapshot compiler
export { SnapshotCompiler, compileSnapshot, type CompileOptions } from './snapshot-compiler.js';

// Extractors (advanced usage)
export * from './extractors/index.js';
