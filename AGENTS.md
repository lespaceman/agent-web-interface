# Snapshot & Interaction Pipeline — Audit Results

Comprehensive audit across 7 parallel review agents examining the full extraction and interaction pipeline for bugs where the agent's perception diverges from reality.

## Critical (agent can't complete tasks)

### C1. Iframe element coordinates are iframe-relative, not viewport-relative
**Agent 1, Finding 3** | `layout-extractor.ts:413-458`
Batch path uses `getBoundingClientRect()` inside iframes, returning iframe-local coordinates. `Input.dispatchMouseEvent` expects viewport-relative. Clicks on iframe elements (cookie banners, embedded forms) hit wrong positions.

### C2. Cross-origin iframe elements can't be resolved from main CDP session
**Agent 3, Finding 2** | `element-resolver.ts`, `session-manager.ts:499`
CDP session is created once per page. `backendNodeId` for cross-origin iframe elements can't be resolved via `DOM.resolveNode`/`DOM.getBoxModel` from the main frame session. Cookie consent banners (OneTrust, Cookiebot) are common cross-origin iframes.

### C3. EID collision suffix shifts silently when DOM order changes
**Agent 5, Finding 2+7** | `element-identity.ts:132-143`, `element-registry.ts:67-80`
Collision resolution assigns `-2`, `-3` by iteration order. If elements reorder between snapshots, suffixes shift and the agent silently acts on the wrong element. Common with sorted lists, infinite scroll, and any dynamic reordering.

### C4. Stale element retry picks first label+kind match with no disambiguation
**Agent 5, Finding 6** | `stale-element-retry.ts:64-65`
`nodes.find(n => n.label === node.label && n.kind === node.kind)` returns the first match. For pages with repeated elements ("Add to cart" x10), the wrong element is targeted silently.

## Major (agent works around it poorly)

### M1. `opacity:0`, `clip-path`, `transform:scale(0)` not detected as invisible
**Agent 1, Finding 1** | `layout-extractor.ts:123-140`
`computeVisibility()` only checks `display:none`, `visibility:hidden`, and zero bbox. Invisible elements (loading spinners with opacity:0, off-screen transforms) reported as visible. Agent tries to interact with them.

### M2. Batch vs. fallback coordinate space mismatch
**Agent 1, Finding 4** | `layout-extractor.ts`
Batch path returns viewport-relative coords (`getBoundingClientRect`), fallback returns page-relative (`DOM.getBoxModel`). Mixed coordinate spaces in the same snapshot when some elements fall back.

### M3. `<label>` wrapping hidden inputs dropped from snapshot
**Agent 1, Finding 5** | `types.ts:328-346`, `snapshot-compiler.ts:299-310`
`LabelText` AX role is not in any role set. Labels without click listeners/cursor:pointer are silently dropped. Agent can't see the visual click target for custom radio/checkbox controls.

### M4. Disabled override false positive — analytics click listeners
**Agent 2, Finding 1** | `state-extractor.ts:137-145`
Elements with analytics tracking click listeners (GTM, etc.) are marked `enabled=true` even when truly disabled. Also applies to ancestor delegation listeners (common in React/Vue).

### M5. `aria-pressed` for toggle buttons not mapped
**Agent 2, Finding 2** | `state-extractor.ts` (absent)
No `pressed` field in `NodeState`. Toggle buttons (bold/italic, mute, dark mode) lose their toggled state. Agent can't determine current state.

### M6. `contenteditable` elements indistinguishable from regular inputs
**Agent 2, Finding 4** | `kind-mapping.ts:39`
Both get `kind:'input'`. Agent can't tell a rich text editor from a text field. May be missed entirely if AX doesn't assign `textbox` role.

### M7. `aria-disabled="false"` can't override DOM `disabled`
**Agent 2, Finding 6** | `state-extractor.ts:120-135`
Per WAI-ARIA spec, `aria-disabled="false"` should override native `disabled`. Both AX-first and fallback paths get this wrong.

### M8. Missing `mouseMoved` before click
**Agent 3, Finding 1** | `element-resolver.ts:251-282`
`clickAtCoordinates` sends `mousePressed`+`mouseReleased` without `mouseMoved`. Hover-gated handlers (React `onMouseEnter`, CSS `:hover` gates, tooltip-activated buttons) won't fire.

### M9. Type tool click-then-type race condition
**Agent 3, Finding 3** | `element-resolver.ts:358-374`
`typeByBackendNodeId` clicks to focus, then inserts text. If click triggers navigation/modal/focus steal, text goes to wrong target. No guard between click and insert.

### M10. `selectOption` event not compatible with React/Vue
**Agent 3, Finding 4** | `element-resolver.ts:446-461`
Dispatches `change` but not `input` event. `new Event('change')` is untrusted and bypasses React's value tracking. Vue's `v-model` on selects listens for `input`. Select changes may not be detected by frameworks.

### M11. Coordinate-based click has no scroll guard
**Agent 3, Finding 8** | `interaction-tools.ts:88-98`
Click with raw `x,y` (no eid) has no `scrollIntoViewIfNeeded`. If page scrolled since snapshot, click silently hits the wrong element.

### M12. EID label changes cause phantom add/remove in diff
**Agent 4, Finding 1** | `element-identity.ts:36-47`, `diff-engine.ts:98-112`
Counter updates ("Cart (3)" → "Cart (4)") change the eid hash. Diff shows removed+added instead of changed. Agent loses track of elements with dynamic labels.

### M13. Region trimming discards viewport-visible elements
**Agent 4, Finding 2** | `state-renderer.ts:160-193`, `actionables-filter.ts:74-120`
Head+tail trimming keeps first 5 and last 5 elements per region. If user scrolled to middle, visible elements are the ones trimmed.

### M14. `isEmpty` diff flag ignores scroll/viewport/layer changes
**Agent 4, Finding 5** | `diff-engine.ts:64-69`
Only checks actionable element changes. Scroll-only, viewport-only, or layer-only changes produce `isEmpty=true`, potentially suppressing the response.

### M15. Observation linking can mismatch elements that mutated between capture and snapshot
**Agent 4, Finding 7** | `eid-linker.ts:166-221`
Fuzzy text matching can match the wrong node if element text changed between observation capture and snapshot.

### M16. Dynamic labels break EID stability (counters, timers, badges)
**Agent 5, Finding 1** | `element-identity.ts:71-73`
`normalizeAccessibleName` does whitespace normalization only. No number/counter stripping. "Notifications (5)" → "Notifications (6)" produces different eid.

### M17. Step counter makes staleness too aggressive
**Agent 5, Finding 4** | `element-registry.ts:57, 191-195`
Every `updateFromSnapshot` increments step. Multiple observation snapshots without acting cause elements to go stale after just 2 more snapshots.

### M18. Observer lost on hard navigation — initial render mutations missed
**Agent 6, Finding 3** | `execute-action.ts:100-119`, `observation-accumulator.ts:46-77`
Hard navigation destroys JS context. Observer isn't re-injected until next action. Mutations during new page's initial render are lost.

### M19. setTimeout/rAF animations invisible to MutationObserver
**Agent 6, Finding 4** | `dom-stabilizer.ts:144-149`
CSS transitions and deferred DOM updates (`setTimeout(() => el.classList.add('visible'), 300)`) don't trigger MutationObserver until callback fires. Snapshot captured mid-animation with incorrect positions/visibility.

### M20. No second DOM stabilization after network idle
**Agent 6, Finding 6** | `action-stabilization.ts:43-61`
DOM stabilizes first, then network idle. API response that triggers a React render after DOM settled is not waited for. Snapshot may capture stale content (loading spinner instead of data).

### M21. No viewport-aware scaling for form cluster_distance
**Agent 7, Finding 2** | `input-clustering.ts:58-59`, `types.ts:600`
Hard-coded 200px. On mobile, groups unrelated forms. On desktop with generous spacing, splits one form.

### M22. Radio group linking ignores `name` attribute
**Agent 7, Finding 3** | `field-extractor.ts:88-115`
Uses `heading_context + region` instead of the HTML `name` attribute. Radio buttons under different headings (accordion-style) are incorrectly split into separate groups.

### M23. `canSubmit` too strict for optional-only forms
**Agent 7, Finding 5** | `form-state.ts:41-45`
Requires every enabled optional field to be filled. Search forms, filter panels report `can_submit:false` until every optional field is filled.

### M24. Custom checkbox widgets without `aria-checked` report as unfilled
**Agent 7, Finding 7** | `field-state-extractor.ts:45-51`
`<div role="checkbox" class="active">` without `aria-checked` attribute → `filled: false`. No fallback to CSS class or visual state.

### M25. Multi-step wizards always detected as `single_page`
**Agent 7, Finding 8** | `form-detector.ts:415-419, 269-308`
`inferPattern` is a stub returning `'single_page'`. All steps' fields (including hidden ones) grouped into one form with misleading completion %.

## Minor (cosmetic or edge case)

### m1. `overflow:hidden` parent clipping not detected
**Agent 1, Finding 2** | `layout-extractor.ts:123-140`

### m2. Closed shadow root falls back to page-space coordinates
**Agent 1, Finding 6** | `layout-extractor.ts:423`

### m3. `position:fixed/sticky` wrong in fallback path bbox
**Agent 1, Finding 7** | `layout-extractor.ts:165-168`

### m4. `<details>/<summary>` not in role sets, relies on Case B overflow
**Agent 2, Finding 3** | `types.ts:328-346`

### m5. `aria-checked="mixed"` (indeterminate) maps to undefined, losing tri-state
**Agent 2, Finding 8** | `state-extractor.ts:74-79`

### m6. `findClickableAncestor` limited to 5 parents, blocked by shadow DOM
**Agent 3, Finding 7** | `element-resolver.ts:195-198`

### m7. After scroll in diff mode, newly-visible elements not re-rendered
**Agent 4, Finding 3** | `state-renderer.ts:160-172`

### m8. Layer context change (modal open/close) invalidates all eids
**Agent 5, Finding 3** | `element-identity.ts:56-59`, `element-registry.ts:56, 79`

### m9. backendToEid map leaks old entries (memory)
**Agent 5, Finding 5** | `element-registry.ts:86-96`

### m10. 500ms network quiet window causes 3s penalty with high-frequency polling
**Agent 6, Finding 2** | `page-stabilization.ts:24`

### m11. Pre-action mutations misattributed as "during action"
**Agent 6, Finding 5** | `execute-action.ts:100, 117`

### m12. Deferred pushState only caught by late check; missed if after stabilization timeout
**Agent 6, Finding 7** | `navigation-detection.ts:46-62`

### m13. English-only submit keywords (type="submit" fallback exists)
**Agent 7, Finding 4** | `submit-detection.ts:16-34`

### m14. DependencyTracker only learns at runtime, no static analysis
**Agent 7, Finding 6** | `dependency-tracker.ts:59-103`

---

## Prioritized Backlog (severity x frequency / complexity)

### Quick Fixes (< 1 hour each)
1. **M8**: Add `mouseMoved` before `mousePressed` in `clickAtCoordinates` — 3 lines
2. **M5**: Add `pressed` field to `NodeState`, extract from AX `pressed` property — ~10 lines
3. **M14**: Include scroll/layer/viewport in `isEmpty` check — ~5 lines
4. **M23**: Change `canSubmit` for optional-only forms to `true` when at least one field is filled — ~3 lines
5. **m5**: Map `aria-checked="mixed"` to a distinct value instead of undefined — ~5 lines
6. **M10**: Dispatch both `input` and `change` events in `selectOption`, use native setter trick for React — ~10 lines

### Medium Fixes (1-4 hours each)
7. **M1**: Extend `computeVisibility` to check `opacity`, `clip-path`, `pointer-events` — add to batch CSS extraction
8. **C4**: Add disambiguation to stale element retry — match on region, heading_context, group_path, approx bbox
9. **M4**: Refine interactivity override — only override for `listener_source: 'self'`, not ancestors
10. **M7**: Fix `aria-disabled="false"` override per WAI-ARIA spec
11. **M22**: Use `name` attribute for radio group linking, fall back to heading_context
12. **M20**: Add second DOM stabilization pass after network idle
13. **M16/M12**: Strip numbers from labels in `normalizeAccessibleName` to stabilize eids for counters/badges

### Large Fixes (> 4 hours each)
14. **C1/C2/M2**: Iframe coordinate transformation and frame-scoped CDP sessions
15. **C3**: Position-independent collision resolution (use `backend_node_id` or structural path instead of iteration order)
16. **M3**: Surface `<label>` elements as interactive when they wrap hidden inputs
17. **M25**: Implement multi-step wizard detection with visibility-based field scoping
18. **M19**: Add `requestAnimationFrame`-based idle detection alongside MutationObserver
