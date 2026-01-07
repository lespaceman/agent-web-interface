/**
 * Snapshot Module
 *
 * Exports snapshot types, compiler, and storage.
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
export { isInteractiveNode, isReadableNode, isStructuralNode } from './snapshot.types.js';

// Store
export { SnapshotStore } from './snapshot-store.js';

// Element resolver
export { resolveLocator, parseLocatorString, type ParsedLocator } from './element-resolver.js';

// Snapshot extractor
export { extractSnapshot, mapAxRoleToNodeKind } from './snapshot-extractor.js';
