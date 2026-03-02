# Portal/Overlay Content Missing from Snapshots — Fix Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix portal-rendered dropdown options and overlay content (popovers, drawers) so they appear correctly in page snapshots and actionables.

**Architecture:** Three-part fix: (1) Fix `getNodeLayer()` so popover/drawer active layers don't filter ALL actionables to zero, (2) Prioritize overlay content in the `max_nodes` budget so portal-rendered elements aren't truncated on heavy pages, (3) Add integration test to verify end-to-end.

**Tech Stack:** TypeScript, Vitest, CDP (Chrome DevTools Protocol)

---

## Background / Root Cause

Three issues cause portal-rendered content to disappear from snapshots:

**Bug 1 — `getNodeLayer()` layer mismatch (CRITICAL):** Three copies of `getNodeLayer()` exist (in `actionables-filter.ts:193-204`, `state-manager.ts:791-794`, `locator-generator.ts:78-81`). All only map `region='dialog'` → `'modal'`, everything else → `'main'`. When the layer detector detects an active `'popover'` layer (e.g., listbox with z-index > 100), the filter `getNodeLayer(n) === 'popover'` is `false` for EVERY node → zero actionables.

**Bug 2 — `max_nodes` truncation:** Portal content is appended to `document.body` end → last in DOM order → first to be truncated when `max_nodes: 2000` is hit. On heavy pages (MUI docs), this cuts off dropdown options entirely.

**Non-bug — State renderer already correct:** `state-renderer.ts:208` has `OVERLAY_LAYERS = new Set(['modal', 'popover', 'drawer'])` and correctly bypasses diff filtering for overlay layers. The bug is upstream in `selectActionables()`.

---

### Task 1: Extract and fix `getNodeLayer()` — DRY + layer-aware

Currently three identical broken copies. Extract to a single shared function that handles popover/drawer layers.

**Files:**

- Create: `src/state/node-layer.ts`
- Modify: `src/state/actionables-filter.ts:1-8,73,193-204` (remove local `getNodeLayer`, import shared)
- Modify: `src/state/state-manager.ts:286,437,445,585,791-795` (remove local `getNodeLayer`, import shared)
- Modify: `src/state/locator-generator.ts:56,78-81` (remove local `getNodeLayer`, import shared)
- Test: `tests/unit/state/node-layer.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/state/node-layer.test.ts`:

```typescript
/**
 * Node Layer Assignment Tests
 *
 * Tests for getNodeLayer — assigns nodes to layers (main, modal, popover, drawer).
 */

import { describe, it, expect } from 'vitest';
import { getNodeLayer } from '../../../src/state/node-layer.js';
import type { ReadableNode } from '../../../src/snapshot/snapshot.types.js';

function makeNode(overrides: Partial<ReadableNode> = {}): ReadableNode {
  return {
    node_id: '1',
    backend_node_id: 100,
    frame_id: 'main',
    loader_id: 'loader-1',
    kind: 'button',
    label: 'Test',
    where: { region: 'main' },
    layout: { bbox: { x: 0, y: 0, w: 100, h: 40 } },
    state: { visible: true, enabled: true },
    find: { primary: '#test', alternates: [] },
    ...overrides,
  } as ReadableNode;
}

describe('getNodeLayer', () => {
  it('should return "main" for nodes in main region', () => {
    const node = makeNode({ where: { region: 'main' } });
    expect(getNodeLayer(node)).toBe('main');
  });

  it('should return "modal" for nodes in dialog region', () => {
    const node = makeNode({ where: { region: 'dialog' } });
    expect(getNodeLayer(node)).toBe('modal');
  });

  it('should return "main" for nodes with unknown region (default)', () => {
    const node = makeNode({ where: { region: 'unknown' } });
    expect(getNodeLayer(node)).toBe('main');
  });

  describe('with activeLayer context', () => {
    it('should return "popover" for high z-index nodes when activeLayer is popover', () => {
      const node = makeNode({
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 200, h: 300 }, zIndex: 1300 },
      });
      expect(getNodeLayer(node, 'popover')).toBe('popover');
    });

    it('should return "drawer" for high z-index nodes when activeLayer is drawer', () => {
      const node = makeNode({
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 200, h: 300 }, zIndex: 500 },
      });
      expect(getNodeLayer(node, 'drawer')).toBe('drawer');
    });

    it('should still return "main" for low z-index nodes when activeLayer is popover', () => {
      const node = makeNode({
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 200, h: 300 }, zIndex: undefined },
      });
      expect(getNodeLayer(node, 'popover')).toBe('main');
    });

    it('should return "modal" for dialog region regardless of activeLayer', () => {
      const node = makeNode({ where: { region: 'dialog' } });
      expect(getNodeLayer(node, 'popover')).toBe('modal');
    });

    it('should return "main" for nodes when activeLayer is main (no change)', () => {
      const node = makeNode({
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 200, h: 300 }, zIndex: 1300 },
      });
      expect(getNodeLayer(node, 'main')).toBe('main');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/state/node-layer.test.ts`
Expected: FAIL — module `src/state/node-layer.ts` does not exist

**Step 3: Create the shared `getNodeLayer` module**

Create `src/state/node-layer.ts`:

```typescript
/**
 * Node Layer Assignment
 *
 * Determines which UI layer a node belongs to.
 * Used by actionables filter, state manager, and locator generator.
 *
 * Layer assignment logic:
 * - Nodes in 'dialog' region → 'modal' layer (always, regardless of activeLayer)
 * - When activeLayer is 'popover' or 'drawer': nodes with z-index > 0 → activeLayer
 * - Everything else → 'main'
 */

import type { ReadableNode } from '../snapshot/snapshot.types.js';

/**
 * Z-index threshold for assigning nodes to overlay layers.
 * Nodes with z-index above this are considered part of the active overlay.
 * This is deliberately low — the layer detector already validated the overlay exists;
 * we just need to distinguish overlay content from background content.
 */
const OVERLAY_Z_INDEX_THRESHOLD = 1;

/** Layer types that use z-index to claim nodes */
const Z_INDEX_OVERLAY_LAYERS = new Set(['popover', 'drawer']);

/**
 * Determine which layer a node belongs to.
 *
 * @param node - ReadableNode to classify
 * @param activeLayer - Currently active layer from layer detector (optional).
 *   When provided, enables z-index-based assignment for popover/drawer layers.
 * @returns Layer name: 'main', 'modal', 'popover', or 'drawer'
 */
export function getNodeLayer(node: ReadableNode, activeLayer?: string): string {
  const region = node.where.region ?? 'unknown';

  // Dialog region always maps to modal layer
  if (region === 'dialog') {
    return 'modal';
  }

  // When active layer is popover/drawer, use z-index to determine membership.
  // The layer detector already confirmed an overlay exists (via role + z-index check).
  // Nodes with any positive z-index are likely part of the overlay or its backdrop.
  if (activeLayer && Z_INDEX_OVERLAY_LAYERS.has(activeLayer)) {
    const zIndex = node.layout.zIndex;
    if (zIndex !== undefined && zIndex > OVERLAY_Z_INDEX_THRESHOLD) {
      return activeLayer;
    }
  }

  return 'main';
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/state/node-layer.test.ts`
Expected: PASS

**Step 5: Replace all three `getNodeLayer` copies with the shared import**

In `src/state/actionables-filter.ts`:

- Add import: `import { getNodeLayer } from './node-layer.js';`
- Remove the local `getNodeLayer` function (lines 180-204)
- Update `selectActionables` to pass `activeLayer` to `getNodeLayer`:
  - Line 73: `const nodeLayer = getNodeLayer(node);` → `const nodeLayer = getNodeLayer(node, activeLayer);`

In `src/state/state-manager.ts`:

- Add import: `import { getNodeLayer } from './node-layer.js';`
- Remove the local `getNodeLayer` function (lines 791-794)
- Update all call sites to pass `activeLayer`:
  - Line 286: `getNodeLayer(n) === layerResult.active` → `getNodeLayer(n, layerResult.active) === layerResult.active`
  - Line 437: `getNodeLayer(n) === activeLayer` → `getNodeLayer(n, activeLayer) === activeLayer`
  - Line 445: `getNodeLayer(node) !== activeLayer` → `getNodeLayer(node, activeLayer) !== activeLayer`
  - Line 585: `layer: getNodeLayer(node),` → `layer: getNodeLayer(node, activeLayer),`

In `src/state/locator-generator.ts`:

- Add import: `import { getNodeLayer } from './node-layer.js';`
- Remove the local `getNodeLayer` function (lines 78-81)
- Line 56 call site already passes `layer` parameter, no change needed to the caller

**Step 6: Run existing tests to verify nothing breaks**

Run: `npx vitest run tests/unit/state/`
Expected: All PASS

**Step 7: Run type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: PASS

**Step 8: Commit**

```bash
git add src/state/node-layer.ts tests/unit/state/node-layer.test.ts \
  src/state/actionables-filter.ts src/state/state-manager.ts src/state/locator-generator.ts
git commit -m "fix: extract and fix getNodeLayer to handle popover/drawer layers

getNodeLayer() only mapped dialog→modal, everything else→main.
When layer detector detected popover/drawer as active, ALL actionables
were filtered to zero because no node's layer matched.

Fix: DRY extraction to shared module with z-index-based overlay assignment.
When activeLayer is popover/drawer, nodes with z-index > 1 are assigned
to the active overlay layer."
```

---

### Task 2: Fix actionables filter to handle popover/drawer active layers

The actionables filter in `selectActionables` and `selectActionablesWithFocusGuarantee` use `getNodeLayer()` to scope nodes. With Task 1's fix, popover/drawer nodes will now be correctly assigned. But we also need to ensure the filter behavior is correct when an overlay is active — specifically, we should include BOTH overlay and main content so the agent can see everything.

**Files:**

- Modify: `src/state/actionables-filter.ts:54-92`
- Test: `tests/unit/state/actionables-filter.test.ts` (add new test cases)

**Step 1: Write failing tests for popover layer handling**

Add to `tests/unit/state/actionables-filter.test.ts`:

```typescript
describe('layer filtering', () => {
  it('should include all visible elements when activeLayer is main', () => {
    const snapshot = createTestSnapshot([
      {
        kind: 'button',
        label: 'Submit',
        where: { region: 'main' },
        state: { visible: true, enabled: true },
      },
      {
        kind: 'link',
        label: 'Cancel',
        where: { region: 'main' },
        state: { visible: true, enabled: true },
      },
    ]);

    const result = selectActionables(snapshot, 'main', 100);
    expect(result.length).toBe(2);
  });

  it('should include all visible elements when activeLayer is popover', () => {
    const snapshot = createTestSnapshot([
      {
        kind: 'button',
        label: 'Main Button',
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 100, h: 40 } },
        state: { visible: true, enabled: true },
      },
      {
        kind: 'menuitem',
        label: 'Option 1',
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 50, w: 200, h: 30 }, zIndex: 1300 },
        state: { visible: true, enabled: true },
      },
      {
        kind: 'menuitem',
        label: 'Option 2',
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 80, w: 200, h: 30 }, zIndex: 1300 },
        state: { visible: true, enabled: true },
      },
    ]);

    // When popover is active, both main and popover elements should be included
    const result = selectActionables(snapshot, 'popover', 100);
    expect(result.length).toBe(3);
    expect(result.some((n) => n.label === 'Main Button')).toBe(true);
    expect(result.some((n) => n.label === 'Option 1')).toBe(true);
    expect(result.some((n) => n.label === 'Option 2')).toBe(true);
  });

  it('should only include modal elements when activeLayer is modal', () => {
    const snapshot = createTestSnapshot([
      {
        kind: 'button',
        label: 'Main Button',
        where: { region: 'main' },
        state: { visible: true, enabled: true },
      },
      {
        kind: 'button',
        label: 'Dialog OK',
        where: { region: 'dialog' },
        state: { visible: true, enabled: true },
      },
    ]);

    const result = selectActionables(snapshot, 'modal', 100);
    expect(result.length).toBe(1);
    expect(result[0].label).toBe('Dialog OK');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/state/actionables-filter.test.ts`
Expected: FAIL — popover test fails (0 elements instead of 3)

**Step 3: Update `selectActionables` to skip layer filtering for popover/drawer**

In `src/state/actionables-filter.ts`, modify the candidate filter (lines 61-79):

```typescript
// Overlay layers where we include all visible interactive elements
// (popover/drawer content coexists with main content — unlike modal which blocks)
const INCLUSIVE_OVERLAY_LAYERS = new Set(['popover', 'drawer']);

export function selectActionables(
  snapshot: BaseSnapshot,
  activeLayer: string,
  maxCount: number,
  context?: ScoringContext
): ReadableNode[] {
  const skipLayerFilter = INCLUSIVE_OVERLAY_LAYERS.has(activeLayer);

  // Filter to candidates
  const candidates = snapshot.nodes.filter((node) => {
    // Must be interactive
    if (!isInteractiveKind(node.kind) && !node.implicitly_interactive) {
      return false;
    }

    // Must be visible
    if (!node.state?.visible) {
      return false;
    }

    // Must be in active layer (skip for popover/drawer — content coexists with main)
    if (!skipLayerFilter) {
      const nodeLayer = getNodeLayer(node, activeLayer);
      if (nodeLayer !== activeLayer) {
        return false;
      }
    }

    return true;
  });

  // Score each candidate
  const scored = candidates.map((node) => ({
    node,
    score: scoreActionable(node, context),
  }));

  // Sort by score (highest first)
  scored.sort((a, b) => b.score - a.score);

  // Cap at maxCount
  return scored.slice(0, maxCount).map((s) => s.node);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/state/actionables-filter.test.ts`
Expected: All PASS

**Step 5: Update `selectActionablesWithFocusGuarantee` in `state-manager.ts`**

The same `INCLUSIVE_OVERLAY_LAYERS` logic should apply to the focus guarantee method.

In `src/state/state-manager.ts`, update `selectActionablesWithFocusGuarantee` (line 430-437):

```typescript
// Find focused element first
const skipLayerFilter = activeLayer === 'popover' || activeLayer === 'drawer';
const focusedNode = snapshot.nodes.find(
  (n) =>
    n.state?.focused &&
    isInteractiveKind(n.kind) &&
    n.state?.visible &&
    (skipLayerFilter || getNodeLayer(n, activeLayer) === activeLayer)
);
```

And lines 443-445 (close affordances):

```typescript
if (!isInteractiveKind(node.kind) || !node.state?.visible) continue;
if (!skipLayerFilter && getNodeLayer(node, activeLayer) !== activeLayer) continue;
```

Also update the `totalInLayer` count (line 285-287):

```typescript
const totalInLayer = snapshot.nodes.filter(
  (n) =>
    isInteractiveKind(n.kind) &&
    n.state?.visible &&
    (skipLayerFilter || getNodeLayer(n, layerResult.active) === layerResult.active)
).length;
```

Where `skipLayerFilter` is computed once at the top of `doGenerateResponse`:

```typescript
const skipLayerFilter = layerResult.active === 'popover' || layerResult.active === 'drawer';
```

**Step 6: Run all state tests**

Run: `npx vitest run tests/unit/state/`
Expected: All PASS

**Step 7: Run type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: PASS

**Step 8: Commit**

```bash
git add src/state/actionables-filter.ts src/state/state-manager.ts \
  tests/unit/state/actionables-filter.test.ts
git commit -m "fix: skip layer filtering for popover/drawer active layers

Popover/drawer content coexists with main content (unlike modals which
block). When these layers are active, include all visible interactive
elements instead of filtering to layer — which previously resulted in
zero actionables due to getNodeLayer mismatch."
```

---

### Task 3: Prioritize overlay content in `max_nodes` budget

Portal-rendered content appears at the end of DOM order (appended to `document.body`). On heavy pages, the `max_nodes: 2000` limit truncates it. Fix by reserving budget for high z-index overlay content.

**Files:**

- Modify: `src/snapshot/snapshot-compiler.ts:688-691`
- Test: `tests/unit/snapshot/snapshot-compiler-overlay-priority.test.ts`

**Step 1: Write failing test**

Create `tests/unit/snapshot/snapshot-compiler-overlay-priority.test.ts`:

```typescript
/**
 * Snapshot Compiler — Overlay Priority Tests
 *
 * Verifies that high z-index overlay content (portals, dropdowns)
 * is not truncated by max_nodes even on heavy pages.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SnapshotCompiler } from '../../../src/snapshot/snapshot-compiler.js';
import { createLinkedMocks } from '../../mocks/puppeteer.mock.js';

// Helper to create a CDP AX node
function axNode(id: number, role: string, name: string, ignored = false) {
  return {
    nodeId: `ax-${id}`,
    backendDOMNodeId: id,
    role: { type: 'role', value: role },
    name: { type: 'computedString', value: name },
    ignored,
    properties: [],
  };
}

// Helper to create a CDP DOM node
function domNode(
  nodeId: number,
  backendNodeId: number,
  nodeName: string,
  parentId?: number,
  attrs?: string[]
) {
  return {
    nodeId,
    backendNodeId,
    nodeType: 1,
    nodeName,
    children: [] as any[],
    attributes: attrs ?? [],
  };
}

describe('SnapshotCompiler overlay priority', () => {
  let mocks: ReturnType<typeof createLinkedMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createLinkedMocks();
  });

  it('should include high z-index overlay nodes even when max_nodes would truncate them', async () => {
    // Build a page with 5 buttons (main content) + 3 options (overlay portal at end of body)
    // With max_nodes=5, all 3 overlay options should still be included

    const rootDoc = domNode(1, 1, '#document');
    const html = domNode(2, 2, 'HTML', 1);
    const body = domNode(3, 3, 'BODY', 2);

    // 5 main content buttons
    const mainButtons = [];
    for (let i = 0; i < 5; i++) {
      mainButtons.push(domNode(10 + i, 10 + i, 'BUTTON', 3));
    }

    // 3 portal-rendered options at end of body
    const portalContainer = domNode(20, 20, 'DIV', 3);
    const portalOptions = [];
    for (let i = 0; i < 3; i++) {
      portalOptions.push(domNode(21 + i, 21 + i, 'LI', 20, ['role', 'option']));
    }

    // Wire up children
    body.children = [...mainButtons, portalContainer];
    portalContainer.children = portalOptions;
    html.children = [body];
    rootDoc.children = [html];

    // AX nodes: 5 buttons + 3 options
    const axNodes = [
      ...mainButtons.map((b, i) => axNode(b.backendNodeId, 'button', `Button ${i}`)),
      ...portalOptions.map((o, i) => axNode(o.backendNodeId, 'option', `Option ${i}`)),
    ];

    // Mock CDP responses
    mocks.cdpSession.send.mockImplementation(async (method: string, params?: any) => {
      if (method === 'DOM.getDocument') {
        return { root: rootDoc };
      }
      if (method === 'Accessibility.getFullAXTree') {
        return { nodes: axNodes };
      }
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: 'main', loaderId: 'l1' } } };
      }
      if (method === 'DOM.getBoxModel') {
        const id = params?.backendNodeId;
        // Portal options have high z-index layout (handled via batch extraction mock)
        return { model: { content: [0, 0, 100, 0, 100, 40, 0, 40], width: 100, height: 40 } };
      }
      if (method === 'Runtime.evaluate') {
        // Batch layout: return results for path-resolved nodes
        // Give portal options high z-index
        const items = JSON.parse(params?.expression?.match(/\)\((\[.*\])\)/)?.[1] ?? '[]');
        return {
          result: {
            value: items.map((item: any) => {
              const id = item.id;
              const isOverlay = id >= 21 && id <= 23;
              return {
                x: 0,
                y: 0,
                w: 100,
                h: 40,
                display: 'block',
                visibility: 'visible',
                zIndex: isOverlay ? 1300 : null,
              };
            }),
          },
        };
      }
      if (method === 'CSS.getComputedStyleForNode') {
        return { computedStyle: [] };
      }
      return {};
    });

    const compiler = new SnapshotCompiler({ max_nodes: 5 });
    const snapshot = await compiler.compile(mocks.cdpSession as any, mocks.page as any, 'page-1');

    // With max_nodes=5, we should get some main buttons AND the overlay options
    // Overlay options should NOT be truncated
    const optionNodes = snapshot.nodes.filter((n) => n.kind === 'menuitem');
    expect(optionNodes.length).toBeGreaterThan(0);

    // Verify overlay options are present
    const optionLabels = optionNodes.map((n) => n.label);
    expect(optionLabels).toContain('Option 0');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/snapshot/snapshot-compiler-overlay-priority.test.ts`
Expected: FAIL — overlay options truncated (only first 5 nodes in DOM order kept)

**Step 3: Implement overlay-aware max_nodes slicing**

In `src/snapshot/snapshot-compiler.ts`, replace the simple slice (line ~691) with overlay-aware partitioning:

```typescript
// Limit nodes (overlay-aware: reserve budget for high z-index content)
const limitedNodes = this.sliceWithOverlayPriority(nodesToProcess, this.options.max_nodes);
```

Add the method to the `SnapshotCompiler` class:

```typescript
/**
 * Slice nodes to max_nodes budget while preserving high z-index overlay content.
 *
 * Portal-rendered content (dropdowns, popovers, modals) appears at the end of
 * DOM order because it's appended to document.body. On heavy pages, a naive
 * slice truncates it. This method reserves budget for overlay content.
 *
 * Strategy:
 * 1. Partition nodes into overlay (z-index > threshold) and main
 * 2. Take all overlay nodes (up to 30% of budget)
 * 3. Fill remaining budget with main nodes (DOM order)
 */
private sliceWithOverlayPriority(nodes: RawNodeData[], maxNodes: number): RawNodeData[] {
  if (nodes.length <= maxNodes) {
    return nodes;
  }

  const OVERLAY_Z_THRESHOLD = 100;
  const MAX_OVERLAY_RATIO = 0.3; // Reserve up to 30% for overlay content

  // Partition: overlay vs main
  const overlayNodes: RawNodeData[] = [];
  const mainNodes: RawNodeData[] = [];

  for (const node of nodes) {
    const zIndex = node.layout?.zIndex;
    if (zIndex !== undefined && zIndex > OVERLAY_Z_THRESHOLD) {
      overlayNodes.push(node);
    } else {
      mainNodes.push(node);
    }
  }

  // If no overlay content, simple slice
  if (overlayNodes.length === 0) {
    return nodes.slice(0, maxNodes);
  }

  // Reserve budget for overlay (capped at 30% of total)
  const maxOverlay = Math.min(overlayNodes.length, Math.floor(maxNodes * MAX_OVERLAY_RATIO));
  const overlaySlice = overlayNodes.slice(0, maxOverlay);

  // Fill remaining budget with main content
  const mainBudget = maxNodes - overlaySlice.length;
  const mainSlice = mainNodes.slice(0, mainBudget);

  // Merge and re-sort by DOM order to maintain document position
  const merged = [...mainSlice, ...overlaySlice];
  if (this.options.includeLayout) {
    // Already sorted by DOM order in nodesToProcess; preserve that order
    // by using the original index as tiebreaker
    const indexMap = new Map(nodes.map((n, i) => [n.backendNodeId, i]));
    merged.sort((a, b) => {
      const ia = indexMap.get(a.backendNodeId) ?? Infinity;
      const ib = indexMap.get(b.backendNodeId) ?? Infinity;
      return ia - ib;
    });
  }

  return merged;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/snapshot/snapshot-compiler-overlay-priority.test.ts`
Expected: PASS

**Step 5: Run all existing snapshot tests**

Run: `npx vitest run tests/unit/snapshot/`
Expected: All PASS

**Step 6: Run type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: PASS

**Step 7: Commit**

```bash
git add src/snapshot/snapshot-compiler.ts \
  tests/unit/snapshot/snapshot-compiler-overlay-priority.test.ts
git commit -m "fix: prioritize overlay content in max_nodes budget

Portal-rendered content (dropdowns, popovers) is appended to body end,
making it last in DOM order and first to be truncated by max_nodes on
heavy pages. Reserve up to 30% of the node budget for high z-index
overlay content to prevent portal truncation."
```

---

### Task 4: Run full test suite and final verification

**Step 1: Run full check suite**

Run: `npm run check`
Expected: All checks pass (type-check + lint + format:check + test)

**Step 2: Fix any failures**

If any tests fail, investigate and fix. Common issues:

- Import path typos (remember `.js` extensions for ESM)
- Type mismatches from the new `activeLayer` parameter
- Existing tests that relied on the broken behavior

**Step 3: Final commit if fixes needed**

Only commit if Step 2 required changes.
