# Implicit Interactivity Detection

**Date:** 2026-03-01
**Status:** Approved

## Problem

Web applications frequently use non-semantic HTML elements (`<tr>`, `<div>`, `<span>`) with JavaScript click handlers for navigation and interaction. The current system only recognizes elements with semantic ARIA roles (button, link, textbox, etc.) as interactive. Non-semantic clickable elements get `unknown-*` or `rd-*` prefixed IDs that cannot be resolved by the click tool, blocking agents from interacting with table rows, cards, and other custom clickable components.

**User-reported symptoms:**

- `find_elements` returns `kind="generic"` with `unknown-*` EIDs for table rows
- `click(eid="unknown-*")` fails with `ElementNotFoundError`
- Only semantic elements (buttons, links, radios) are clickable

**Root cause:** `ElementRegistry.updateFromSnapshot()` only registers nodes where `isInteractiveKind(node.kind)` is true. Non-semantic elements are never registered, so `registry.getByEid()` returns undefined.

## Approach

Add a new extractor phase (interactivity-detector) that runs during snapshot compilation to detect implicit interactivity signals on non-semantic elements. Elements with positive signals get registered in the ElementRegistry alongside natively interactive elements.

### Signals Detected

1. **Event listeners:** CDP `DOMDebugger.getEventListeners` for `click`, `mousedown`, `pointerdown` — on the element itself or delegated from ancestors (walk up 3-5 levels)
2. **Cursor pointer:** CSS `cursor: pointer` via `CSS.getComputedStyleForNode`
3. **Tabindex:** `tabindex >= 0` from DOM attributes (already extracted, zero cost)

### Design Decisions

- **Signal-based, not blanket:** Only register non-interactive elements that show interactivity signals, keeping the registry lean
- **Flag approach:** Add `implicitly_interactive?: boolean` to `ReadableNode` rather than changing `kind`. Preserves EID stability (kind is part of the hash) and semantic accuracy
- **Detection at snapshot time:** Run during compilation so elements are always clickable from the first snapshot
- **Ancestor walk for delegation:** React/Vue attach listeners to parent containers; walking up 3-5 ancestors catches most delegation patterns

## Data Model Changes

### `ReadableNode` (snapshot.types.ts)

```typescript
export interface ReadableNode {
  // ... existing fields ...
  implicitly_interactive?: boolean;
}
```

### New type: `InteractivitySignals` (extractors/types.ts)

```typescript
export interface InteractivitySignals {
  has_click_listener: boolean;
  has_cursor_pointer: boolean;
  has_tabindex: boolean;
  listener_source: 'self' | 'ancestor' | 'none';
}
```

### `RawNodeData` (extractors/types.ts)

```typescript
export interface RawNodeData {
  // ... existing fields ...
  interactivity?: InteractivitySignals;
}
```

## New Module: Interactivity Detector

**File:** `src/snapshot/extractors/interactivity-detector.ts`

**Input:** List of backendNodeIds for non-interactive nodes + CDP client + DOM tree
**Output:** `Map<number, InteractivitySignals>`

**Algorithm:**

1. Batch resolve backendNodeIds → CDP nodeIds via `DOM.pushNodesByBackendIdsToFrontend`
2. Check tabindex from DOM attributes (free — already in RawDomNode)
3. Check cursor:pointer via `CSS.getComputedStyleForNode`
4. For event listener detection:
   - Resolve to RemoteObject via `DOM.resolveNode`
   - Call `DOMDebugger.getEventListeners` for click/mousedown/pointerdown
   - If no listener on self, walk up ancestors (max 5 levels) using DOM tree parentId
   - Cache ancestor results to avoid redundant checks
5. Short-circuit: skip listener check if cursor:pointer already detected

**Performance bounds:**

- Check only visible, non-interactive nodes (typically 20-100 per page)
- Skip off-screen elements
- Cache ancestor listener results
- Worst case: ~6N CDP calls for N candidate nodes

## Integration Points

### Snapshot Compiler (snapshot-compiler.ts)

Add Phase 2.5 between node classification and layout extraction:

1. Collect backendNodeIds of non-interactive nodes in `nodesToProcess`
2. Call `detectInteractivity(ctx, candidateIds, domResult)`
3. Merge signals into `nodeData.interactivity`
4. In `transformNode()`, set `node.implicitly_interactive = true` if any signal is positive

### Element Registry (element-registry.ts)

Expand the registration gate:

```typescript
// Before:
if (!isInteractiveKind(node.kind)) continue;

// After:
if (!isInteractiveKind(node.kind) && !node.implicitly_interactive) continue;
```

### Actionables Filter (actionables-filter.ts)

Expand the selection gate:

```typescript
// Before:
if (!isInteractiveKind(node.kind)) return false;

// After:
if (!isInteractiveKind(node.kind) && !node.implicitly_interactive) return false;
```

### XML Renderer (state-renderer.ts)

Implicitly interactive elements render with `<elt>` tag and `kind` attribute:

```xml
<elt id="c7d2e1f4a3b5" kind="row">Anas Client 73</elt>
```

### find_elements (browser-tools.ts)

No changes needed — implicitly interactive nodes are now registered, so the existing registry lookup returns their EID instead of generating `unknown-*` fallbacks.

## Files Changed

| File                                                 | Change                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `src/snapshot/extractors/interactivity-detector.ts`  | **NEW** — Detection logic (~150 lines)                      |
| `src/snapshot/extractors/types.ts`                   | Add `InteractivitySignals` type, extend `RawNodeData`       |
| `src/snapshot/extractors/index.ts`                   | Re-export new module                                        |
| `src/snapshot/snapshot.types.ts`                     | Add `implicitly_interactive` to `ReadableNode`              |
| `src/snapshot/snapshot-compiler.ts`                  | Add Phase 2.5 interactivity detection                       |
| `src/state/element-registry.ts`                      | Expand registration gate                                    |
| `src/state/actionables-filter.ts`                    | Expand selection gate                                       |
| `src/renderer/xml-renderer.ts`                       | Render kind attribute for non-standard interactive elements |
| `tests/unit/snapshot/interactivity-detector.test.ts` | **NEW** — Unit tests                                        |
| Various existing test files                          | Update for new field                                        |

## Performance Impact

- Additional ~100-600ms per snapshot on pages with many non-interactive elements
- Bounded by number of visible non-interactive nodes (not total DOM size)
- Ancestor caching reduces redundant CDP calls
- Short-circuit on cursor:pointer avoids unnecessary listener checks
