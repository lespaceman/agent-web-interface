/**
 * Element Registry
 *
 * Manages eid → ElementRef mappings across snapshots.
 * Provides lookup by eid for action tools, enabling the transition from
 * transient node_id to stable semantic eid for element targeting.
 *
 * Key responsibilities:
 * - Build ElementRef from ReadableNode
 * - Track eid across snapshot updates
 * - Provide lookup by eid for action tools
 * - Detect stale elements
 */

import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type {
  ElementRef,
  ElementTargetRef,
  EidRegistry,
  RegistryUpdateResult,
} from './element-ref.types.js';
import { computeEid, resolveEidCollision } from './element-identity.js';
import { generateLocator } from './locator-generator.js';
import { isInteractiveKind } from './actionables-filter.js';

// ============================================================================
// Element Registry Class
// ============================================================================

/**
 * ElementRegistry - Manages eid → ElementRef mappings across snapshots.
 *
 * Usage:
 * 1. Call updateFromSnapshot() after each new snapshot
 * 2. Use getByEid() in action tools to resolve eid to ElementRef
 * 3. Use getEidByBackendNodeId() for reverse lookup (legacy node_id support)
 */
export class ElementRegistry {
  private registry: EidRegistry = {
    byEid: new Map(),
    backendToEid: new Map(),
    lastSeenStep: new Map(),
  };

  private currentStep = 0;
  private currentSnapshotId = '';

  /**
   * Update registry with new snapshot.
   * Builds ElementRef for each interactive node and tracks changes.
   *
   * @param snapshot - New snapshot to process
   * @param activeLayer - Active layer for eid computation
   * @returns List of added, removed, and updated eids
   */
  updateFromSnapshot(snapshot: BaseSnapshot, activeLayer: string): RegistryUpdateResult {
    this.currentStep++;
    this.currentSnapshotId = snapshot.snapshot_id;

    const previousEids = new Set(this.registry.byEid.keys());
    const currentEids = new Set<string>();
    const usedEids = new Set<string>();

    const added: string[] = [];
    const updated: string[] = [];

    // Process all interactive nodes
    for (const node of snapshot.nodes) {
      // Only track interactive elements
      if (!isInteractiveKind(node.kind)) continue;

      // Compute eid (with collision resolution)
      const baseEid = computeEid(node, activeLayer);
      const eid = resolveEidCollision(baseEid, usedEids);
      usedEids.add(eid);
      currentEids.add(eid);

      // Build ElementRef
      const ref = this.buildElementRef(node, eid, snapshot.snapshot_id, activeLayer);

      // Track whether this is new or updated
      if (!previousEids.has(eid)) {
        added.push(eid);
      } else {
        updated.push(eid);
      }

      // Update registry
      this.registry.byEid.set(eid, ref);
      this.registry.backendToEid.set(
        `${snapshot.snapshot_id}:${node.backend_node_id}`,
        eid
      );
      this.registry.lastSeenStep.set(eid, this.currentStep);
    }

    // Find removed eids (present in previous, not in current)
    const removed: string[] = [];
    for (const eid of previousEids) {
      if (!currentEids.has(eid)) {
        removed.push(eid);
        // Don't delete immediately - keep for staleness detection
        // Mark as not seen in current step (lastSeenStep not updated)
      }
    }

    return { added, removed, updated };
  }

  /**
   * Build ElementRef from ReadableNode.
   *
   * @param node - Source node
   * @param eid - Computed eid
   * @param snapshotId - Snapshot ID
   * @param activeLayer - Active layer for locator scoping
   * @returns ElementRef
   */
  private buildElementRef(
    node: ReadableNode,
    eid: string,
    snapshotId: string,
    activeLayer: string
  ): ElementRef {
    const locatorInfo = generateLocator(node, activeLayer);

    const ref: ElementTargetRef = {
      snapshot_id: snapshotId,
      backend_node_id: node.backend_node_id,
      frame_id: node.frame_id,
      loader_id: node.loader_id,
      locators: {
        preferred: locatorInfo.preferred,
        fallback: locatorInfo.fallback,
      },
    };

    return { eid, ref };
  }

  /**
   * Lookup element by eid.
   *
   * @param eid - Element ID to lookup
   * @returns ElementRef or undefined if not found
   */
  getByEid(eid: string): ElementRef | undefined {
    return this.registry.byEid.get(eid);
  }

  /**
   * Lookup eid by backend_node_id in current snapshot.
   * Used for backwards compatibility with node_id-based tools.
   *
   * @param backendNodeId - CDP backend node ID
   * @returns eid or undefined
   */
  getEidByBackendNodeId(backendNodeId: number): string | undefined {
    return this.registry.backendToEid.get(`${this.currentSnapshotId}:${backendNodeId}`);
  }

  /**
   * Lookup eid by backend_node_id in any snapshot.
   *
   * @param snapshotId - Snapshot ID
   * @param backendNodeId - CDP backend node ID
   * @returns eid or undefined
   */
  getEidBySnapshotAndBackendNodeId(snapshotId: string, backendNodeId: number): string | undefined {
    return this.registry.backendToEid.get(`${snapshotId}:${backendNodeId}`);
  }

  /**
   * Get all current eids.
   *
   * @returns Array of all tracked eids
   */
  getAllEids(): string[] {
    return Array.from(this.registry.byEid.keys());
  }

  /**
   * Check if an eid is stale (not seen in recent snapshots).
   *
   * @param eid - Element ID to check
   * @param maxStaleSteps - Maximum steps since last seen (default: 2)
   * @returns true if stale
   */
  isStale(eid: string, maxStaleSteps = 2): boolean {
    const lastSeen = this.registry.lastSeenStep.get(eid);
    if (lastSeen === undefined) return true;
    return this.currentStep - lastSeen > maxStaleSteps;
  }

  /**
   * Get current step counter.
   */
  getCurrentStep(): number {
    return this.currentStep;
  }

  /**
   * Get current snapshot ID.
   */
  getCurrentSnapshotId(): string {
    return this.currentSnapshotId;
  }

  /**
   * Clear registry (on session close or full navigation).
   */
  clear(): void {
    this.registry.byEid.clear();
    this.registry.backendToEid.clear();
    this.registry.lastSeenStep.clear();
    this.currentStep = 0;
    this.currentSnapshotId = '';
  }

  /**
   * Get number of tracked elements.
   */
  size(): number {
    return this.registry.byEid.size;
  }
}

// ============================================================================
// Registry Factory
// ============================================================================

/**
 * Global registry of element registries (one per page).
 */
const registries = new Map<string, ElementRegistry>();

/**
 * Get or create element registry for a page.
 *
 * @param pageId - Page ID
 * @returns ElementRegistry instance
 */
export function getElementRegistry(pageId: string): ElementRegistry {
  if (!registries.has(pageId)) {
    registries.set(pageId, new ElementRegistry());
  }
  return registries.get(pageId)!;
}

/**
 * Remove element registry for a page (call on page close).
 *
 * @param pageId - Page ID
 */
export function removeElementRegistry(pageId: string): void {
  registries.delete(pageId);
}

/**
 * Clear all element registries (call on session close).
 */
export function clearAllElementRegistries(): void {
  registries.clear();
}
