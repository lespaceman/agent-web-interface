# Cross-Baseline Region Deduplication

## Motivation

Baseline snapshots (navigate, capture_snapshot) re-send entire region contents even when they're structurally identical to prior baselines in the same session. Analysis of an Apple Store "add iPhone to cart" flow (15 steps, 7 baselines) shows:

- **Nav region consumes 43-77% of baseline tokens** — Apple's mega-menu has 70+ links repeated on every page
- **252 of 530 unique eids (47.5%) appear in 2+ baselines** — massive redundancy
- **70-89% of baseline tokens are repeated elements** from prior snapshots
- **Main region (the actual content) averages only ~28%** of baseline tokens

## Design

### Core Mechanism

On each baseline response, compare each region's ordered eid list against the previous baseline's. If the eid set is identical (same eids, same order), collapse the region to a self-closing tag instead of rendering all elements.

### Interaction with Region Trimming

Dedup and trimming are independent mechanisms, stacked:

1. **Dedup check first** — if a region is unchanged, collapse it entirely (no trimming needed)
2. **Trimming second** — if a region has changed, apply head/tail trimming as today

### Detection: EID Set Comparison

Compare ordered arrays of eids per region between current and previous baseline. Exact match required (same length, same values, same order). This leverages the existing stable identity system — no new hashing or computation needed.

### Output Format

When a region is unchanged:

```xml
<region name="nav" unchanged="true" count="73" />
```

The agent knows the region exists, how many elements it contains, and that it hasn't changed. Zero element tokens consumed.

When a region has changed, it renders normally (with trimming applied if enabled).

### Scope

- **Applies to:** navigate and capture_snapshot only (when `trimRegions: true`)
- **Does not apply to:** Action tools (click, type, press, select, hover, scroll\_\*) — these always return full snapshots
- **All regions eligible:** Dedup applies universally to any region whose eid set matches the previous baseline

## Implementation

### Files Modified (3 files)

#### 1. `src/state/state-manager.ts` — Store baseline region signatures

Add to `StateManagerContext`:

```ts
// Map of region name → ordered eid list from the most recent baseline
previousBaselineRegions: Map<string, string[]> | null;
```

In `doGenerateResponse()`, after `getBaselineInfo()` determines this is a baseline:

- After `formatActionables()` builds the ActionableInfo[] array, extract region → eid mapping
- Pass `previousBaselineRegions` into `renderStateXml()` via `RenderOptions`
- After rendering, update `previousBaselineRegions` with the current baseline's regions

Extend `RenderOptions`:

```ts
interface RenderOptions {
  trimRegions?: boolean;
  previousBaselineRegions?: Map<string, string[]>;
}
```

#### 2. `src/state/state-renderer.ts` — Dedup check before trimming

In `renderStateXml()`, inside the region rendering loop:

```
For each region:
  1. Extract current eid list from the region's actionables
  2. If previousBaselineRegions has this region AND eid lists match exactly:
     → Render: <region name="nav" unchanged="true" count="73" />
     → Skip trimming entirely
  3. Else:
     → Apply trimming as today
     → Render elements normally
```

Add helper:

```ts
function areEidListsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
```

#### 3. `src/tools/browser-tools.ts` — No changes needed

navigate() and captureSnapshot() already pass `{ trimRegions: true }`. The `previousBaselineRegions` is managed internally by StateManager.

### Call Flow

```
navigate() / captureSnapshot()
  → stateManager.doGenerateResponse(snapshot, { trimRegions: true })
    → getBaselineInfo() → baseline detected
    → formatActionables() → ActionableInfo[] with ctx.region
    → renderStateXml(response, {
        trimRegions: true,
        previousBaselineRegions: context.previousBaselineRegions
      })
      → for each region:
          if eid list matches previous → <region ... unchanged="true" count="N" />
          else → apply trimming → render elements
    → update context.previousBaselineRegions with current regions
```

## Edge Cases

1. **First baseline** — `previousBaselineRegions` is null. No dedup. All regions render in full.
2. **Cross-domain navigation** — Different site has different eids. Dedup naturally produces no matches.
3. **New region appears** — No prior entry in map. Renders in full.
4. **Region disappears** — Not in current snapshot. Nothing to render.
5. **Same eids, different order** — Order-sensitive comparison catches this. Region renders in full.
6. **Same eids, different attributes** — Eid-based check suppresses this. Acceptable — find_elements returns current state.
7. **Action tools after dedup** — Always return full snapshots. Agent gets complete context after every interaction.

## Testing

### Unit Tests: `state-renderer.ts`

- Region with identical eid list to previous → collapsed `<region ... unchanged="true" count="N" />`
- Region with different eid list → renders normally (with trimming)
- Region not in previous baseline map → renders normally
- `previousBaselineRegions` is null (first baseline) → all regions normal
- Same eids, different order → renders normally
- Empty region (0 actionables) → not rendered (unchanged behavior)
- Changed region with many elements → trimming still applies

### Unit Tests: `state-manager.ts`

- After first baseline, `previousBaselineRegions` is populated
- After second baseline, `previousBaselineRegions` is updated
- Diff responses don't modify `previousBaselineRegions`
- Correct region name → ordered eid array mapping

## Expected Token Savings

Based on Apple Store "add iPhone to cart" flow analysis:

| Step              | Current | After Dedup | Savings             |
| ----------------- | ------- | ----------- | ------------------- |
| 1 (homepage)      | 3,517   | 3,517       | 0% (first baseline) |
| 3 (iPhone page)   | 5,559   | ~3,071      | ~45%                |
| 4 (configurator)  | 6,283   | ~1,937      | ~69%                |
| 10 (carrier page) | 6,372   | ~1,951      | ~69%                |
| 12 (upsell)       | 3,445   | ~679        | ~80%                |
| 14 (bag page)     | 4,043   | ~1,229      | ~70%                |

**Estimated total: ~34,701 → ~22,100 tokens (~36% reduction)**

Combined with region trimming (which reduces element count within changed regions), the two features together should bring baseline costs substantially closer to diff-level costs.
