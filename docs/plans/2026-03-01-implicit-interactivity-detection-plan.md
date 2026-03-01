# Implicit Interactivity Detection — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable agents to click non-semantic HTML elements (`<tr>`, `<div>`, `<span>`) that have JavaScript click handlers by detecting implicit interactivity signals during snapshot compilation.

**Architecture:** A new extractor module (`interactivity-detector.ts`) detects click listeners, cursor:pointer, and tabindex signals on non-interactive elements via CDP. Qualifying elements get `implicitly_interactive: true` on `ReadableNode`, which makes the element registry and actionables filter treat them as clickable. No new `NodeKind` values — elements keep their original kind but gain the flag.

**Tech Stack:** TypeScript, CDP (DOMDebugger, CSS, DOM domains), Vitest

**Design doc:** `docs/plans/2026-03-01-implicit-interactivity-detection.md`

---

## Critical Context

There are **two distinct cases** for non-interactive elements:

1. **Case A — Already in snapshot:** Elements with readable AX roles (`row`, `cell`, `table`, `listitem`, `image`, etc.) are included in `nodesToProcess` but NOT registered because `isInteractiveKind(kind)` is false. Example: `<tr>` with AX role `row` → `mapRoleToKind('row')` returns undefined → kind='generic' → not registered.

2. **Case B — Not in snapshot at all:** Elements with `classifyAxRole` returning `'unknown'` (AX roles like `generic`, `none`, or unmapped roles) are dropped in Phase 2 entirely. Example: `<div>` with AX role `generic` → classification='unknown' → excluded from `nodesToProcess`.

Phase 2.5 must handle both: flag Case A elements and add+flag Case B elements.

---

### Task 1: Add Type Definitions

**Files:**

- Modify: `src/snapshot/extractors/types.ts:142-154` (add to `RawNodeData`)
- Modify: `src/snapshot/snapshot.types.ts:95-131` (add to `ReadableNode`)
- Test: `tests/unit/snapshot/extractors/types.test.ts`

**Step 1: Write failing test for InteractivitySignals type**

Add to `tests/unit/snapshot/extractors/types.test.ts`:

```typescript
import type {
  InteractivitySignals,
  RawNodeData,
} from '../../../../src/snapshot/extractors/types.js';

describe('InteractivitySignals', () => {
  it('should be assignable to RawNodeData.interactivity', () => {
    const signals: InteractivitySignals = {
      has_click_listener: true,
      has_cursor_pointer: false,
      has_tabindex: false,
      listener_source: 'self',
    };

    const nodeData: RawNodeData = {
      backendNodeId: 42,
      interactivity: signals,
    };

    expect(nodeData.interactivity).toBeDefined();
    expect(nodeData.interactivity!.has_click_listener).toBe(true);
    expect(nodeData.interactivity!.listener_source).toBe('self');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/snapshot/extractors/types.test.ts -t "InteractivitySignals"`
Expected: FAIL — `InteractivitySignals` type doesn't exist

**Step 3: Add InteractivitySignals type to extractors/types.ts**

In `src/snapshot/extractors/types.ts`, add after the `RawNodeData` interface (after line 154):

```typescript
/**
 * Implicit interactivity detection result for a node.
 */
export interface InteractivitySignals {
  /** Element has click/mousedown/pointerdown event listener */
  has_click_listener: boolean;
  /** Element has CSS cursor: pointer */
  has_cursor_pointer: boolean;
  /** Element has tabindex >= 0 */
  has_tabindex: boolean;
  /** Where the click listener was found */
  listener_source: 'self' | 'ancestor' | 'none';
}
```

Add `interactivity` field to existing `RawNodeData` interface (line ~142):

```typescript
export interface RawNodeData {
  domNode?: RawDomNode;
  axNode?: RawAxNode;
  layout?: NodeLayoutInfo;
  backendNodeId: number;
  /** Implicit interactivity detection result */
  interactivity?: InteractivitySignals;
}
```

**Step 4: Add implicitly_interactive to ReadableNode**

In `src/snapshot/snapshot.types.ts`, add to the `ReadableNode` interface (after `attributes` field, ~line 131):

```typescript
  /** True if element has implicit interactivity signals (click listeners, cursor:pointer, tabindex) */
  implicitly_interactive?: boolean;
```

Also update the `interactiveCount` logic in `src/snapshot/snapshot-compiler.ts` (lines 646-661) to count implicitly interactive nodes:

```typescript
const interactiveCount = nodes.filter(
  (n) =>
    [
      'button',
      'link',
      'input',
      'textarea',
      'select',
      'combobox',
      'checkbox',
      'radio',
      'switch',
      'slider',
      'tab',
      'menuitem',
    ].includes(n.kind) || n.implicitly_interactive
).length;
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/snapshot/extractors/types.test.ts -t "InteractivitySignals"`
Expected: PASS

**Step 6: Run type-check**

Run: `npm run type-check`
Expected: No errors

**Step 7: Commit**

```bash
git add src/snapshot/extractors/types.ts src/snapshot/snapshot.types.ts src/snapshot/snapshot-compiler.ts tests/unit/snapshot/extractors/types.test.ts
git commit -m "feat: add InteractivitySignals type and implicitly_interactive field"
```

---

### Task 2: Create Interactivity Detector — Tabindex Detection

**Files:**

- Create: `src/snapshot/extractors/interactivity-detector.ts`
- Modify: `src/snapshot/extractors/index.ts` (re-export)
- Test: `tests/unit/snapshot/extractors/interactivity-detector.test.ts`

**Step 1: Write failing test for tabindex detection**

Create `tests/unit/snapshot/extractors/interactivity-detector.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractivity } from '../../../../src/snapshot/extractors/interactivity-detector.js';
import { createExtractorContext } from '../../../../src/snapshot/extractors/types.js';
import { createMockCdpClient, MockCdpClient } from '../../../mocks/cdp-client.mock.js';
import type { RawDomNode } from '../../../../src/snapshot/extractors/types.js';

describe('Interactivity Detector', () => {
  let mockCdp: MockCdpClient;

  beforeEach(() => {
    mockCdp = createMockCdpClient();
  });

  function makeDomNode(backendNodeId: number, attrs?: Record<string, string>): RawDomNode {
    return {
      nodeId: backendNodeId,
      backendNodeId,
      nodeName: 'DIV',
      nodeType: 1,
      attributes: attrs,
    };
  }

  describe('tabindex detection', () => {
    it('should detect tabindex=0 as interactive', async () => {
      const domNodes = new Map<number, RawDomNode>();
      domNodes.set(10, makeDomNode(10, { tabindex: '0' }));

      // Mock CDP calls that interactivity detector makes
      mockCdp.setResponse('DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [100] });
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [{ name: 'cursor', value: 'default' }],
      });
      mockCdp.setResponse('DOM.resolveNode', {
        object: { objectId: 'obj-10' },
      });
      mockCdp.setResponse('DOMDebugger.getEventListeners', { listeners: [] });
      mockCdp.setResponse('Runtime.releaseObject', {});

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await detectInteractivity(ctx, [10], domNodes);

      expect(result.has(10)).toBe(true);
      expect(result.get(10)!.has_tabindex).toBe(true);
    });

    it('should NOT detect tabindex=-1 as interactive', async () => {
      const domNodes = new Map<number, RawDomNode>();
      domNodes.set(10, makeDomNode(10, { tabindex: '-1' }));

      mockCdp.setResponse('DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [100] });
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [{ name: 'cursor', value: 'default' }],
      });
      mockCdp.setResponse('DOM.resolveNode', {
        object: { objectId: 'obj-10' },
      });
      mockCdp.setResponse('DOMDebugger.getEventListeners', { listeners: [] });
      mockCdp.setResponse('Runtime.releaseObject', {});

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await detectInteractivity(ctx, [10], domNodes);

      // No interactivity signals → should not be in result map
      expect(result.has(10)).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/snapshot/extractors/interactivity-detector.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Create interactivity-detector.ts with tabindex detection**

Create `src/snapshot/extractors/interactivity-detector.ts`:

```typescript
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
        computedStyle: Array<{ name: string; value: string }>;
      }>('CSS.getComputedStyleForNode', { nodeId });

      const cursorProp = styleResult.computedStyle.find((p) => p.name === 'cursor');
      if (cursorProp?.value === 'pointer') {
        signals.has_cursor_pointer = true;
      }
    } catch {
      // CSS check failed — continue with other signals
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
```

**Step 4: Add re-export to extractors/index.ts**

In `src/snapshot/extractors/index.ts`, add at the end:

```typescript
// Interactivity Detector
export { detectInteractivity } from './interactivity-detector.js';
```

Also add `InteractivitySignals` to the type exports:

```typescript
export type {
  RawDomNode,
  RawAxNode,
  AxProperty,
  AxPropertyValue,
  NodeLayoutInfo,
  RawNodeData,
  ExtractorContext,
  DomExtractionResult,
  AxExtractionResult,
  LayoutExtractionResult,
  InteractivitySignals,
} from './types.js';
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/snapshot/extractors/interactivity-detector.test.ts`
Expected: PASS

**Step 6: Run type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: No errors

**Step 7: Commit**

```bash
git add src/snapshot/extractors/interactivity-detector.ts src/snapshot/extractors/index.ts tests/unit/snapshot/extractors/interactivity-detector.test.ts
git commit -m "feat: add interactivity detector with tabindex detection"
```

---

### Task 3: Add Cursor Pointer and Event Listener Detection Tests

**Files:**

- Modify: `tests/unit/snapshot/extractors/interactivity-detector.test.ts`

**Step 1: Write failing tests for cursor:pointer and event listener detection**

Add to the existing test file:

```typescript
describe('cursor:pointer detection', () => {
  it('should detect cursor:pointer as interactive', async () => {
    const domNodes = new Map<number, RawDomNode>();
    domNodes.set(10, makeDomNode(10));

    mockCdp.setResponse('DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [100] });
    mockCdp.setResponse('CSS.getComputedStyleForNode', {
      computedStyle: [{ name: 'cursor', value: 'pointer' }],
    });
    mockCdp.setResponse('DOM.resolveNode', {
      object: { objectId: 'obj-10' },
    });
    mockCdp.setResponse('DOMDebugger.getEventListeners', { listeners: [] });
    mockCdp.setResponse('Runtime.releaseObject', {});

    const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
    const result = await detectInteractivity(ctx, [10], domNodes);

    expect(result.has(10)).toBe(true);
    expect(result.get(10)!.has_cursor_pointer).toBe(true);
  });
});

describe('event listener detection', () => {
  it('should detect click listener on self', async () => {
    const domNodes = new Map<number, RawDomNode>();
    domNodes.set(10, makeDomNode(10));

    mockCdp.setResponse('DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [100] });
    mockCdp.setResponse('CSS.getComputedStyleForNode', {
      computedStyle: [{ name: 'cursor', value: 'default' }],
    });
    mockCdp.setResponse('DOM.resolveNode', {
      object: { objectId: 'obj-10' },
    });
    mockCdp.setResponse('DOMDebugger.getEventListeners', {
      listeners: [
        {
          type: 'click',
          useCapture: false,
          passive: false,
          once: false,
          scriptId: '1',
          lineNumber: 1,
          columnNumber: 1,
        },
      ],
    });
    mockCdp.setResponse('Runtime.releaseObject', {});

    const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
    const result = await detectInteractivity(ctx, [10], domNodes);

    expect(result.has(10)).toBe(true);
    expect(result.get(10)!.has_click_listener).toBe(true);
    expect(result.get(10)!.listener_source).toBe('self');
  });

  it('should detect delegated click listener on ancestor', async () => {
    const domNodes = new Map<number, RawDomNode>();
    // Child (no listener) → Parent (has click listener)
    domNodes.set(10, makeDomNode(10));
    domNodes.get(10)!.parentId = 5;
    domNodes.set(5, makeDomNode(5));

    mockCdp.setResponse('DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [100] });
    mockCdp.setResponse('CSS.getComputedStyleForNode', {
      computedStyle: [{ name: 'cursor', value: 'default' }],
    });

    // Dynamic responses: self has no listeners, parent has click listener
    let resolveCallCount = 0;
    mockCdp.setResponse('DOM.resolveNode', (params) => {
      resolveCallCount++;
      const bid = (params as Record<string, unknown>).backendNodeId as number;
      return { object: { objectId: `obj-${bid}` } };
    });
    mockCdp.setResponse('DOMDebugger.getEventListeners', (params) => {
      const objId = (params as Record<string, unknown>).objectId as string;
      if (objId === 'obj-5') {
        // Parent has click listener
        return {
          listeners: [
            {
              type: 'click',
              useCapture: false,
              passive: false,
              once: false,
              scriptId: '1',
              lineNumber: 1,
              columnNumber: 1,
            },
          ],
        };
      }
      return { listeners: [] }; // Self has no listener
    });
    mockCdp.setResponse('Runtime.releaseObject', {});

    const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
    const result = await detectInteractivity(ctx, [10], domNodes);

    expect(result.has(10)).toBe(true);
    expect(result.get(10)!.has_click_listener).toBe(true);
    expect(result.get(10)!.listener_source).toBe('ancestor');
  });

  it('should detect mousedown and pointerdown as click events', async () => {
    const domNodes = new Map<number, RawDomNode>();
    domNodes.set(10, makeDomNode(10));

    mockCdp.setResponse('DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [100] });
    mockCdp.setResponse('CSS.getComputedStyleForNode', {
      computedStyle: [{ name: 'cursor', value: 'default' }],
    });
    mockCdp.setResponse('DOM.resolveNode', {
      object: { objectId: 'obj-10' },
    });
    mockCdp.setResponse('DOMDebugger.getEventListeners', {
      listeners: [
        {
          type: 'pointerdown',
          useCapture: false,
          passive: false,
          once: false,
          scriptId: '1',
          lineNumber: 1,
          columnNumber: 1,
        },
      ],
    });
    mockCdp.setResponse('Runtime.releaseObject', {});

    const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
    const result = await detectInteractivity(ctx, [10], domNodes);

    expect(result.has(10)).toBe(true);
    expect(result.get(10)!.has_click_listener).toBe(true);
  });

  it('should return empty map when no signals found', async () => {
    const domNodes = new Map<number, RawDomNode>();
    domNodes.set(10, makeDomNode(10));

    mockCdp.setResponse('DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [100] });
    mockCdp.setResponse('CSS.getComputedStyleForNode', {
      computedStyle: [{ name: 'cursor', value: 'default' }],
    });
    mockCdp.setResponse('DOM.resolveNode', {
      object: { objectId: 'obj-10' },
    });
    mockCdp.setResponse('DOMDebugger.getEventListeners', { listeners: [] });
    mockCdp.setResponse('Runtime.releaseObject', {});

    const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
    const result = await detectInteractivity(ctx, [10], domNodes);

    expect(result.size).toBe(0);
  });
});

describe('error resilience', () => {
  it('should handle CDP errors gracefully and still return tabindex results', async () => {
    const domNodes = new Map<number, RawDomNode>();
    domNodes.set(10, makeDomNode(10, { tabindex: '0' }));

    // pushNodes fails entirely
    mockCdp.setError('DOM.pushNodesByBackendIdsToFrontend', new Error('Target closed'));

    const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
    const result = await detectInteractivity(ctx, [10], domNodes);

    // Should still detect tabindex
    expect(result.has(10)).toBe(true);
    expect(result.get(10)!.has_tabindex).toBe(true);
  });

  it('should return empty map for empty candidateIds', async () => {
    const domNodes = new Map<number, RawDomNode>();

    const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
    const result = await detectInteractivity(ctx, [], domNodes);

    expect(result.size).toBe(0);
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/unit/snapshot/extractors/interactivity-detector.test.ts`
Expected: ALL PASS (implementation already handles these cases)

**Step 3: Commit**

```bash
git add tests/unit/snapshot/extractors/interactivity-detector.test.ts
git commit -m "test: add comprehensive tests for interactivity detector"
```

---

### Task 4: Integrate Interactivity Detection into Snapshot Compiler

**Files:**

- Modify: `src/snapshot/snapshot-compiler.ts:541-595` (Phase 2 → Phase 2.5)
- Modify: `src/snapshot/snapshot-compiler.ts:710-821` (transformNode)
- Test: `tests/unit/snapshot/snapshot-compiler.test.ts`

**Step 1: Write failing integration test**

Add to `tests/unit/snapshot/snapshot-compiler.test.ts`:

```typescript
describe('implicit interactivity detection', () => {
  it('should flag readable nodes with click listeners as implicitly interactive', async () => {
    // Setup: a <tr> with AX role 'row' (readable) that has a click handler
    // The node should end up in the snapshot with implicitly_interactive: true
    // ... (mock DOM with a table row, AX with role 'row',
    //      and DOMDebugger returning click listener)
    // Assert: snapshot.nodes should contain a node with
    //   kind: 'generic', implicitly_interactive: true
  });
});
```

The exact test setup depends on how the snapshot compiler test file is structured. Read the existing test file to match the pattern.

**Step 2: Implement Phase 2.5 in snapshot compiler**

In `src/snapshot/snapshot-compiler.ts`:

Add import at top:

```typescript
import { detectInteractivity } from './extractors/interactivity-detector.js';
import type { InteractivitySignals } from './extractors/types.js';
```

After Phase 2 (after the sorting block ~line 592, before `const limitedNodes`), add Phase 2.5:

```typescript
// Phase 2.5: Detect implicit interactivity on non-interactive nodes
// Also check unincluded AX nodes with unknown classification for interactivity
const nonInteractiveIds: number[] = [];
const interactiveKindSet = new Set([
  'button',
  'link',
  'input',
  'textarea',
  'select',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'tab',
  'menuitem',
]);

// Collect non-interactive nodes already in nodesToProcess (Case A)
for (const nodeData of nodesToProcess) {
  const kind = nodeData.axNode?.role
    ? (mapRoleToKind(nodeData.axNode.role) ?? 'generic')
    : 'generic';
  if (!interactiveKindSet.has(kind)) {
    nonInteractiveIds.push(nodeData.backendNodeId);
  }
}

// Collect unknown-classification AX nodes NOT yet in nodesToProcess (Case B)
const alreadyIncluded = new Set(nodesToProcess.map((n) => n.backendNodeId));
const caseB_candidates: number[] = [];
if (axResult) {
  for (const [backendNodeId, axNode] of axResult.nodes) {
    if (alreadyIncluded.has(backendNodeId)) continue;
    const classification = classifyAxRole(axNode.role);
    if (classification === 'unknown') {
      caseB_candidates.push(backendNodeId);
    }
  }
}

// Run interactivity detection on both sets
let interactivityMap = new Map<number, InteractivitySignals>();
const allCandidates = [...nonInteractiveIds, ...caseB_candidates];
if (allCandidates.length > 0 && domResult) {
  try {
    interactivityMap = await detectInteractivity(ctx, allCandidates, domResult.nodes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Interactivity detection failed: ${message}`);
  }
}

// Merge interactivity signals into existing nodes (Case A)
for (const nodeData of nodesToProcess) {
  const signals = interactivityMap.get(nodeData.backendNodeId);
  if (signals) {
    nodeData.interactivity = signals;
  }
}

// Add newly discovered interactive nodes (Case B)
for (const backendNodeId of caseB_candidates) {
  const signals = interactivityMap.get(backendNodeId);
  if (signals) {
    const domNode = domResult?.nodes.get(backendNodeId);
    const axNode = axResult?.nodes.get(backendNodeId);
    nodesToProcess.push({
      backendNodeId,
      domNode,
      axNode,
      interactivity: signals,
    });
  }
}

// Re-sort if we added Case B nodes (they need to be in DOM order)
if (caseB_candidates.some((id) => interactivityMap.has(id))) {
  if (domOrderAvailable && domOrderIndex) {
    const orderMap = domOrderIndex;
    nodesToProcess.sort((a, b) => {
      const orderA = orderMap.get(a.backendNodeId);
      const orderB = orderMap.get(b.backendNodeId);
      if (orderA === undefined && orderB === undefined) return 0;
      if (orderA === undefined) return 1;
      if (orderB === undefined) return -1;
      return orderA - orderB;
    });
  }
}
```

In the `transformNode` method (~line 710), after building the node object (~line 820), add:

```typescript
// Set implicitly_interactive flag
if (nodeData.interactivity) {
  const { has_click_listener, has_cursor_pointer, has_tabindex } = nodeData.interactivity;
  if (has_click_listener || has_cursor_pointer || has_tabindex) {
    node.implicitly_interactive = true;
  }
}
```

**Step 3: Run test to verify it passes**

Run: `npx vitest run tests/unit/snapshot/snapshot-compiler.test.ts`
Expected: PASS (including any new tests you wrote)

**Step 4: Run type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: No errors

**Step 5: Commit**

```bash
git add src/snapshot/snapshot-compiler.ts tests/unit/snapshot/snapshot-compiler.test.ts
git commit -m "feat: integrate interactivity detection into snapshot compiler (Phase 2.5)"
```

---

### Task 5: Expand Element Registry and Actionables Filter Gates

**Files:**

- Modify: `src/state/element-registry.ts:68-71` (registration gate)
- Modify: `src/state/actionables-filter.ts:61-65` (selection gate)
- Test: `tests/unit/state/element-registry.test.ts`
- Test: `tests/unit/state/actionables-filter.test.ts`

**Step 1: Write failing test for element registry**

Add to existing element registry test file (find it at `tests/unit/state/element-registry.test.ts`):

```typescript
describe('implicitly interactive elements', () => {
  it('should register nodes with implicitly_interactive: true', () => {
    const snapshot = createTestSnapshot([
      createTestNode({
        backend_node_id: 42,
        kind: 'generic',
        label: 'Anas Client 73',
        implicitly_interactive: true,
      }),
    ]);

    const registry = new ElementRegistry();
    const result = registry.updateFromSnapshot(snapshot, 'main');

    expect(result.added.length).toBe(1);
    // Should be resolvable by EID
    const eid = result.added[0];
    expect(registry.getByEid(eid)).toBeDefined();
    expect(registry.getByEid(eid)!.ref.backend_node_id).toBe(42);
  });

  it('should NOT register non-interactive nodes without implicitly_interactive flag', () => {
    const snapshot = createTestSnapshot([
      createTestNode({
        backend_node_id: 42,
        kind: 'generic',
        label: 'Just text',
        // No implicitly_interactive flag
      }),
    ]);

    const registry = new ElementRegistry();
    const result = registry.updateFromSnapshot(snapshot, 'main');

    expect(result.added.length).toBe(0);
  });
});
```

Note: You'll need to use or create helper functions `createTestSnapshot` and `createTestNode` that match the existing test patterns in the file. Read the existing tests to match the pattern.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/state/element-registry.test.ts -t "implicitly interactive"`
Expected: FAIL — generic nodes still not registered

**Step 3: Modify element registry gate**

In `src/state/element-registry.ts`, line 70, change:

```typescript
// Only track interactive elements
if (!isInteractiveKind(node.kind)) continue;
```

To:

```typescript
// Track interactive elements and implicitly interactive elements
if (!isInteractiveKind(node.kind) && !node.implicitly_interactive) continue;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/state/element-registry.test.ts -t "implicitly interactive"`
Expected: PASS

**Step 5: Write failing test for actionables filter**

Add to existing actionables filter test file:

```typescript
describe('implicitly interactive elements', () => {
  it('should include implicitly interactive nodes in actionables', () => {
    const snapshot = createTestSnapshot([
      createTestNode({
        backend_node_id: 42,
        kind: 'generic',
        label: 'Anas Client 73',
        implicitly_interactive: true,
        state: { visible: true, enabled: true },
        where: { region: 'main' },
      }),
    ]);

    const result = selectActionables(snapshot, 'main', 100);

    expect(result.length).toBe(1);
    expect(result[0].label).toBe('Anas Client 73');
  });
});
```

**Step 6: Modify actionables filter gate**

In `src/state/actionables-filter.ts`, line 63, change:

```typescript
if (!isInteractiveKind(node.kind)) {
  return false;
}
```

To:

```typescript
if (!isInteractiveKind(node.kind) && !node.implicitly_interactive) {
  return false;
}
```

**Step 7: Run all tests**

Run: `npx vitest run tests/unit/state/`
Expected: ALL PASS

**Step 8: Run type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: No errors

**Step 9: Commit**

```bash
git add src/state/element-registry.ts src/state/actionables-filter.ts tests/unit/state/
git commit -m "feat: expand registry and actionables filter to include implicitly interactive elements"
```

---

### Task 6: Add Kind Attribute to XML Renderer for Non-Standard Elements

**Files:**

- Modify: `src/state/state-renderer.ts:246-267` (renderActionable function)
- Test: `tests/unit/state/state-renderer.test.ts` (if exists)

**Step 1: Understand the current rendering**

The `renderActionable` function (line 246) renders elements like `<btn id="...">Label</btn>`. For implicitly interactive elements with kind='generic', `mapKindToTag('generic')` returns `'elt'`. The element renders as `<elt id="...">Label</elt>`.

The problem: the agent doesn't know what kind of element this is (row? cell? div?). We should add a `kind` attribute when the tag is `<elt>` to give context.

**Step 2: Write failing test**

Add to state renderer tests:

```typescript
it('should render kind attribute for non-standard interactive elements', () => {
  const actionable: ActionableInfo = {
    eid: 'abc123def456',
    kind: 'generic',
    name: 'Anas Client 73',
    role: 'row',
    vis: true,
    ena: true,
    ref: { snapshot_id: 'snap-1', backend_node_id: 42 },
    ctx: { region: 'main' },
    // ... other required fields
  };

  // The rendered output should include kind="row"
  // Expected: <elt id="abc123def456" kind="row">Anas Client 73</elt>
});
```

**Step 3: Modify renderActionable**

In `src/state/state-renderer.ts`, in the `renderActionable` function (~line 246), after the tag is determined, add the kind attribute for `<elt>` tags:

```typescript
function renderActionable(item: ActionableInfo, _diff?: StateResponseObject['diff']): string {
  const tag = mapKindToTag(item.kind);
  const attrs: string[] = [`id="${item.eid}"`];

  // Add kind attribute for non-standard tags to give the agent context
  if (tag === 'elt' && item.role && item.role !== 'none') {
    attrs.push(`kind="${escapeXml(item.role)}"`);
  }

  // ... rest of existing code unchanged ...
```

This uses `item.role` (the AX role like 'row', 'cell', 'generic') rather than `item.kind` (the NodeKind). This gives the agent the most useful semantic hint.

**Step 4: Run tests**

Run: `npx vitest run tests/unit/state/`
Expected: PASS

**Step 5: Run type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: No errors

**Step 6: Commit**

```bash
git add src/state/state-renderer.ts tests/unit/state/
git commit -m "feat: render kind attribute for implicitly interactive elements in XML output"
```

---

### Task 7: Fix Existing Tests and Run Full Suite

**Files:**

- Various test files that may need `implicitly_interactive` handling

**Step 1: Run full test suite**

Run: `npm test`

Look for failures related to:

- Snapshot shape changes (new `implicitly_interactive` field)
- `interactiveCount` changes in meta
- Registry behavior changes

**Step 2: Fix any failing tests**

Most fixes will be one of:

- Adding `implicitly_interactive: undefined` to test snapshots that check exact shapes
- Updating `interactiveCount` expectations
- Mock CDP responses for the new `detectInteractivity` calls during snapshot compilation

**Step 3: Run full quality checks**

Run: `npm run check`
Expected: ALL PASS (type-check + lint + format:check + test)

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: update existing tests for implicit interactivity changes"
```

---

### Task 8: Manual E2E Verification

**This task requires the user to restart the Claude session with the dev build.**

**Step 1: Build the project**

Run: `npm run build`

**Step 2: Ask user to restart session**

Ask the user to restart their Claude session so the dev MCP server picks up the new build.

**Step 3: Test with a real page**

Use `navigate` to go to a page with clickable table rows or divs. Verify:

1. `find_elements` returns proper EIDs (not `unknown-*`) for clickable rows
2. `click(eid=...)` on those elements succeeds
3. The XML snapshot output shows `<elt id="..." kind="row">` for implicitly interactive elements
4. Performance is acceptable (snapshot time doesn't increase dramatically)

**Step 4: Final commit if any adjustments needed**

---

## Summary of All Commits

1. `feat: add InteractivitySignals type and implicitly_interactive field`
2. `feat: add interactivity detector with tabindex detection`
3. `test: add comprehensive tests for interactivity detector`
4. `feat: integrate interactivity detection into snapshot compiler (Phase 2.5)`
5. `feat: expand registry and actionables filter to include implicitly interactive elements`
6. `feat: render kind attribute for implicitly interactive elements in XML output`
7. `fix: update existing tests for implicit interactivity changes`
