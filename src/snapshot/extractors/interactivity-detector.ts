/**
 * Interactivity Detector
 *
 * Detects implicit interactivity signals on non-semantic elements:
 * - Event listeners (click/mousedown/pointerdown) on self or ancestors
 * - CSS cursor: pointer
 * - tabindex >= 0
 *
 * @module snapshot/extractors/interactivity-detector
 *
 * CDP Domains:
 * - DOM: pushNodesByBackendIdsToFrontend, resolveNode
 * - CSS: getComputedStyleForNode
 * - DOMDebugger: getEventListeners
 * - Runtime: releaseObject
 */

import type { ExtractorContext, RawDomNode, InteractivitySignals } from './types.js';

/** Event types that indicate click interactivity */
const CLICK_EVENT_TYPES = new Set(['click', 'mousedown', 'pointerdown']);

/** Maximum ancestor levels to walk for delegated event detection */
const MAX_ANCESTOR_DEPTH = 5;

/**
 * CDP event listener structure from DOMDebugger.getEventListeners
 */
interface CdpEventListener {
  type: string;
  useCapture: boolean;
  passive: boolean;
  once: boolean;
  scriptId: string;
  lineNumber: number;
  columnNumber: number;
  handler?: { objectId?: string };
}

/**
 * Detect implicit interactivity signals on non-interactive elements.
 *
 * @param ctx - Extractor context with CDP client
 * @param candidateIds - backendNodeIds of non-interactive nodes to check
 * @param domNodes - DOM tree for attribute lookup and ancestor walking
 * @returns Map of backendNodeId → InteractivitySignals (only for nodes with positive signals)
 */
export async function detectInteractivity(
  ctx: ExtractorContext,
  candidateIds: number[],
  domNodes: Map<number, RawDomNode>
): Promise<Map<number, InteractivitySignals>> {
  const results = new Map<number, InteractivitySignals>();

  if (candidateIds.length === 0) return results;

  const { cdp } = ctx;

  // Phase 1: Check tabindex from DOM attributes (free — no CDP calls)
  const tabindexResults = new Map<number, boolean>();
  for (const id of candidateIds) {
    const domNode = domNodes.get(id);
    if (domNode?.attributes?.tabindex !== undefined) {
      const tabindex = parseInt(domNode.attributes.tabindex, 10);
      tabindexResults.set(id, !isNaN(tabindex) && tabindex >= 0);
    }
  }

  // Phase 2: Batch resolve backendNodeIds → nodeIds for CSS and event listener checks
  let nodeIdMap: Map<number, number>;
  try {
    const pushResult = await cdp.send<{ nodeIds: number[] }>(
      'DOM.pushNodesByBackendIdsToFrontend',
      { backendNodeIds: candidateIds }
    );
    nodeIdMap = new Map<number, number>();
    for (let i = 0; i < candidateIds.length; i++) {
      if (pushResult.nodeIds[i] !== 0) {
        nodeIdMap.set(candidateIds[i], pushResult.nodeIds[i]);
      }
    }
  } catch {
    // If push fails, return what we have from tabindex
    for (const [id, hasTabindex] of tabindexResults) {
      if (hasTabindex) {
        results.set(id, {
          has_click_listener: false,
          has_cursor_pointer: false,
          has_tabindex: true,
          listener_source: 'none',
        });
      }
    }
    return results;
  }

  // Phase 3: Check cursor:pointer and event listeners for each candidate
  // Cache ancestor listener results to avoid redundant checks
  const ancestorListenerCache = new Map<number, boolean>();

  for (const backendNodeId of candidateIds) {
    const nodeId = nodeIdMap.get(backendNodeId);
    if (!nodeId) continue;

    const signals: InteractivitySignals = {
      has_click_listener: false,
      has_cursor_pointer: false,
      has_tabindex: tabindexResults.get(backendNodeId) ?? false,
      listener_source: 'none',
    };

    // Check cursor:pointer
    try {
      const styleResult = await cdp.send<{
        computedStyle: { name: string; value: string }[];
      }>('CSS.getComputedStyleForNode', { nodeId });

      const cursorProp = styleResult.computedStyle.find((p) => p.name === 'cursor');
      if (cursorProp?.value === 'pointer') {
        signals.has_cursor_pointer = true;
      }
    } catch {
      // CSS check failed — continue with other signals
    }

    // Short-circuit: skip expensive listener checks if we already have a positive signal
    if (signals.has_cursor_pointer || signals.has_tabindex) {
      results.set(backendNodeId, signals);
      continue;
    }

    // Check event listeners on self
    let objectId: string | undefined;
    try {
      const resolveResult = await cdp.send<{ object: { objectId?: string } }>('DOM.resolveNode', {
        backendNodeId,
      });
      objectId = resolveResult.object.objectId;

      if (objectId) {
        const listenersResult = await cdp.send<{ listeners: CdpEventListener[] }>(
          'DOMDebugger.getEventListeners',
          { objectId }
        );

        const hasClickListener = listenersResult.listeners.some((l) =>
          CLICK_EVENT_TYPES.has(l.type)
        );

        if (hasClickListener) {
          signals.has_click_listener = true;
          signals.listener_source = 'self';
        }
      }
    } catch {
      // Resolve or listener check failed — continue
    } finally {
      // Release the remote object to prevent memory leaks
      if (objectId) {
        try {
          await cdp.send('Runtime.releaseObject', { objectId });
        } catch {
          // Ignore release failures
        }
      }
    }

    // Check ancestor event listeners (if no self listener found)
    if (!signals.has_click_listener) {
      const hasAncestorListener = await checkAncestorListeners(
        cdp,
        backendNodeId,
        domNodes,
        ancestorListenerCache
      );
      if (hasAncestorListener) {
        signals.has_click_listener = true;
        signals.listener_source = 'ancestor';
      }
    }

    // Only add to results if any signal is positive
    if (signals.has_click_listener || signals.has_cursor_pointer || signals.has_tabindex) {
      results.set(backendNodeId, signals);
    }
  }

  return results;
}

/**
 * Walk up ancestor chain checking for delegated click listeners.
 * Results are cached to avoid redundant CDP calls when siblings share parents.
 */
async function checkAncestorListeners(
  cdp: ExtractorContext['cdp'],
  backendNodeId: number,
  domNodes: Map<number, RawDomNode>,
  cache: Map<number, boolean>
): Promise<boolean> {
  let currentId = backendNodeId;

  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth++) {
    const domNode = domNodes.get(currentId);
    const parentId = domNode?.parentId;
    if (parentId === undefined) break;

    // Check cache first
    if (cache.has(parentId)) {
      return cache.get(parentId)!;
    }

    // Check parent's event listeners
    let objectId: string | undefined;
    try {
      const resolveResult = await cdp.send<{ object: { objectId?: string } }>('DOM.resolveNode', {
        backendNodeId: parentId,
      });
      objectId = resolveResult.object.objectId;

      if (objectId) {
        const listenersResult = await cdp.send<{ listeners: CdpEventListener[] }>(
          'DOMDebugger.getEventListeners',
          { objectId }
        );

        const hasClickListener = listenersResult.listeners.some((l) =>
          CLICK_EVENT_TYPES.has(l.type)
        );

        cache.set(parentId, hasClickListener);

        if (hasClickListener) {
          return true;
        }
      }
    } catch {
      cache.set(parentId, false);
    } finally {
      if (objectId) {
        try {
          await cdp.send('Runtime.releaseObject', { objectId });
        } catch {
          // Ignore release failures
        }
      }
    }

    currentId = parentId;
  }

  return false;
}
