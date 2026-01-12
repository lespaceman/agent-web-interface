/**
 * Delta Formatter
 *
 * Functions for formatting snapshot responses for agent communication.
 * Formats full snapshots, deltas, and overlay events.
 */

import type { ReadableNode, BaseSnapshot } from '../snapshot/snapshot.types.js';
import type {
  ScopedElementRef,
  ComputedDelta,
  OverlayState,
  DeltaFormatOptions,
  DeltaCounts,
  DeltaNodeSummary,
  DeltaModifiedSummary,
  DeltaPayloadDelta,
  DeltaPayloadFull,
  DeltaPayloadOverlayOpened,
  DeltaPayloadOverlayClosed,
  DeltaPayloadNoChange,
  SerializedRef,
} from './types.js';
import type { FrameTracker } from './frame-tracker.js';
import { buildRefFromNode } from './utils.js';

// ============================================================================
// Node Formatting
// ============================================================================

/**
 * Format state indicators for a node.
 */
function formatState(state: ReadableNode['state']): string {
  if (!state) return '';

  const indicators: string[] = [];

  if (state.checked) indicators.push('[checked]');
  if (state.selected) indicators.push('[selected]');
  if (state.expanded) indicators.push('[expanded]');
  if (state.focused) indicators.push('[focused]');
  if (!state.enabled) indicators.push('[disabled]');
  if (state.required) indicators.push('[required]');
  if (state.invalid) indicators.push('[invalid]');
  if (state.readonly) indicators.push('[readonly]');

  return indicators.length > 0 ? ' ' + indicators.join(' ') : '';
}

/**
 * Format a node for display.
 * Uses node's stored loader_id directly for ref construction.
 *
 * @param node - ReadableNode to format
 * @param frameTracker - FrameTracker for ref serialization
 * @returns Formatted node string
 */
export function formatNode(node: ReadableNode, frameTracker: FrameTracker): string {
  // Build ref directly from node's captured data - NOT from current frame state
  const ref = buildRefFromNode(node);
  const serialized = frameTracker.serializeRef(ref);
  const stateIndicators = formatState(node.state);
  return `- ${node.kind}[${serialized}]: "${node.label}"${stateIndicators}`;
}

function buildDeltaNodeSummary(node: ReadableNode, frameTracker: FrameTracker): DeltaNodeSummary {
  const ref = buildRefFromNode(node);
  const summary: DeltaNodeSummary = {
    ref: frameTracker.serializeRef(ref),
    kind: node.kind,
    label: node.label,
  };

  if (node.state) {
    summary.state = node.state;
  }

  return summary;
}

function buildDeltaModifiedSummary(
  mod: ComputedDelta['modified'][number],
  frameTracker: FrameTracker
): DeltaModifiedSummary {
  const summary: DeltaModifiedSummary = {
    ref: frameTracker.serializeRef(mod.ref),
    change_type: mod.changeType,
  };

  if (mod.kind) {
    summary.kind = mod.kind;
  }

  if (mod.previousLabel !== mod.currentLabel) {
    summary.previous_label = mod.previousLabel;
    summary.current_label = mod.currentLabel;
  }

  return summary;
}

function serializeRefs(refs: ScopedElementRef[], frameTracker: FrameTracker): SerializedRef[] {
  return refs.map((ref) => frameTracker.serializeRef(ref));
}

function uniqueRefs(refs: SerializedRef[]): SerializedRef[] {
  const seen = new Set<string>();
  const unique: SerializedRef[] = [];

  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    unique.push(ref);
  }

  return unique;
}

function buildCounts(
  invalidated: number,
  added: number,
  modified: number,
  removed: number
): DeltaCounts {
  return {
    invalidated,
    added,
    modified,
    removed,
  };
}

// ============================================================================
// Region Grouping
// ============================================================================

/**
 * Group nodes by semantic region.
 */
function groupByRegion(nodes: ReadableNode[]): Record<string, ReadableNode[]> {
  const regions: Record<string, ReadableNode[]> = {
    Header: [],
    Navigation: [],
    Main: [],
    Sidebar: [],
    Footer: [],
    Dialog: [],
    Other: [],
  };

  for (const node of nodes) {
    const region = node.where.region;
    switch (region) {
      case 'header':
        regions.Header.push(node);
        break;
      case 'nav':
        regions.Navigation.push(node);
        break;
      case 'main':
        regions.Main.push(node);
        break;
      case 'aside':
        regions.Sidebar.push(node);
        break;
      case 'footer':
        regions.Footer.push(node);
        break;
      case 'dialog':
        regions.Dialog.push(node);
        break;
      default:
        regions.Other.push(node);
        break;
    }
  }

  return regions;
}

// ============================================================================
// Full Snapshot Formatting
// ============================================================================

/**
 * Format full snapshot for agent communication.
 *
 * @param snapshot - BaseSnapshot to format
 * @param frameTracker - FrameTracker for ref serialization
 * @returns Formatted snapshot text
 */
function renderFullSnapshotText(snapshot: BaseSnapshot, frameTracker: FrameTracker): string {
  const parts: string[] = [];

  parts.push(`# Page: ${snapshot.title}`);
  parts.push(`URL: ${snapshot.url}`);
  parts.push('');

  // Group by semantic region if available
  const regions = groupByRegion(snapshot.nodes);

  for (const [region, nodes] of Object.entries(regions)) {
    if (nodes.length === 0) continue;

    parts.push(`## ${region}`);
    for (const node of nodes) {
      parts.push(formatNode(node, frameTracker));
    }
    parts.push('');
  }

  return parts.join('\n');
}

export function formatFullSnapshot(
  snapshot: BaseSnapshot,
  frameTracker: FrameTracker,
  reason?: string
): DeltaPayloadFull {
  const snapshotText = renderFullSnapshotText(snapshot, frameTracker);
  const summary = reason ? `Full snapshot: ${reason}` : 'Full snapshot.';

  return {
    type: 'full',
    summary,
    snapshot: snapshotText,
    reason,
  };
}

// ============================================================================
// Delta Formatting
// ============================================================================

/**
 * Format delta for agent communication.
 *
 * @param delta - Computed delta
 * @param frameInvalidations - Additional invalidations from frame events
 * @param options - Format options (context: base or overlay)
 * @param frameTracker - FrameTracker for ref serialization
 * @returns Structured delta payload
 */
export function formatDelta(
  delta: ComputedDelta,
  frameInvalidations: ScopedElementRef[],
  options: DeltaFormatOptions,
  frameTracker: FrameTracker
): DeltaPayloadDelta {
  const removedRefs = serializeRefs(delta.removed, frameTracker);
  const invalidatedRefs = uniqueRefs([
    ...serializeRefs(frameInvalidations, frameTracker),
    ...removedRefs,
  ]);
  const added = delta.added.map((node) => buildDeltaNodeSummary(node, frameTracker));
  const modified = delta.modified.map((mod) => buildDeltaModifiedSummary(mod, frameTracker));
  const counts = buildCounts(
    invalidatedRefs.length,
    added.length,
    modified.length,
    removedRefs.length
  );

  const contextLabel = options.context === 'overlay' ? 'Overlay updated' : 'Page updated';
  const summary = `${contextLabel}: +${counts.added} ~${counts.modified} -${counts.removed}, invalidated ${counts.invalidated}.`;

  return {
    type: 'delta',
    context: options.context,
    summary,
    counts,
    invalidated_refs: invalidatedRefs,
    added,
    modified,
    removed_refs: removedRefs,
  };
}

// ============================================================================
// Overlay Formatting
// ============================================================================

/**
 * Get overlay type label for display.
 */
function getOverlayTypeLabel(overlayType: OverlayState['overlayType']): string {
  const typeLabels: Record<OverlayState['overlayType'], string> = {
    modal: 'Modal',
    dialog: 'Dialog',
    dropdown: 'Dropdown',
    tooltip: 'Tooltip',
    unknown: 'Overlay',
  };
  return typeLabels[overlayType];
}

/**
 * Format overlay opened response.
 *
 * @param overlay - Overlay state
 * @param nodes - Nodes within the overlay
 * @param frameInvalidations - Additional invalidations from frame events
 * @param frameTracker - FrameTracker for ref serialization
 * @returns Structured overlay-opened payload
 */
export function formatOverlayOpened(
  overlay: OverlayState,
  nodes: ReadableNode[],
  frameInvalidations: ScopedElementRef[],
  frameTracker: FrameTracker
): DeltaPayloadOverlayOpened {
  const invalidatedRefs = uniqueRefs(serializeRefs(frameInvalidations, frameTracker));
  const nodeSummaries = nodes.map((node) => buildDeltaNodeSummary(node, frameTracker));
  const counts = buildCounts(invalidatedRefs.length, nodeSummaries.length, 0, 0);
  const typeLabel = getOverlayTypeLabel(overlay.overlayType);
  const summary = `${typeLabel} opened: ${counts.added} node(s), invalidated ${counts.invalidated}.`;

  return {
    type: 'overlay_opened',
    summary,
    invalidated_refs: invalidatedRefs,
    overlay: {
      overlay_type: overlay.overlayType,
      root_ref: frameTracker.serializeRef(overlay.rootRef),
    },
    counts,
    nodes: nodeSummaries,
  };
}

/**
 * Format overlay closed response.
 *
 * @param closedOverlay - The overlay that was closed
 * @param invalidations - All invalidated refs (including overlay refs)
 * @param baseDelta - Changes to base page while overlay was open (optional)
 * @param frameTracker - FrameTracker for ref serialization
 * @returns Structured overlay-closed payload
 */
export function formatOverlayClosed(
  closedOverlay: OverlayState,
  invalidations: ScopedElementRef[],
  baseDelta: ComputedDelta | null,
  frameTracker: FrameTracker
): DeltaPayloadOverlayClosed {
  const invalidatedRefs = uniqueRefs(serializeRefs(invalidations, frameTracker));
  const overlayInfo = {
    overlay_type: closedOverlay.overlayType,
    root_ref: frameTracker.serializeRef(closedOverlay.rootRef),
  };
  const hasBaseChanges =
    baseDelta &&
    (baseDelta.added.length > 0 || baseDelta.modified.length > 0 || baseDelta.removed.length > 0);

  let baseChanges: DeltaPayloadOverlayClosed['base_changes'];
  let summary = `Overlay closed: invalidated ${invalidatedRefs.length}.`;

  if (hasBaseChanges && baseDelta) {
    const added = baseDelta.added.map((node) => buildDeltaNodeSummary(node, frameTracker));
    const modified = baseDelta.modified.map((mod) => buildDeltaModifiedSummary(mod, frameTracker));
    const removedRefs = serializeRefs(baseDelta.removed, frameTracker);
    const counts = buildCounts(0, added.length, modified.length, removedRefs.length);

    baseChanges = {
      counts,
      added,
      modified,
      removed_refs: removedRefs,
    };

    summary = `Overlay closed: invalidated ${invalidatedRefs.length}. Base changes: +${counts.added} ~${counts.modified} -${counts.removed}.`;
  } else {
    summary = `Overlay closed: invalidated ${invalidatedRefs.length}. Base unchanged.`;
  }

  return {
    type: 'overlay_closed',
    summary,
    overlay: overlayInfo,
    invalidated_refs: invalidatedRefs,
    base_changes: baseChanges,
  };
}

// ============================================================================
// No Change Formatting
// ============================================================================

/**
 * Format no-change response.
 *
 * @returns Structured no-change payload
 */
export function formatNoChange(summary = 'No visible changes.'): DeltaPayloadNoChange {
  return {
    type: 'no_change',
    summary,
  };
}
