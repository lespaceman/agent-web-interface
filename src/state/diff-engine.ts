/**
 * Diff Engine
 *
 * Compute incremental changes between snapshots.
 * Returns added/removed/changed actionables and atoms.
 */

import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type { DiffResponse, DiffChange, AtomChange, EidMap } from './types.js';
import { computeEid } from './element-identity.js';
import { isInteractiveKind } from './actionables-filter.js';
import { detectLayers } from './layer-detector.js';
import { extractAtoms } from './atoms-extractor.js';

// ============================================================================
// Diff Computation
// ============================================================================

/**
 * Compute diff between previous and current snapshots.
 *
 * Includes:
 * - Document changes (URL, title, navigation type)
 * - Layer changes (stack changes)
 * - Actionables changes (added, removed, changed)
 * - Atoms changes (viewport, scroll, loading, forms, notifications)
 *
 * @param prev - Previous snapshot
 * @param curr - Current snapshot
 * @returns Diff response
 */
export function computeDiff(prev: BaseSnapshot, curr: BaseSnapshot): DiffResponse {
  // Build EID maps
  const prevMap = buildEidMap(prev);
  const currMap = buildEidMap(curr);

  // Find added/removed actionables
  const added = findAdded(prevMap, currMap);
  const removed = findRemoved(prevMap, currMap);

  // Find changed actionables
  const changed = findChanged(prevMap, currMap);

  // Detect document change
  const doc = detectDocumentChange(prev, curr);

  // Detect layer change
  const layer = detectLayerChange(prev, curr);

  // Compute atomic diffs
  const atoms = computeAtomicDiffs(prev, curr);

  return {
    mode: 'diff',
    diff: {
      doc,
      layer,
      actionables: {
        added,
        removed,
        changed,
      },
      atoms,
    },
  };
}

// ============================================================================
// EID Map Building
// ============================================================================

/**
 * Build map of EID -> node for visible interactive elements.
 *
 * @param snapshot - Snapshot to build map from
 * @returns EID map
 */
function buildEidMap(snapshot: BaseSnapshot): EidMap {
  const map: EidMap = new Map();

  for (const node of snapshot.nodes) {
    // Only include visible interactive elements
    if (!isInteractiveKind(node.kind) || !node.state?.visible) {
      continue;
    }

    const eid = computeEid(node);
    map.set(eid, node);
  }

  return map;
}

// ============================================================================
// Added/Removed Detection
// ============================================================================

/**
 * Find added EIDs (present in current but not in previous).
 *
 * @param prevMap - Previous EID map
 * @param currMap - Current EID map
 * @returns Array of added EIDs
 */
function findAdded(prevMap: EidMap, currMap: EidMap): string[] {
  const added: string[] = [];

  for (const eid of currMap.keys()) {
    if (!prevMap.has(eid)) {
      added.push(eid);
    }
  }

  return added;
}

/**
 * Find removed EIDs (present in previous but not in current).
 *
 * @param prevMap - Previous EID map
 * @param currMap - Current EID map
 * @returns Array of removed EIDs
 */
function findRemoved(prevMap: EidMap, currMap: EidMap): string[] {
  const removed: string[] = [];

  for (const eid of prevMap.keys()) {
    if (!currMap.has(eid)) {
      removed.push(eid);
    }
  }

  return removed;
}

// ============================================================================
// Changed Detection
// ============================================================================

/**
 * Find changed actionables (present in both but with different state/attributes).
 *
 * @param prevMap - Previous EID map
 * @param currMap - Current EID map
 * @returns Array of changes
 */
function findChanged(prevMap: EidMap, currMap: EidMap): DiffChange[] {
  const changed: DiffChange[] = [];

  for (const [eid, currNode] of currMap) {
    const prevNode = prevMap.get(eid);
    if (!prevNode) {
      continue; // Already in 'added' list
    }

    // Compare state and attributes
    const diffs = compareNodes(eid, prevNode, currNode);
    changed.push(...diffs);
  }

  return changed;
}

/**
 * Compare two nodes and return list of property changes.
 *
 * @param eid - Element ID
 * @param prev - Previous node
 * @param curr - Current node
 * @returns Array of changes
 */
function compareNodes(eid: string, prev: ReadableNode, curr: ReadableNode): DiffChange[] {
  const changes: DiffChange[] = [];

  // Compare state flags
  const stateFields = ['visible', 'enabled', 'checked', 'selected', 'expanded', 'focused', 'required', 'invalid', 'readonly'];
  for (const field of stateFields) {
    const prevVal = prev.state?.[field as keyof typeof prev.state];
    const currVal = curr.state?.[field as keyof typeof curr.state];

    if (prevVal !== currVal) {
      // Map to abbreviated keys
      const abbrev: Record<string, string> = {
        visible: 'vis',
        enabled: 'ena',
        checked: 'chk',
        selected: 'sel',
        expanded: 'exp',
        focused: 'foc',
        required: 'req',
        invalid: 'inv',
        readonly: 'rdo',
      };

      changes.push({
        eid,
        k: abbrev[field] || field,
        from: prevVal,
        to: currVal,
      });
    }
  }

  // Compare value attribute (for inputs)
  if (prev.attributes?.value !== curr.attributes?.value) {
    changes.push({
      eid,
      k: 'val',
      from: prev.attributes?.value,
      to: curr.attributes?.value,
    });
  }

  // Compare label (text content)
  if (prev.label !== curr.label) {
    changes.push({
      eid,
      k: 'label',
      from: prev.label,
      to: curr.label,
    });
  }

  return changes;
}

// ============================================================================
// Document Change Detection
// ============================================================================

/**
 * Detect if document changed (URL or title).
 *
 * @param prev - Previous snapshot
 * @param curr - Current snapshot
 * @returns Document change or undefined
 */
function detectDocumentChange(
  prev: BaseSnapshot,
  curr: BaseSnapshot
): DiffResponse['diff']['doc'] {
  if (prev.url === curr.url && prev.title === curr.title) {
    return undefined;
  }

  // Determine navigation type
  const navType = determineNavType(prev.url, curr.url);

  return {
    from: { url: prev.url, title: prev.title },
    to: { url: curr.url, title: curr.title },
    nav_type: navType,
  };
}

/**
 * Determine navigation type (soft vs hard).
 * Soft: Same pathname, different hash/search
 * Hard: Different pathname
 *
 * @param prevUrl - Previous URL
 * @param currUrl - Current URL
 * @returns Navigation type
 */
function determineNavType(prevUrl: string, currUrl: string): 'soft' | 'hard' {
  try {
    const prev = new URL(prevUrl);
    const curr = new URL(currUrl);

    // Different pathname = hard navigation
    if (prev.pathname !== curr.pathname) {
      return 'hard';
    }

    // Same pathname = soft navigation
    return 'soft';
  } catch {
    // URL parsing failed, assume hard navigation
    return 'hard';
  }
}

// ============================================================================
// Layer Change Detection
// ============================================================================

/**
 * Detect if layer stack changed.
 *
 * @param prev - Previous snapshot
 * @param curr - Current snapshot
 * @returns Layer change or undefined
 */
function detectLayerChange(
  prev: BaseSnapshot,
  curr: BaseSnapshot
): DiffResponse['diff']['layer'] {
  const prevLayers = detectLayers(prev);
  const currLayers = detectLayers(curr);

  // Compare stacks
  const prevStack = prevLayers.stack.map((l) => l.type);
  const currStack = currLayers.stack.map((l) => l.type);

  if (arraysEqual(prevStack, currStack)) {
    return undefined;
  }

  return {
    stack_from: prevStack,
    stack_to: currStack,
  };
}

/**
 * Check if two arrays are equal.
 */
function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Atomic Diffs
// ============================================================================

/**
 * Compute atomic state diffs (viewport, scroll, loading, forms, notifications).
 *
 * @param prev - Previous snapshot
 * @param curr - Current snapshot
 * @returns Array of atom changes
 */
function computeAtomicDiffs(prev: BaseSnapshot, curr: BaseSnapshot): AtomChange[] {
  const prevAtoms = extractAtoms(prev);
  const currAtoms = extractAtoms(curr);

  const changes: AtomChange[] = [];

  // Compare viewport
  if (prevAtoms.viewport.w !== currAtoms.viewport.w) {
    changes.push({ k: 'viewport.w', from: prevAtoms.viewport.w, to: currAtoms.viewport.w });
  }
  if (prevAtoms.viewport.h !== currAtoms.viewport.h) {
    changes.push({ k: 'viewport.h', from: prevAtoms.viewport.h, to: currAtoms.viewport.h });
  }

  // Compare scroll
  if (prevAtoms.scroll.x !== currAtoms.scroll.x) {
    changes.push({ k: 'scroll.x', from: prevAtoms.scroll.x, to: currAtoms.scroll.x });
  }
  if (prevAtoms.scroll.y !== currAtoms.scroll.y) {
    changes.push({ k: 'scroll.y', from: prevAtoms.scroll.y, to: currAtoms.scroll.y });
  }

  // Compare loading
  if (prevAtoms.loading?.spinners !== currAtoms.loading?.spinners) {
    changes.push({
      k: 'loading.spinners',
      from: prevAtoms.loading?.spinners,
      to: currAtoms.loading?.spinners,
    });
  }

  // Compare forms
  if (prevAtoms.forms?.focused_field !== currAtoms.forms?.focused_field) {
    changes.push({
      k: 'forms.focused_field',
      from: prevAtoms.forms?.focused_field,
      to: currAtoms.forms?.focused_field,
    });
  }
  if (prevAtoms.forms?.validation_errors !== currAtoms.forms?.validation_errors) {
    changes.push({
      k: 'forms.validation_errors',
      from: prevAtoms.forms?.validation_errors,
      to: currAtoms.forms?.validation_errors,
    });
  }

  // Compare notifications
  if (prevAtoms.notifications?.toasts !== currAtoms.notifications?.toasts) {
    changes.push({
      k: 'notifications.toasts',
      from: prevAtoms.notifications?.toasts,
      to: currAtoms.notifications?.toasts,
    });
  }

  return changes;
}
