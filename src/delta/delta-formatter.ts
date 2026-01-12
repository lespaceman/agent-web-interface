/**
 * Delta Formatter
 *
 * Functions for formatting snapshot responses for agent communication.
 * Formats full snapshots, deltas, and overlay events.
 */

import type { ReadableNode, BaseSnapshot } from '../snapshot/snapshot.types.js';
import type { ScopedElementRef, ComputedDelta, OverlayState, DeltaFormatOptions } from './types.js';
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
 * @returns Formatted snapshot string
 */
export function formatFullSnapshot(snapshot: BaseSnapshot, frameTracker: FrameTracker): string {
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
 * @returns Formatted delta string
 */
export function formatDelta(
  delta: ComputedDelta,
  frameInvalidations: ScopedElementRef[],
  options: DeltaFormatOptions,
  frameTracker: FrameTracker
): string {
  const parts: string[] = [];

  // Header based on context
  if (options.context === 'overlay') {
    parts.push('## Overlay Updated');
  } else {
    parts.push('## Page Updated');
  }

  // CRITICAL: Invalidations first (agent must stop using these)
  const allInvalidations = [
    ...frameInvalidations.map((r) => frameTracker.serializeRef(r)),
    ...delta.removed.map((r) => frameTracker.serializeRef(r)),
  ];

  if (allInvalidations.length > 0) {
    parts.push('');
    parts.push('### Invalidated References');
    parts.push('These element IDs are no longer valid. Do NOT use them:');
    parts.push(`\`${allInvalidations.join(', ')}\``);
  }

  // Additions
  if (delta.added.length > 0) {
    parts.push('');
    parts.push('### + Added');
    for (const node of delta.added) {
      parts.push(formatNode(node, frameTracker));
    }
  }

  // Modifications
  if (delta.modified.length > 0) {
    parts.push('');
    parts.push('### ~ Modified');
    for (const mod of delta.modified) {
      parts.push(
        `- [${frameTracker.serializeRef(mod.ref)}]: "${mod.previousLabel}" -> "${mod.currentLabel}"`
      );
    }
  }

  // Removals (already in invalidations, but provide context)
  if (delta.removed.length > 0) {
    parts.push('');
    parts.push('### - Removed');
    parts.push(`${delta.removed.length} element(s) removed from page.`);
  }

  return parts.join('\n');
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
 * @returns Formatted overlay opened string
 */
export function formatOverlayOpened(
  overlay: OverlayState,
  nodes: ReadableNode[],
  frameInvalidations: ScopedElementRef[],
  frameTracker: FrameTracker
): string {
  const parts: string[] = [];

  const typeLabel = getOverlayTypeLabel(overlay.overlayType);
  parts.push(`## ${typeLabel} Opened`);
  parts.push('');

  // Invalidations
  if (frameInvalidations.length > 0) {
    parts.push('### Invalidated References');
    parts.push(`\`${frameInvalidations.map((r) => frameTracker.serializeRef(r)).join(', ')}\``);
    parts.push('');
  }

  // Overlay content
  parts.push('### Overlay Content');
  for (const node of nodes) {
    parts.push(formatNode(node, frameTracker));
  }

  parts.push('');
  parts.push('> Base page is accessible behind this overlay.');

  return parts.join('\n');
}

/**
 * Format overlay closed response.
 *
 * @param closedOverlay - The overlay that was closed
 * @param invalidations - All invalidated refs (including overlay refs)
 * @param baseDelta - Changes to base page while overlay was open (optional)
 * @param frameTracker - FrameTracker for ref serialization
 * @returns Formatted overlay closed string
 */
export function formatOverlayClosed(
  closedOverlay: OverlayState,
  invalidations: ScopedElementRef[],
  baseDelta: ComputedDelta | null,
  frameTracker: FrameTracker
): string {
  const parts: string[] = [];

  parts.push('## Overlay Closed');
  parts.push('');

  // All overlay refs are now invalid
  parts.push('### Invalidated References');
  parts.push('All overlay element IDs are now invalid:');
  parts.push(`\`${invalidations.map((r) => frameTracker.serializeRef(r)).join(', ')}\``);

  // Base page changes while overlay was open
  if (baseDelta && (baseDelta.added.length > 0 || baseDelta.modified.length > 0)) {
    parts.push('');
    parts.push('### Base Page Changes');
    parts.push('The following changed while the overlay was open:');

    if (baseDelta.added.length > 0) {
      parts.push('');
      parts.push('**Added:**');
      for (const node of baseDelta.added) {
        parts.push(formatNode(node, frameTracker));
      }
    }

    if (baseDelta.modified.length > 0) {
      parts.push('');
      parts.push('**Modified:**');
      for (const mod of baseDelta.modified) {
        parts.push(
          `- [${frameTracker.serializeRef(mod.ref)}]: "${mod.previousLabel}" -> "${mod.currentLabel}"`
        );
      }
    }
  } else {
    parts.push('');
    parts.push('Base page unchanged.');
  }

  return parts.join('\n');
}

// ============================================================================
// No Change Formatting
// ============================================================================

/**
 * Format no-change response.
 *
 * @returns No change message
 */
export function formatNoChange(): string {
  return 'Action completed. No visible changes.';
}
