# Ephemeral Elements Investigation Report

**Date:** 2026-03-19
**Component:** Agent Web Interface — Snapshot Pipeline & Observation Accumulator
**Severity:** High — affects core ability to perceive page feedback after actions

---

## Executive Summary

AI agents using Agent Web Interface cannot reliably perceive ephemeral UI feedback — toasts, alerts, validation messages, status updates, loading indicators, and tooltips. These elements are critical for understanding action outcomes (e.g., "login failed", "item saved", "invalid input"), yet the snapshot pipeline systematically excludes them. This was validated across 7 real-world websites and a comprehensive 14-pattern test page.

---

## Problem Statement

When an AI agent performs an action (e.g., clicking "Submit" on a login form with invalid credentials), the page displays feedback — typically a toast notification, inline validation error, or alert banner. The agent receives a state snapshot that **does not contain this feedback text**. The agent sees only interactive children (dismiss buttons) of the alert container, never the message itself.

This means the agent cannot determine:

- Whether an action succeeded or failed
- What error occurred and how to recover
- What validation rules were violated
- What status updates the application is communicating

---

## Root Cause Analysis

### Primary Cause: Missing ARIA Role Classification

**File:** `src/snapshot/extractors/types.ts`

The snapshot pipeline classifies AX (accessibility) tree roles into three categories:

| Category               | Roles Included                                                                                                                                            | Purpose                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `INTERACTIVE_AX_ROLES` | button, link, textbox, checkbox, radio, combobox, slider, spinbutton, switch, tab, menuitem, menuitemcheckbox, menuitemradio, option, treeitem, searchbox | Clickable/typeable elements |
| `READABLE_AX_ROLES`    | heading, paragraph, text, StaticText, blockquote, caption, code, emphasis, strong, subscript, superscript, time                                           | Text content elements       |
| `STRUCTURAL_AX_ROLES`  | form, dialog, alertdialog, table, grid, list, listitem, navigation, banner, main, complementary, contentinfo                                              | Layout containers           |

**Missing roles (not in any category):**

| Role          | Standard Usage                                                    | Impact                         |
| ------------- | ----------------------------------------------------------------- | ------------------------------ |
| `alert`       | Toast notifications, error banners, validation messages           | Cannot see action feedback     |
| `status`      | Live region updates (cart count, search results, upload progress) | Cannot see status changes      |
| `log`         | Activity feeds, chat messages, audit trails                       | Cannot see log entries         |
| `timer`       | Countdown timers, session expiry warnings                         | Cannot see time-sensitive info |
| `tooltip`     | Hover help text, keyboard shortcut hints                          | Cannot see contextual help     |
| `progressbar` | Upload/download progress, loading bars                            | Cannot see progress state      |
| `marquee`     | Stock tickers, news crawls                                        | Cannot see scrolling content   |

### Secondary Cause: Snapshot Compiler Filtering

**File:** `src/snapshot/snapshot-compiler.ts` (lines 551-585)

The snapshot compiler only includes nodes that match one of:

```
1. INTERACTIVE role → always included
2. READABLE role → included if `includeReadable` option is true
3. Essential structural role → only 'form', 'dialog', 'alertdialog'
```

Any node with an unrecognized role is **silently dropped**. Its text content becomes orphaned — discoverable via `find` as `unknown-*` eids but never present in the snapshot state XML.

### Tertiary Cause: Observation System Inconsistency

**File:** `src/observation/observation-accumulator.ts` and `src/observation/observer-script.ts`

The observation system uses a MutationObserver to track DOM changes. It **does** detect `role="alert"` and `role="status"` (lines 178-179 in observer-script.ts) and scores them with high significance (3 points for `hasAlertRole` + 3 points for `hasAriaLive`). However:

1. **Timing gap:** Elements that appear _after_ DOM stabilization completes are missed entirely
2. **Text content capture:** `<appeared>` observations sometimes capture wrong content — during testing, tooltip trigger buttons were reported instead of toast text
3. **Removal tracking works better:** `<disappeared>` observations reliably capture the text of removed elements, because the observer records the `textContent` at mutation time
4. **Text-only mutations missed:** When a live region's `textContent` changes (e.g., `role="status"` region updated) without adding/removing DOM nodes, the MutationObserver may not fire if only `characterData` changed and the observer isn't configured for it

---

## Testing Methodology

### Phase 1: Real-World Website Testing

Tested login flows with invalid credentials across 4 websites to trigger error feedback:

#### Test 1: Vonnue BSS Portal (`https://bss-portal-pre-prod.vonnue.dev/login`)

- **Action:** Entered invalid email/password, clicked "Iniciar sesión"
- **Expected:** Error toast notification
- **Snapshot result:** No error message in snapshot or observations
- **Screenshot:** Toast visible on page

#### Test 2: GitHub (`https://github.com/login`)

- **Action:** Entered fake credentials, clicked "Sign in"
- **Expected:** "Incorrect username or password." error banner
- **Snapshot result:** Only `<btn id="b45707702f7b" focused="true">Dismiss this message</btn>` — the error text itself absent
- **Screenshot:** Red-bordered banner with full error text clearly visible

#### Test 3: SauceDemo (`https://www.saucedemo.com/`)

- **Action:** Entered bad_user/bad_pass, clicked "Login"
- **Expected:** "Epic sadface: Username and password do not match any user in this service"
- **Snapshot result:** Only `<btn id="c24f5265f672">error-button</btn>` (the X dismiss button)
- **Screenshot:** Red error banner with full text visible

#### Test 4: Herokuapp Login (`https://the-internet.herokuapp.com/login`)

- **Action:** Entered invaliduser/wrongpass, clicked "Login"
- **Expected:** "Your username is invalid!" flash message
- **Snapshot result:** Only `<link id="292708a9e27a" href="#">×</link>` (dismiss link)
- **Screenshot:** Red banner at top of page with full error text

### Phase 2: Additional Ephemeral Pattern Testing

#### Test 5: Herokuapp Notification (`https://the-internet.herokuapp.com/notification_message_rendered`)

- **Action:** Clicked "Click here" to trigger notification
- **Snapshot result:** Only `×` dismiss link, notification text missing
- **Same pattern** as login errors

#### Test 6: Herokuapp Dynamic Loading (`https://the-internet.herokuapp.com/dynamic_loading/1`)

- **Action:** Clicked "Start" to trigger loading → content reveal
- **Snapshot result:** No loading spinner or "Hello World!" text in snapshot
- **Observations:** `<appeared when="action">Loading...</appeared>` — loading text captured via observations
- **Note:** Post-loading "Hello World!" text not in snapshot either

#### Test 7: Herokuapp Hovers (`https://the-internet.herokuapp.com/hovers`)

- **Action:** Clicked on user avatar to trigger hover content
- **Snapshot result:** `<link>View profile</link>` captured (interactive), but **"name: user1"** heading text missing
- **Pattern:** Interactive children captured, non-interactive text content dropped

#### Test 8: MUI Snackbar (`https://mui.com/material-ui/react-snackbar/`)

- **Action:** Clicked "OPEN SNACKBAR" button
- **Snapshot result:** Only close button captured
- **Observations:** `<appeared when="action" role="presentation">Note archived UNDO</appeared>` — captured with `role="presentation"` (MUI's wrapper role)
- **Note:** Snackbar auto-dismissed before screenshot (very short-lived)

#### Test 9: MUI Success Snackbar

- **Action:** Clicked "SHOW SUCCESS SNACKBAR"
- **Snapshot result:** No snackbar content in snapshot
- **Observations:** `<appeared when="action">This is a success message!</appeared>` — captured

#### Test 10: MUI Alert Demos (`https://mui.com/material-ui/react-alert/`)

- **Action:** Navigated to page with static `role="alert"` demo elements
- **Snapshot result:** `<elt id="b63002979f64" kind="alert"></elt>` — alert container detected but **text content empty**. The container's `role="alert"` was recognized (it showed as `kind="alert"`) but its children were not included
- **Find results:** Text content discoverable as `unknown-*` eids (e.g., `unknown-145` = "This is a success Alert.")
- **Note:** The one alert that appeared was `#__next-route-announcer__`, a hidden Next.js element, not the visible demos

#### Test 11: MUI Cookie Dialog

- **Action:** Dismissed cookie consent dialog
- **Snapshot result:** Dialog was properly captured as modal layer (recognized `role="dialog"`)
- **Observations:** `<disappeared when="action" role="dialog">Cookie Preferences...</disappeared>` — full text captured on dismissal
- **Note:** This is the **control case** — `role="dialog"` works correctly because it's in `STRUCTURAL_AX_ROLES`

#### Test 12: DemoQA Practice Form (`https://demoqa.com/automation-practice-form`)

- **Action:** Submitted form with empty required fields
- **Snapshot result:** No validation errors in snapshot. Only CSS changes (red/green borders) visible in screenshot
- **Note:** DemoQA uses HTML5 validation with CSS classes, not ARIA roles — a different gap (CSS-only feedback)

### Phase 3: Comprehensive Test Page

Created `/tmp/ephemeral-test.html` with 14 distinct ephemeral patterns covering all ARIA live region roles and timing variations (500ms to persistent).

#### Pattern 1: Toast Notifications (`role="alert"`)

Tested 5 variants with durations from 500ms to 3s.

| Variant       | Duration | In Snapshot? | In Observations?                                       |
| ------------- | -------- | ------------ | ------------------------------------------------------ |
| Success Toast | 1s       | No           | No (appeared), Yes (disappeared on next action)        |
| Error Toast   | 2s       | No           | Yes — `<disappeared>` with correct text on next action |
| Warning Toast | 1.5s     | No           | No                                                     |
| Info Toast    | 3s       | No           | Yes — `<disappeared>` with correct text on next action |
| Fast Toast    | 500ms    | No           | No                                                     |

**Key observation:** Toast text is **only** captured when the toast _leaves_ the DOM (`<disappeared>`) during a subsequent action's observation window. It is never captured on appearance.

#### Pattern 2: Status Messages (`role="status"`, `aria-live="polite"`)

Tested "3 items added to cart" message that updates a persistent `role="status"` region.

- **In Snapshot:** No — the status region container exists in DOM but has unrecognized role
- **In Observations:** No — `textContent` mutation in an existing element may not trigger addedNodes mutation
- **Duration:** 2s before auto-clear

#### Pattern 3: Assertive Live Region (`aria-live="assertive"`, `role="alert"`)

Tested "Error: Payment declined. Card ending in 4242." with 2s duration.

- **In Snapshot:** No
- **In Observations:** No
- **Note:** Even with both `role="alert"` AND `aria-live="assertive"`, the element is invisible to the snapshot pipeline

#### Pattern 4: Snackbar with Action Button (`role="alert"`)

Tested Material Design snackbar with "Email archived." text and UNDO button.

- **In Snapshot:** `<btn id="a7ed65f48777">UNDO</btn>` — **only the interactive child** captured
- **In Observations:** `<disappeared role="alert" age_ms="14715">Email archived. UNDO</disappeared>` — text captured on removal during later action
- **Pattern:** Exactly mirrors GitHub/SauceDemo behavior — interactive children included, container text excluded

#### Pattern 5: Full-Width Top Banner (`role="alert"`)

Tested error banner with dismiss button, 2s duration.

- **In Snapshot:** `<btn id="7621c4775c96">×</btn>` — **only dismiss button** captured
- **In Observations:** Misidentified content (captured tooltip trigger button text instead of banner text)
- **Pattern:** Identical to Herokuapp login error and GitHub error — dismiss button visible, message text invisible

#### Pattern 6: Tooltip (`role="tooltip"`)

Tested tooltip on hover/focus.

- **In Snapshot:** No
- **In Observations:** No
- **Note:** `role="tooltip"` is not in any AX role category

#### Pattern 7: Inline Form Validation (persistent `role="alert"`)

Submitted empty form to trigger "Please enter a valid email address." and "Password must be at least 8 characters." errors with `role="alert"` and `aria-describedby`.

- **In Snapshot:** No — despite being **persistent** (not ephemeral), these are still excluded
- **In Observations:** No — elements appear via `display:block` style change, not DOM insertion (MutationObserver may not catch this)
- **Find query:** `find label="valid email"` → `eid="unknown-261" kind="text" label="Please enter a valid email address."` — **discoverable but with unknown eid**
- **Critical:** This proves the issue isn't about timing — even permanent `role="alert"` elements are excluded from snapshots

#### Pattern 8: Loading Overlay (`role="alert"` + `aria-busy`)

Tested full-page loading overlay with 2s duration.

- **In Snapshot:** No
- **In Observations:** `<appeared when="action" role="alert" delay_ms="200">⏳ Loading data...</appeared>` — **text correctly captured** during action window
- **Follow-up toast:** "Operation complete!" success toast was NOT captured
- **Note:** The overlay is a newly inserted DOM element, which the MutationObserver reliably detects. This is the observation system working as intended.

#### Pattern 9: Progress Bar (`role="progressbar"`)

Not fully tested in this session (lower priority).

#### Pattern 10: Notification Badge (`aria-live="polite"`)

Not fully tested in this session (attribute mutation, not DOM insertion).

#### Pattern 11: Confirmation Dialog (`role="dialog"`, `aria-modal="true"`)

Tested auto-confirming dialog (2s).

- **In Snapshot:** No — dialog appeared and disappeared within the action window
- **In Observations:** `<appeared when="action">Confirm Delete Are you sure you want to delete your account?...</appeared>` — **full text captured**
- **Note:** `role="dialog"` IS in `STRUCTURAL_AX_ROLES`, so if the dialog survived until snapshot time, it would have been included. The observation capture worked because the observer detected the DOM insertion.

#### Pattern 12: Dynamic Content Replacement (`role="status"`)

Tested Loading → Intermediate → Final content swap.

- **In Snapshot:** No content at any stage
- **In Observations:** Full lifecycle captured across two snapshots:
  1. `<appeared role="status">⏳ Loading content...</appeared>`
  2. `<appeared role="status">New content loaded!</appeared>` + `<disappeared role="status">⏳ Loading content...</disappeared>`
  3. `<appeared>Final settled content...</appeared>`
- **Note:** This is the observation system's best-case scenario — multiple DOM insertions/removals tracked sequentially

#### Pattern 13: Log Region (`role="log"`)

Not fully tested.

#### Pattern 14: Countdown Timer (`role="timer"`)

Tested 5s countdown.

- **In Snapshot:** No — timer text not visible
- **In Observations:** No — `textContent` changes without DOM structure changes
- **Note:** `role="timer"` not in any AX role category, and text mutations don't trigger observation capture

---

## Consolidated Findings

### Finding 1: Snapshot Exclusion is the Primary Issue

Every `role="alert"`, `role="status"`, `role="tooltip"`, `role="log"`, and `role="timer"` element is **systematically excluded** from snapshot nodes because these roles are not classified in `types.ts`. This is not a timing issue — even **persistent** elements with these roles are excluded.

**Evidence:** Form validation errors with `role="alert"` that remain in the DOM indefinitely are still absent from snapshots. Only discoverable via `find` with `unknown-*` eids.

### Finding 2: Interactive Children Leak Through

When an alert container has interactive children (dismiss buttons, undo links), those children appear in the snapshot because they have `INTERACTIVE_AX_ROLES`. But the container's text content is lost.

**Pattern observed on every site:**

```
Visible on page:    [⚠ Incorrect username or password.  ×]
                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^    ^
                     role="alert" text (EXCLUDED)         button (INCLUDED)

Snapshot output:    <btn>Dismiss this message</btn>
                    (no error text anywhere)
```

### Finding 3: Observation System Has Partial Coverage

| Scenario                                         | Observation Capture? | Notes                                                          |
| ------------------------------------------------ | -------------------- | -------------------------------------------------------------- |
| DOM node insertion (new element)                 | **Yes**              | Loading overlays, dialogs, dynamic content                     |
| DOM node removal                                 | **Yes**              | Toast dismissal, dialog close                                  |
| Text content mutation (existing element)         | **No**               | Status region updates, timer ticks                             |
| CSS visibility change (`display:none` → `block`) | **No**               | Form validation error show/hide                                |
| Short-lived elements (<1s)                       | **Unreliable**       | May complete lifecycle between observer ticks                  |
| `<appeared>` text accuracy                       | **Sometimes wrong**  | Observed tooltip trigger button reported instead of toast text |
| `<disappeared>` text accuracy                    | **Reliable**         | Text captured from removed node's textContent                  |

### Finding 4: Region Assignment Gap

**File:** `src/snapshot/extractors/region-resolver.ts`

Even if alert/status roles were added to the snapshot pipeline, the region resolver has no mapping for them. They would be assigned `region="unknown"` (normalized to "main"), losing the semantic distinction that they are feedback/notification elements rather than primary page content.

---

## Impact Assessment

### Affected User Workflows

1. **Form submission feedback** — Agent cannot determine if submission succeeded or failed
2. **Login/authentication** — Agent cannot read error messages to diagnose credential issues
3. **CRUD operations** — Agent cannot confirm save/delete/update succeeded
4. **Validation errors** — Agent cannot identify which fields need correction or what the rules are
5. **Loading states** — Agent cannot reliably detect when operations are in progress
6. **Tooltips/help text** — Agent cannot access contextual help for form fields
7. **Real-time updates** — Agent cannot see status changes, progress, or countdown timers
8. **Error recovery** — Agent cannot read error details needed to take corrective action

### Severity by Pattern

| Pattern                   | Frequency in Web Apps | Impact on Agent                 | Priority |
| ------------------------- | --------------------- | ------------------------------- | -------- |
| Toast/alert notifications | Very High             | Cannot determine action outcome | **P0**   |
| Form validation errors    | Very High             | Cannot correct form inputs      | **P0**   |
| Status messages           | High                  | Misses state transitions        | **P1**   |
| Loading indicators        | High                  | May interact during loading     | **P1**   |
| Tooltips                  | Medium                | Misses contextual help          | **P2**   |
| Progress bars             | Medium                | Cannot monitor long operations  | **P2**   |
| Log regions               | Low                   | Cannot read activity feeds      | **P3**   |
| Timer elements            | Low                   | Cannot see countdowns           | **P3**   |

---

## Proposed Fix Plan

### Phase 1: Add Missing ARIA Roles to Classification (P0)

**File:** `src/snapshot/extractors/types.ts`

Add a new role category `LIVE_REGION_AX_ROLES` or extend `READABLE_AX_ROLES`:

```typescript
// Option A: New dedicated category
export const LIVE_REGION_AX_ROLES = new Set([
  'alert',
  'alertdialog', // already in STRUCTURAL, keep there too
  'status',
  'log',
  'marquee',
  'timer',
]);

// Option B: Extend READABLE (simpler, less disruptive)
// Add to existing READABLE_AX_ROLES:
//   'alert', 'status', 'log', 'timer'
```

**File:** `src/snapshot/snapshot-compiler.ts`

Update the node inclusion filter to recognize the new roles:

```typescript
// Current (line ~560):
const essentialStructuralRoles = new Set(['form', 'dialog', 'alertdialog']);

// Proposed:
const essentialStructuralRoles = new Set([
  'form',
  'dialog',
  'alertdialog',
  'alert',
  'status',
  'log',
  'timer',
  'tooltip',
  'progressbar',
]);
```

**Expected outcome:** Alert/status/tooltip containers and their text content will appear in snapshot nodes with proper eids.

**Testing:** Re-run all tests from this investigation against the ephemeral test page and real-world sites.

### Phase 2: Add Tooltip Role Support (P2)

**File:** `src/snapshot/extractors/types.ts`

Add `tooltip` to the role classification. Tooltips are short-lived but important for understanding UI context.

### Phase 3: Region Resolver Update (P1)

**File:** `src/snapshot/extractors/region-resolver.ts`

Add region mappings for live region roles:

```typescript
// Add to region mapping:
'alert' → 'alert'      // or 'feedback'
'status' → 'status'    // or 'feedback'
'log' → 'log'
'tooltip' → 'tooltip'
```

This allows agents to distinguish feedback elements from primary content in the snapshot XML.

### Phase 4: Observation Accuracy Improvements (P1)

**File:** `src/observation/observer-script.ts`

1. **Fix `<appeared>` text capture:** Investigate why tooltip trigger buttons appear instead of toast text in `<appeared>` observations. Likely a DOM subtree boundary issue where the observer reports the nearest significant ancestor instead of the actual inserted node.

2. **Add `characterData` observation:** Configure MutationObserver with `characterData: true` and `characterDataOldValue: true` to capture text-only mutations in live regions (status messages, timer updates).

3. **Add CSS visibility tracking:** Detect `display` and `visibility` changes that make hidden elements visible (form validation errors toggled via `display:none` → `display:block`).

### Phase 5: Layer Detector Enhancement (P2)

**File:** `src/state/layer-detector.ts`

Add toast/alert detection as a lightweight overlay layer:

```typescript
// New layer type: 'toast' (lower priority than modal/drawer)
// Detection: role="alert" or role="status" with:
//   - position: fixed or absolute
//   - high z-index
//   - visible in viewport
```

This would allow the snapshot to surface active toasts prominently, similar to how modals are currently prioritized.

### Phase 6: Heuristic Toast Detection for Unsemantic Libraries (P1)

**Problem:** Popular toast libraries like [Sonner](https://sonner.emilkowal.dev/) do not use ARIA `role="alert"`. Instead they use custom data attributes (`data-sonner-toast`, `data-sonner-toaster`) and plain `<div>` elements. The DOM structure looks like:

```html
<ol data-sonner-toaster="true" data-sonner-theme="light" data-y-position="bottom">
  <li data-sonner-toast="" data-visible="true" data-front="true">
    <div data-content="">
      <div data-title="">Error de inicio de sesión</div>
      <div data-description="">Your account has been locked...</div>
    </div>
  </li>
</ol>
```

**Known unsemantic toast libraries:**

- **Sonner** — `[data-sonner-toaster]` container, `[data-sonner-toast]` items
- **react-hot-toast** — `[data-hot-toast]` or `div[role="status"]` (sometimes)
- **Notistack** — MUI Snackbar wrapper, `[class*="notistack"]`
- **Toastify** — `.Toastify__toast-container`

**Detection approach:**

1. Extend the observer script to detect common toast library selectors
2. Treat matched elements as implicit `role="alert"` for snapshot inclusion
3. Extract `data-title` and `data-description` (or child text) as the label

**Files to modify:**

- `src/observation/observer-script.ts` — Add toast library selector matching to significance scoring
- `src/snapshot/snapshot-compiler.ts` — Add heuristic detection for unsemantic toast containers
- `src/state/layer-detector.ts` — Detect toast containers as overlay layers

---

## Implementation Status

### Completed (Phases 1-3)

The following changes have been implemented and verified:

| Change                                            | File                                         | Status  |
| ------------------------------------------------- | -------------------------------------------- | ------- |
| `LIVE_REGION_AX_ROLES` constant                   | `src/snapshot/extractors/types.ts`           | ✅ Done |
| `classifyAxRole()` returns `'live'`               | `src/snapshot/extractors/ax-extractor.ts`    | ✅ Done |
| Snapshot compiler includes live region nodes      | `src/snapshot/snapshot-compiler.ts`          | ✅ Done |
| `textContent` fallback for empty alert labels     | `src/snapshot/snapshot-compiler.ts`          | ✅ Done |
| New `NodeKind` values (alert, status, log, etc.)  | `src/snapshot/snapshot.types.ts`             | ✅ Done |
| `isLiveRegionNode()` type guard                   | `src/snapshot/snapshot.types.ts`             | ✅ Done |
| Region resolver maps live roles → `'alert'`       | `src/snapshot/extractors/region-resolver.ts` | ✅ Done |
| XML renders `<alert>` tags with kind attribute    | `src/state/state-renderer.ts`                | ✅ Done |
| `find kind="alert"` returns all live region kinds | `src/tools/browser-tools.ts`                 | ✅ Done |
| `isLiveRegionNode` in find eid assignment         | `src/tools/browser-tools.ts`                 | ✅ Done |
| Actionables filter includes live region nodes     | `src/state/actionables-filter.ts`            | ✅ Done |
| `isLiveRegionKind` in state manager count         | `src/state/state-manager.ts`                 | ✅ Done |

### Verification Results

| Test                                                       | Before Fix                  | After Fix                                                                                      |
| ---------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| **GitHub login error**                                     | Only dismiss button visible | `<alert>Incorrect username or password.</alert>` in `<region name="alert">`                    |
| **Test page: Form validation** (persistent `role="alert"`) | Completely invisible        | `<alert>Please enter a valid email address.</alert>` with stable eid                           |
| **Test page: Error toast** (2s, `role="alert"`)            | Completely invisible        | `<alert>Failed to save. Please try again.</alert>` in diff + alert region                      |
| **Test page: Info toast** (3s)                             | Completely invisible        | `<alert>New version available. Refresh to update.</alert>` in alert region                     |
| **Test page: Log region** (`role="log"`)                   | Completely invisible        | `<alert kind="log">Activity log</alert>` in baseline                                           |
| **`find kind="alert"`**                                    | Not available               | Returns all live region elements with proper eids                                              |
| **Vonnue BSS toast** (Sonner library, no ARIA roles)       | Invisible                   | Alert container detected, but toast uses `data-sonner-*` not `role="alert"` — requires Phase 6 |

### Remaining Work (Phases 4-6)

| Phase   | Description                                                             | Priority | Status      |
| ------- | ----------------------------------------------------------------------- | -------- | ----------- |
| Phase 4 | Observation accuracy — `characterData` tracking, CSS visibility changes | P1       | Not started |
| Phase 5 | Layer detector — toast overlay detection                                | P2       | Not started |
| Phase 6 | Heuristic detection for unsemantic toast libraries (Sonner, etc.)       | P1       | Not started |

---

## Test Artifacts

- **Ephemeral test page:** `/tmp/ephemeral-test.html` — 14 patterns covering all ARIA live region roles
- **Screenshots captured** during testing for visual verification
- **Test sites used:** Vonnue BSS, GitHub, SauceDemo, Herokuapp (login, notification, dynamic loading, hovers), MUI (snackbar, alert), DemoQA

---

## Appendix A: ARIA Live Region Roles Reference

Per [WAI-ARIA 1.2 Specification](https://www.w3.org/TR/wai-aria-1.2/):

| Role          | Description                                      | Implicit `aria-live` |
| ------------- | ------------------------------------------------ | -------------------- |
| `alert`       | Important, time-sensitive message                | `assertive`          |
| `alertdialog` | Alert dialog requiring user response             | N/A (modal)          |
| `status`      | Advisory information, less urgent than alert     | `polite`             |
| `log`         | Appended sequential information                  | `polite`             |
| `marquee`     | Non-essential scrolling information              | `off`                |
| `timer`       | Numerical counter showing elapsed/remaining time | `off`                |
| `tooltip`     | Contextual popup on hover/focus                  | N/A                  |
| `progressbar` | Progress indicator for long-running tasks        | N/A                  |

All of these except `alertdialog` were previously unrecognized by the snapshot pipeline. Phases 1-3 now handle them.

## Appendix B: Unsemantic Toast Libraries

Common toast/notification libraries that do NOT use ARIA roles and require heuristic detection:

| Library            | Selector                                       | Notes                                             |
| ------------------ | ---------------------------------------------- | ------------------------------------------------- |
| Sonner             | `[data-sonner-toaster]`, `[data-sonner-toast]` | Uses `data-title`, `data-description` for content |
| react-hot-toast    | `[data-hot-toast]`                             | Sometimes uses `role="status"`                    |
| Notistack          | `[class*="notistack"]`                         | MUI Snackbar wrapper                              |
| React-Toastify     | `.Toastify__toast-container`                   | Class-based detection                             |
| Chakra UI Toast    | `[class*="chakra-toast"]`                      | Portal-rendered                                   |
| Ant Design Message | `.ant-message`                                 | Global message component                          |
