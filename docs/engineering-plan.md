# Athena Browser MCP – Engineering Plan

## 1. Context & Constraints
- **Runtime stack**: Claude (or other MCP clients) talk to the Node.js MCP server, which routes tool invocations to services that communicate with the **CEF + Qt-based Athena browser** via the existing CDP bridge (`chrome-remote-interface` over WebSocket).
- **Bridge guarantees**: The bridge manages connection lifecycle, domain enablement, and CDP method dispatch (`src/bridge/cef-bridge.ts`). All browser automation must flow through this bridge; native CEF APIs or direct socket hacks are out of scope.
- **Tooling goals recap** (from `docs/tooling-plan.md`):
  - Deterministic, handle-first element control.
  - Adaptive discovery (semantic + visual) with paging and ranking.
  - Visual/pointer fallbacks that mint reusable handles.
  - Structured state extraction that works even on low-accessibility pages.
  - Telemetry on adoption, fallbacks, and load constraints.

## 2. Key Subsystems to Build

### 2.1 Discovery Ranking & Paging Engine
- **Inputs**: Region scope (from Region Resolver), raw DOM/AX data (via CDP `DOM`, `Accessibility`, `Runtime`), optional screenshot cues.
- **Responsibilities**:
  - Apply tiered ranking (`semantic`, `structural`, `visual`) with tunable `rankingMode`.
  - Collapse duplicates (same text/selector) and expose `variantCount`.
  - Enforce response caps by adjusting `pageSize`, tracking `nextToken`, and surfacing `estimatedRemaining`.
  - Produce `rankingSignals` (role confidence, text uniqueness, DOM depth, visual match score) for each item.
- **Reusable OSS heuristics**:
  - `aria-query`, `dom-accessibility-api`, and `@testing-library/dom` for computing accessible names/roles and near-text matching.
  - Puppeteer/Playwright selector ranking strategies as inspiration for DOM depth weighting and duplicate suppression logic.

### 2.2 Hybrid Region Resolver
- Combine:
  - ARIA landmarks (`Accessibility.getFullAXTree`).
  - CSS selectors + DOM traversal (`DOM.querySelector`, `DOM.getFlattenedDocument`).
  - Near-text search (using `dom-accessibility-api` name computation + fuzzy match).
  - Visual anchors (hit-testing screenshot regions with `Runtime.evaluate` + layout data).
- Provide consistent region handles for `ui.scan`, `visual.scan`, and `state.snapshot`. Cache recent resolutions with TTLs keyed by navigation events.

### 2.3 Handle Promotion & Verification Pipeline
- **Stages**:
  1. **Capture**: store screenshot snippets, bounding boxes, OCR text for `visualHandleId` or pointer hits.
  2. **DOM Backfill**: use CDP hit-testing (`DOM.getNodeForLocation`, `Page.getLayoutMetrics`, `DOM.performSearch`) plus text similarity to map geometry to DOM nodes.
  3. **Verification**: re-check visibility/text/role via CDP, optionally overlay highlight (leveraging Chrome DevTools `Overlay` domain) or rerun OCR with `tesseract.js`.
  4. **Promotion**: mint durable `elementId`, update handle store metadata, record `verificationEvidence`.
- **APIs**: `promoteVisualHandle`, `verifyHandle`, `fallbackToVisualReplay`, `invalidateHandle`.
- **Instrumentation**: log promotion attempts, confidence thresholds, TTL expirations.
- **OSS leverage**: `opencv4nodejs`/`sharp` for geometry transforms; `tesseract.js` for OCR; Playwright hit-testing logic as reference for DOM reconciliation.

### 2.4 State Snapshot Extractor Framework
- Schema accepts either stock fields or `{field, hint: {textIncludes, strategy}}`.
- Extractors can mix DOM queries, AX tree reads, and visual confirmation.
- Provide registry of reusable extractors (price, CTA, carousel selection) with plug-in API so future domains can extend without core changes.

## 3. Tool Handler Workstreams

### 3.1 Navigation (`nav.goto`, `nav.followPath`)
- Reuse existing handlers but integrate Region Resolver + Discovery Engine for `followPath` to select menu/breadcrumb steps deterministically.
- Add optional sanity checks (URL/title assertion) before returning handles.

### 3.2 Discovery (`ui.scan`, `ui.pick`)
- `ui.scan` flow:
  1. Resolve region.
  2. Fetch DOM + AX snapshot via CDP.
  3. Pass nodes to Ranking Engine, honoring `pageSize/pageToken/rankingMode`.
  4. Attach `rankingSignals`, `estimatedRemaining`, `nextToken`, and density-aware `continuationHint`.
  5. Issue handles even when semantics absent by capturing fallback visual evidence and registering with Handle Promotion pipeline.
- `ui.pick`: use semantic hints or `elementId` to refresh handles; if only near-text provided, delegate to Ranking Engine in “direct pick” mode to ensure consistent scoring.

### 3.3 Visual (`visual.scan`)
- Request scoped screenshot from CEF bridge; feed through `opencv4nodejs` for layout detection and `tesseract.js` for OCR.
- Rank results with the same engine (visual tier) and paginate.
- Return `visualHandleId`, geometry, `confidence`, `verificationHook`.
- Automatically enqueue promotion attempts when confidence passes configurable thresholds; otherwise require agent to call `action.execute` with `visualHandleId`.

### 3.4 Pointer (`pointer.action`)
- Accept absolute coordinates or handles.
- Execute CDP Input domain gestures; collect DOM proximity data post-action (e.g., `DOM.getNodeForLocation`).
- Submit to Handle Promotion service and return `{status, promotedHandleId?, verificationEvidence}`.
- If promotion fails, include guidance (e.g., “visual confidence 0.42—retry visual scan”).

### 3.5 Action (`action.execute`, `action.setState`)
- Consume handles from any source (DOM or promoted visual/pointer).
- Run verification before/after action to detect stale handles; if stale, attempt refresh (Region Resolver + selector builder) before failing.
- For text inputs, use `aria-query` + AX metadata to decide between typing, selection, or slider drag.

### 3.6 State & Flow (`state.snapshot`, `flow.invokePrimaryAction`)
- `state.snapshot`: parse extractor hints; apply DOM/visual strategies; return structured facts limited to requested fields.
- `flow.invokePrimaryAction`: use Ranking Engine in CTA mode (boosting buttons/links with strong action verbs), falling back to visual handles if necessary.

## 4. Telemetry & Monitoring
- Use OpenTelemetry JS SDK (or `trace-event`) to emit spans/metrics:
  - `discovery.pagination_depth`, `discovery.estimated_remaining`, `ranking.mode_usage`.
  - `visual.promotion_attempts`, `visual.promotion_success_rate`.
  - `pointer.actions`, `pointer.promotion_success_rate`.
  - `snapshot.extractor_usage`, `snapshot.custom_hint_count`.
- Export metrics via existing logging pipeline (stdout or structured JSON) for later aggregation.

## 5. Validation Strategy
- **Unit tests**:
  - Ranking Engine scoring/ranking/paging logic with mocked DOM nodes.
  - Region Resolver heuristics (ARIA-only, CSS-only, visual anchor fallback).
  - Handle Promotion pipeline (confidence thresholds, TTL, verification).
  - Extractor parsing and DOM/visual fusion logic.
- **Integration tests** (Vitest + mocked CDP bridge first, then live CEF sessions):
  - Happy-path commerce flow (Apple buy).
  - Accessibility-negative fixtures: div-only navs, aria-hidden CTAs, moving carts, canvas sliders.
  - Stress test with >200 focusable nodes to ensure paging surfaces all items ≤2 KB per response.
- **Performance/load**:
  - Measure `ui.scan`/`visual.scan` latency vs. page complexity; tune page sizes to keep responses under token caps.
  - Verify promotion/verification adds minimal overhead (<50 ms target) or provide progressive response streaming if longer.

## 6. Implementation Milestones
1. **M1 – Foundations**: Ranking Engine, Region Resolver upgrades, extractor framework, handle promotion pipeline.
2. **M2 – Tool Handler Integration**: Update nav/ui/action/state/visual/pointer handlers; thread telemetry hooks.
3. **M3 – Wiring & Docs**: Register schemas, update AGENTS/README with paging protocol, promotion lifecycle, extractor hints; expose telemetry config.
4. **M4 – Validation & Rollout**: Execute regression suites on CEF browser, tune thresholds, finalize deprecation plan for legacy tools.

## 7. Open Source Dependencies Checklist
- `aria-query`, `dom-accessibility-api`, `@testing-library/dom` – accessible name/role computation.
- `chrome-remote-interface` (already in use) – CDP client.
- `opencv4nodejs` or `sharp` + `opencv.js` – layout segmentation for `visual.scan`.
- `tesseract.js` – OCR for text extraction from screenshots.
- `axe-core` (optional) – heuristics for detecting poor accessibility; can feed ranking penalties or telemetry.
- `trace-event` or OpenTelemetry JS – telemetry emission.
- Puppeteer/Playwright code references – selector heuristics, hit-testing logic, pointer retry strategies:
  - Playwright’s selector engine & injection helpers: https://github.com/microsoft/playwright/tree/main/packages/playwright-core/src/server/injected
  - Playwright pointer fallback & hit-testing logic: https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/injected/injectedInput.ts
  - Puppeteer query handlers & selector priority: https://github.com/puppeteer/puppeteer/tree/main/packages/puppeteer-core/src/common/QueryHandler.js
  - Puppeteer keyboard/mouse dispatchers (click/typing fallbacks): https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/common/Input.ts

## 8. Risks & Mitigations
- **Performance overhead** from visual/OCR processing: mitigate by caching screenshot tiles per region and running heavy work off the main event loop (worker threads).
- **Handle staleness** due to fast DOM churn: enforce short TTLs, include navigation/mutation hooks from CDP (`Page.frameNavigated`, `DOM.documentUpdated`) to invalidate handles proactively.
- **OCR accuracy variance**: allow configurable confidence thresholds and expose them via telemetry to tune promotion heuristics; consider language packs if needed.
- **Telemetry volume**: batch or sample events to avoid overwhelming logs; guard with env flag.

## 9. Next Steps
1. Prototype Ranking Engine interface (TypeScript types + scoring plug-ins) and validate against sample DOM snapshots.
2. Spike visual handle promotion using `opencv4nodejs` + `tesseract.js` on a captured CEF screenshot to confirm data flow from bridge to Node.
3. Draft telemetry schema and integration points to avoid retrofitting instrumentation late.
