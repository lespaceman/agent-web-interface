# MCP Tooling Revamp – Implementation Plan

## Goals
- Replace the sprawling, low-signal tool surface with a minimal, composable toolkit optimized for GPT‑class agents.
- Provide semantic, handle-based element selection to eliminate brittle CSS/XPath guessing and reduce repeated page dumps.
- Guarantee every tool response stays compact (≤2 KB) while still exposing the information needed to complete commerce-style workflows.

## Target Tool Suite (Revised)
| Tool | Purpose | Key Notes |
| --- | --- | --- |
| `nav.goto(url, waitFor?, assert?: {urlIncludes?, titleIncludes?})` | Deterministic navigation with optional postconditions | Guards against redirects, returns URL/title/status |
| `nav.followPath(scope, steps[])` | Generic hierarchical navigation (menus, breadcrumbs, sidebars) | Uses `RegionResolver` + `ui.scan` internally; returns handle for the final step |
| `ui.scan(region, roles?, pageSize?, pageToken?, rankingMode?)` | Lightweight discovery (≤20 items/page) grouped by context | Returns `{group?, items:[{elementId, role, label, selectorSummary, relevance, rankingSignals}], nextToken?, estimatedRemaining}` so agents can keep paging deterministically |
| `ui.pick(elementId \| {group, choice} \| hint)` | Resolve/refresh a single element into a reusable handle | Accepts handle or semantic hint; returns canonical selectors + bbox |
| `action.execute(handle, intent?)` | Handle-first activation (click, open, confirm) | Intent hints (e.g., `"press"`, `"toggle"`) help choose pointer/keyboard strategy |
| `action.setState(handle, state)` | Set text/selection/toggle/slider values | Inspects role/type to decide between typing, radio selection, dragging |
| `state.snapshot(scope, fields[])` | Structured summary limited to requested fields | Fields like `["selectedColor","price","cta"]`; keeps responses ≤300 tokens |
| `flow.invokePrimaryAction(scope?, intentHint?)` | Finds and triggers the dominant CTA within a region | Works for “Add to Bag”, “Next step”, etc., returns resulting state/handle |
| `visual.scan(region, pattern?, pageToken?, rankingMode?)` | Fallback discovery via layout, bounding boxes, OCR text | Emits ranked `visualHandleId`s + geometry + confidence; provides `verificationHook` metadata for downstream promotion |
| `pointer.action({x,y} \| handle, intent)` | Absolute/relative pointer fallback when semantics fail | Reports `{status, promotedHandleId?, verificationEvidence}` so successful targets become reusable handles |

## Architecture Additions
1. **Element Handle Store**
   - In-memory map `{id -> ElementRef + metadata}` with TTL.
   - API to create, refresh, and invalidate handles on DOM mutations.
   - Backed by existing `ElementResolverService` and `SelectorBuilderService`.

2. **Region Resolver**
   - Helper to translate `region` arguments (`'header'`, `'main'`, `{selector, nearText}`) into DOM scopes.
   - Hybrid heuristic blends ARIA landmarks, CSS selectors, DOM topology, near-text proximity, and optional screenshot anchors for low-semantic layouts.
   - Drives both `ui.scan` and `state.summary`.

3. **Summary & Extraction Templates**
   - Pluggable extractors that map scoped DOM/visual data into key-value facts (e.g., color selection, price, CTA, arbitrary custom fields).
   - `state.snapshot` can request stock fields or supply custom extractor hints (`{field, hint: {textIncludes, strategy}}`) to cover bespoke flows.

4. **Discovery Ranking & Paging Engine**
   - Centralizes scoring features (semantic role confidence, text uniqueness, DOM depth, visual match confidence).
   - Enforces response caps (≤2 KB) via adaptive page sizes, exposes `estimatedRemaining`, and groups duplicate items with `variantCount`.

5. **Handle Promotion & Verification Pipeline**
   - Manages lifecycle of `visualHandleId`/pointer hits: capture geometry, attempt DOM backfill, run verification hooks, and mint durable `elementId`s.
   - Provides APIs `promoteVisualHandle`, `verifyHandle`, and `fallbackToVisualReplay` plus policy controls for TTLs/thresholds.

## Implementation Phases

### Phase 1 – Foundations
1. **Add Handle Store**
   - New service `ElementHandleStore` with methods `createFromElement(elementRef)`, `get(id)`, `refresh(id)`, `delete(id)`.
   - Integrate store into `ElementResolverService` so any resolution can optionally return a handle.
2. **Region & Focus Utilities**
   - `RegionResolver` service that maps regions to DOM nodeIds using ARIA landmarks, CSS selectors, text proximity, or visual anchors when semantics are missing.
   - Hybrid heuristic that blends DOM topology, near-text search, and optional screenshot cues.
3. **Shared Types & Schemas**
   - Extend `selectors`/`LocatorHint` types to include `elementId`.
   - Introduce new Zod schemas for nav/ui/action/state/session tools.
4. **Handle Promotion Services**
   - Implement `HandlePromotionService` + `VerificationHookRegistry` to store OCR/geometry evidence, reconcile with DOM nodes, and expose promotion/refresh APIs used by visual/pointer tools.

### Phase 2 – Tool Handlers
1. **Navigation Handlers**
   - `NavGotoHandler` (reuse existing navigation logic, wrap in new schema/response).
   - `NavFollowPathHandler` (leverages RegionResolver + iterative `ui.scan` to follow `steps[]`; works for menus, breadcrumbs, wizard steps).
2. **UI Discovery Handlers**
   - `UiScanHandler`: uses RegionResolver + Discovery Engine to apply semantic/structural/visual ranking tiers; honors `pageSize/pageToken`, emits `estimatedRemaining`, adds `rankingSignals`, and issues handles even when roles are absent by capturing visual evidence.
   - Implements density-aware heuristics (duplicate collapse, continuation hints) so agents can enumerate hundreds of items deterministically.
   - `UiPickHandler`: accepts `elementId` or semantic hint, returns refreshed handle payload.
3. **Action Handlers**
   - Repurpose `ActionHandler` to operate on handles; introduce `intent` semantics for `action.execute`.
   - `action.setState` switches between typing, toggling, selecting, or dragging based on metadata.
4. **State & Flow Handlers**
   - `StateSnapshotHandler`: executes template extractors for requested fields.
   - `FlowPrimaryActionHandler`: locates the dominant CTA within a scope and invokes it.
5. **Visual & Pointer Handlers**
   - `VisualScanHandler`: combines screenshot snippets, OCR text, and bounding boxes to find elements without semantics; streams ranked results with `confidence`, `verificationHook`, and `nextToken`, then delegates to Handle Promotion for DOM reconciliation.
   - `PointerActionHandler`: executes coordinate-based pointer gestures as a last resort and, on success, records evidence + DOM proximity, returning `{status, promotedHandleId?, verificationEvidence}` and triggering verification hooks.

### Phase 3 – Wiring & Compatibility
1. **Register New Tools**
   - Update `src/server/tool-registry.ts` and `mcp-server.ts` to register the new schemas/handlers.
2. **Gradual Deprecation**
   - Keep legacy tools for now but mark them with `deprecated` in descriptions.
   - Update README/AGENTS doc with guidance to prefer the new suite.
3. **Telemetry**
   - Instrument handle creation/usage, scan pagination depth, ranking overrides, visual/pointer fallback usage, promotion success rates, and extractor hint adoption to monitor adoption and pain points.

### Phase 4 – Validation
1. **Unit Tests**
   - Handle store lifecycle, region resolver edge cases, summary template coverage.
2. **Integration Tests**
   - Scripted scenario: Apple buy flow using only new tools; ensure selectors resolve and state summaries confirm selections.
3. **Load/Context Checks**
   - Verify `ui.scan`/`visual.scan` responses stay under token budget (cap arrays, truncate summaries, enforce pagination) while ensuring adaptive paging surfaces all relevant controls on dense layouts; include stress tests with >200 focusable nodes and canvas-based controls.
4. **Accessibility-negative Regression Suite**
   - Build fixtures with div-only navs, aria-hidden CTAs, moving carts, and canvas sliders to confirm visual/pointer promotions remain reusable and state snapshots can validate results with custom extractors.

## Open Questions / Follow-ups
- How long should element handles remain valid amidst rapid DOM mutations? (Tentative TTL: 30 s or until navigation.)
- How should custom extractor hints be expressed so `state.snapshot` can cover non-commerce flows without exploding complexity?
- What confidence thresholds promote a `visual.scan` or `pointer.action` result into a durable handle, and how do we re-verify after DOM changes?
- How should `ui.scan` communicate `estimatedRemaining` accuracy (exact vs. bucketed) so planners know when exhaustive enumeration is complete?
- When legacy tools are removed, will downstream agents need a migration guide? Plan a deprecation policy once the new suite and visual fallbacks prove stable.
- How aggressively should handles be invalidated (navigation, DOM mutation events, TTL)? Need policy before rollout.
