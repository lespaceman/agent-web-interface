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
export { isInteractiveNode, isReadableNode, isStructuralNode } from './snapshot.types.js';

// Store
export {
  SnapshotStore,
  type SnapshotEntry,
  type SnapshotStoreOptions,
  type SnapshotStoreStats,
} from './snapshot-store.js';

// Element resolver
export { resolveLocator, parseLocatorString, type ParsedLocator } from './element-resolver.js';

// Snapshot extractor (legacy, kept for compatibility)
export { extractSnapshot, mapAxRoleToNodeKind } from './snapshot-extractor.js';

// Snapshot compiler (new modular implementation)
export {
  SnapshotCompiler,
  compileSnapshot,
  type CompileOptions,
} from './snapshot-compiler.js';

// Extractors (advanced usage)
export * from './extractors/index.js';
