# Manual Test Plan - Athena Browser MCP

Comprehensive test plan for all MCP tools with the new simplified API.

## Prerequisites

1. Build: `npm run build`
2. Start MCP server or use with Claude Desktop
3. Test sites: public websites or localhost test servers

---

## Tool Reference

| Tool       | Purpose                                |
| ---------- | -------------------------------------- |
| `open`     | Start browser session                  |
| `close`    | End browser session                    |
| `goto`     | Navigate (URL, back, forward, refresh) |
| `snapshot` | Capture page state                     |
| `find`     | Query elements                         |
| `click`    | Click element                          |
| `type`     | Type text                              |
| `press`    | Press keyboard key                     |
| `select`   | Choose dropdown option                 |
| `hover`    | Hover over element                     |
| `scroll`   | Scroll page/element                    |

---

## Suite 1: Session Management

### 1.1 Open Browser (Visible)

```json
{ "tool": "open", "input": { "headless": false } }
```

**Verify:**

- [ ] Browser window opens
- [ ] Returns `page_id`, `url`, `title`
- [ ] Returns `page_state` with initial info

### 1.2 Open Browser (Headless)

```json
{ "tool": "open", "input": { "headless": true } }
```

**Verify:**

- [ ] No visible window
- [ ] Returns valid `page_id`

### 1.3 Open Browser (Connect Mode)

**Prerequisite:** `google-chrome --remote-debugging-port=9222`

```json
{ "tool": "open", "input": { "connect_to": "http://localhost:9222" } }
```

**Verify:**

- [ ] Connects to existing browser
- [ ] Can interact with existing tabs

### 1.4 Close Session

```json
{ "tool": "close", "input": {} }
```

**Verify:**

- [ ] Browser closes
- [ ] Returns `{ "closed": true }`

### 1.5 Close Specific Page

```json
{ "tool": "close", "input": { "page_id": "<id>" } }
```

**Verify:**

- [ ] Only target page closes
- [ ] Other pages remain

---

## Suite 2: Navigation

### 2.1 Navigate to URL

```json
{ "tool": "goto", "input": { "url": "https://example.com" } }
```

**Verify:**

- [ ] Page loads
- [ ] Returns `delta.action` describing navigation
- [ ] `page_state` updated

### 2.2 Navigate to Form Page

```json
{ "tool": "goto", "input": { "url": "https://github.com/login" } }
```

**Verify:**

- [ ] `page_state` includes form info
- [ ] Form fields detected (username, password)

### 2.3 Go Back

**Prerequisite:** Navigate to 2+ pages first

```json
{ "tool": "goto", "input": { "back": true } }
```

**Verify:**

- [ ] URL matches previous page
- [ ] `delta.changes` includes navigation

### 2.4 Go Forward

**Prerequisite:** Went back in history

```json
{ "tool": "goto", "input": { "forward": true } }
```

**Verify:**

- [ ] Returns to page before going back

### 2.5 Refresh

```json
{ "tool": "goto", "input": { "refresh": true } }
```

**Verify:**

- [ ] Page reloads
- [ ] Fresh snapshot captured

---

## Suite 3: Snapshot & Query

### 3.1 Capture Snapshot

```json
{ "tool": "snapshot", "input": {} }
```

**Verify:**

- [ ] Returns `snapshot_id`
- [ ] `page_state` includes forms, actions, dialogs
- [ ] `node_count` > 0

### 3.2 Find by Kind

**Test on Google.com:**

```json
{ "tool": "find", "input": { "kind": "button" } }
```

**Verify:**

- [ ] Returns buttons on page
- [ ] Each has `node_id`, `label`, `kind`

### 3.3 Find by Label

```json
{ "tool": "find", "input": { "label": "search" } }
```

**Verify:**

- [ ] Returns elements with "search" in label
- [ ] Fuzzy matching works

### 3.4 Find by Region

```json
{ "tool": "find", "input": { "region": "header" } }
```

**Verify:**

- [ ] Only header elements returned

### 3.5 Combined Filters

```json
{ "tool": "find", "input": { "kind": "input", "region": "main" } }
```

**Verify:**

- [ ] Filters combine (AND logic)

---

## Suite 4: Click

### 4.1 Click Element

**Setup:** Find a link first with `find { "kind": "link" }`

```json
{ "tool": "click", "input": { "node_id": "<link_id>" } }
```

**Verify:**

- [ ] Element clicked
- [ ] `delta.action` describes click
- [ ] Navigation if link

### 4.2 Click Opens Modal

**Test on site with modal:**

```json
{ "tool": "click", "input": { "node_id": "<modal_trigger>" } }
```

**Verify:**

- [ ] `delta.changes` includes `{ "type": "modal_opened" }`
- [ ] Modal info in `page_state`

### 4.3 Click Invalid Element

```json
{ "tool": "click", "input": { "node_id": "99999999" } }
```

**Verify:**

- [ ] Error with descriptive message
- [ ] Browser doesn't crash

---

## Suite 5: Type

### 5.1 Type in Input

**Setup:** Find input with `find { "kind": "input" }`

```json
{ "tool": "type", "input": { "node_id": "<input_id>", "text": "hello world" } }
```

**Verify:**

- [ ] Text appears in input
- [ ] `delta.changes` includes `{ "type": "filled" }`

### 5.2 Type Without node_id

**Setup:** Click input first to focus

```json
{ "tool": "type", "input": { "text": "typed text" } }
```

**Verify:**

- [ ] Text in currently focused element

### 5.3 Type with Clear

```json
{ "tool": "type", "input": { "node_id": "<id>", "text": "new", "clear": true } }
```

**Verify:**

- [ ] Old text cleared
- [ ] Only new text present

### 5.4 Type Special Characters

```json
{ "tool": "type", "input": { "node_id": "<id>", "text": "test@example.com" } }
```

**Verify:**

- [ ] Email typed correctly

---

## Suite 6: Press Key

### 6.1 Press Enter (Submit Form)

**Setup:** Fill form first

```json
{ "tool": "press", "input": { "key": "Enter" } }
```

**Verify:**

- [ ] Form submitted
- [ ] `delta.changes` may include `form_submitted`, `navigation`

### 6.2 Press Tab (Focus Change)

```json
{ "tool": "press", "input": { "key": "Tab" } }
```

**Verify:**

- [ ] Focus moves
- [ ] `delta.changes` includes `{ "type": "focused" }`

### 6.3 Press Escape (Close Modal)

**Setup:** Open modal first

```json
{ "tool": "press", "input": { "key": "Escape" } }
```

**Verify:**

- [ ] Modal closes
- [ ] `delta.changes` includes `{ "type": "modal_closed" }`

### 6.4 Press Arrow Keys

```json
{ "tool": "press", "input": { "key": "ArrowDown" } }
```

**Verify:**

- [ ] Selection/focus moves

### 6.5 Press with Modifiers

```json
{ "tool": "press", "input": { "key": "a", "modifiers": ["Control"] } }
```

**Verify:**

- [ ] Ctrl+A selects all (if in input)

### 6.6 Press Unknown Key

```json
{ "tool": "press", "input": { "key": "InvalidKey" } }
```

**Verify:**

- [ ] Error lists supported keys

**Supported Keys:** Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown

---

## Suite 7: Select Dropdown

### 7.1 Select by Value

**Test on form with dropdown:**

```json
{ "tool": "select", "input": { "node_id": "<select_id>", "value": "US" } }
```

**Verify:**

- [ ] Option selected
- [ ] `delta.changes` includes `{ "type": "selected" }`

### 7.2 Select by Visible Text

```json
{ "tool": "select", "input": { "node_id": "<id>", "value": "United States" } }
```

**Verify:**

- [ ] Matches by visible text

### 7.3 Select Invalid Option

```json
{ "tool": "select", "input": { "node_id": "<id>", "value": "NotReal" } }
```

**Verify:**

- [ ] Error lists available options

### 7.4 Select on Non-Select Element

```json
{ "tool": "select", "input": { "node_id": "<button_id>", "value": "x" } }
```

**Verify:**

- [ ] Error: "Element is not a <select> element"

---

## Suite 8: Hover

### 8.1 Hover Over Element

```json
{ "tool": "hover", "input": { "node_id": "<element_id>" } }
```

**Verify:**

- [ ] Mouse moves to element
- [ ] Hover effects triggered (if any)

### 8.2 Hover Reveals Menu

**Test on site with hover menus:**

```json
{ "tool": "hover", "input": { "node_id": "<menu_trigger>" } }
```

**Verify:**

- [ ] Dropdown menu appears
- [ ] New elements visible in next snapshot

---

## Suite 9: Scroll

### 9.1 Scroll Element Into View

```json
{ "tool": "scroll", "input": { "node_id": "<below_fold_id>" } }
```

**Verify:**

- [ ] Element now visible
- [ ] Can interact with element

### 9.2 Scroll Page Down

```json
{ "tool": "scroll", "input": { "direction": "down" } }
```

**Verify:**

- [ ] Viewport moves down

### 9.3 Scroll Page Up

```json
{ "tool": "scroll", "input": { "direction": "up" } }
```

**Verify:**

- [ ] Viewport moves up

### 9.4 Scroll Custom Amount

```json
{ "tool": "scroll", "input": { "direction": "down", "amount": 1000 } }
```

**Verify:**

- [ ] Scrolls 1000px

---

## Suite 10: End-to-End Workflows

### 10.1 Google Search

```
1. open { "headless": false }
2. goto { "url": "https://www.google.com" }
3. find { "kind": "input" }
4. click { "node_id": "<search_input>" }
5. type { "text": "MCP protocol" }
6. press { "key": "Enter" }
7. find { "kind": "link", "region": "main" }
8. click { "node_id": "<first_result>" }
9. close {}
```

**Verify:** All steps complete without errors

---

### 10.2 Login Flow

**Test Site:** https://the-internet.herokuapp.com/login

```
1. open {}
2. goto { "url": "https://the-internet.herokuapp.com/login" }
3. find { "kind": "input" }
4. type { "node_id": "<username>", "text": "tomsmith" }
5. press { "key": "Tab" }
6. type { "text": "SuperSecretPassword!" }
7. find { "kind": "button", "label": "Login" }
8. click { "node_id": "<login_btn>" }
9. Verify success message
```

**Verify:** Login succeeds, success message displayed

---

### 10.3 Form with Dropdown

```
1. goto { "url": "<form_url>" }
2. find { "kind": "select" }
3. select { "node_id": "<dropdown>", "value": "<option>" }
4. find { "kind": "input" }
5. type { "node_id": "<input>", "text": "test" }
6. find { "kind": "button", "label": "submit" }
7. click { "node_id": "<submit>" }
```

**Verify:** Form submits with selections

---

### 10.4 Navigation History

```
1. open {}
2. goto { "url": "https://example.com" }
3. find { "kind": "link" }
4. click { "node_id": "<link>" }
5. goto { "back": true }  // Should return to example.com
6. goto { "forward": true }  // Should return to linked page
7. goto { "refresh": true }  // Should reload
```

**Verify:** Back/forward/refresh all work

---

### 10.5 Modal Handling

```
1. goto { "url": "<site_with_modal>" }
2. click { "node_id": "<modal_trigger>" }
3. Verify modal_opened in delta
4. press { "key": "Escape" }
5. Verify modal_closed in delta
```

**Verify:** Modal detection and dismissal work

---

### 10.6 Scroll and Interact

```
1. goto { "url": "<long_page>" }
2. scroll { "direction": "down", "amount": 2000 }
3. snapshot {}
4. find { "kind": "button" }  // Find below-fold button
5. scroll { "node_id": "<button_id>" }  // Scroll to it
6. click { "node_id": "<button_id>" }
```

**Verify:** Can scroll and interact with below-fold elements

---

## Suite 11: Advanced Scenarios

### 11.1 Multi-page switching

**Setup:** Open two different URLs in sequence.

```json
1. open { "headless": false }
2. goto { "url": "https://example.com" }
3. goto { "url": "https://google.com" }
4. snapshot {}
```

**Verify:**

- [ ] `page_state` reflects the most recent page
- [ ] Multiple pages are active in the browser (if visible)

### 11.2 Iframe interaction

**Test Site:** https://the-internet.herokuapp.com/iframe

```json
1. goto { "url": "https://the-internet.herokuapp.com/iframe" }
2. find { "kind": "text" }
```

**Verify:**

- [ ] Elements inside IFrames are detected and interactable

### 11.3 Checkboxes and Radio Buttons

**Test Site:** https://the-internet.herokuapp.com/checkboxes

```json
1. goto { "url": "https://the-internet.herokuapp.com/checkboxes" }
2. find { "kind": "checkbox" }
3. click { "node_id": "<checkbox_id>" }
```

**Verify:**

- [ ] Checkboxes are detected
- [ ] `click` toggles the state

### 11.4 Handling JS Alerts

**Test Site:** https://the-internet.herokuapp.com/javascript_alerts

```json
1. goto { "url": "https://the-internet.herokuapp.com/javascript_alerts" }
2. click { "node_id": "<alert_trigger_btn>" }
3. Verify if snapshot captures alert state or if MCP provides a way to dismiss
```

**Verify:**

- [ ] Browser doesn't hang on native dialogs
- [ ] (If supported) Dialog info appears in `page_state`

### 11.5 Dynamic Content loading

**Test Site:** https://the-internet.herokuapp.com/dynamic_loading/1

```json
1. goto { "url": "https://the-internet.herokuapp.com/dynamic_loading/1" }
2. click { "node_id": "<start_btn>" }
3. snapshot {} // Wait and repeat until "Hello World!" appears
```

**Verify:**

- [ ] `snapshot` eventually captures the dynamically loaded element

### 11.6 Cookie Consent - Accept All

**Test Site:** https://www.economist.com

**Task:** Accept all cookies.

**Verify:**

- [ ] Cookie consent dialog detected
- [ ] Layer changes to `modal` when dialog opens
- [ ] Iframe elements have valid eids (not `unknown-*`)
- [ ] Cookies accepted successfully
- [ ] Dialog dismisses after acceptance

### 11.7 Cookie Consent - Full Extraction

**Test Site:** https://www.economist.com

**Task:** Extract all cookie consent information including purposes, features, and partners.

**Verify:**

- [ ] All cookie purposes/categories extracted
- [ ] All features extracted
- [ ] All partners/vendors extracted
- [ ] Descriptions captured for each item

### 11.8 Cookie Consent - Enable Specific Cookies

**Test Site:** https://www.economist.com

**Task:** Enable only these 3 specific cookie purposes and save:

1. Create profiles for personalised advertising
2. Measure advertising performance
3. Analytics

**Verify:**

- [ ] Only the 3 specified purposes enabled
- [ ] Other purposes remain disabled
- [ ] Preferences saved successfully
- [ ] Dialog dismisses after save

---

## Suite 12: DOM Observations

Tests for ephemeral DOM mutation capture (toasts, alerts, notifications).

### 12.1 Toast Capture - Local Test Page

**Test Site:** `file:///path/to/athena-browser-mcp/tests/manual/toast-test.html`

**Task:** Trigger an error toast notification.

**Verify:**

- [ ] Response contains `<observations>` section
- [ ] `<during_action>` shows `<appeared>` with `role="alert"`
- [ ] Significance score >= 3
- [ ] Content text captured correctly

### 12.2 Toast Capture - Real Website

**Test Site:** https://react-hot-toast.com/

**Task:** Trigger a toast notification.

**Verify:**

- [ ] Toast notification captured with `role="status"`
- [ ] Semantic signals (`alert-role`, `aria-live`) detected
- [ ] `delayed="true"` signal present (appeared after page load)

### 12.3 Dialog Toast Capture

**Test Site:** Local toast test page

**Task:** Trigger a dialog toast, then dismiss it.

**Verify:**

- [ ] Dialog toast captured with `role="alertdialog"`
- [ ] `layer="modal"` in response
- [ ] Dismissal captured as `<disappeared>`
- [ ] `has-interactives="true"` when dialog has buttons

### 12.4 Observation Deduplication

**Test Site:** Local toast test page

**Task:** Trigger a toast, then capture another snapshot without triggering new toasts.

**Verify:**

- [ ] Toast appears in first response
- [ ] Same toast does NOT appear in subsequent snapshot
- [ ] Deduplication prevents duplicate reporting

### 12.5 Accumulated Observations (sincePrevious)

**Test Site:** Local toast test page

**Task:** Trigger a toast, wait for it to disappear, then trigger another toast.

**Verify:**

- [ ] `<during_action>` shows new toast appearance
- [ ] `<since_previous>` shows first toast disappearance
- [ ] `age_ms` attribute present on since_previous items

### 12.6 Below-Threshold Elements NOT Captured

**Test Site:** Any page with dynamic content

**Task:** Trigger small, non-significant DOM changes (e.g., minor text updates, hidden element changes).

**Verify:**

- [ ] Only elements with significance >= 3 captured
- [ ] Small divs without ARIA roles NOT captured
- [ ] Insignificant text changes NOT captured

### 12.7 Login Error Toast

**Test Site:** https://the-internet.herokuapp.com/login

**Task:** Navigate to the login page, enter invalid credentials, and submit the form.

**Verify:**

- [ ] Error flash message captured in `<observations>` section
- [ ] Appears in `<during_action>` (triggered by form submission)
- [ ] Error message text content preserved
- [ ] Significance score >= 3

### 12.8 Observer Staleness Recovery

**Test Site:** Any two different sites (e.g., example.com then google.com)

**Task:** Navigate to one site, then navigate to a different site, then perform an action that triggers a DOM change.

**Verify:**

- [ ] Observer re-injects after navigation to new site
- [ ] Observations captured correctly on the new page
- [ ] No stale observer errors

---

## Test Results

| Suite | Test                   | Pass | Fail | Notes |
| ----- | ---------------------- | ---- | ---- | ----- |
| 1     | 1.1 Open Visible       |      |      |       |
| 1     | 1.2 Open Headless      |      |      |       |
| 1     | 1.3 Open Connect       |      |      |       |
| 1     | 1.4 Close Session      |      |      |       |
| 1     | 1.5 Close Page         |      |      |       |
| 2     | 2.1 Navigate URL       |      |      |       |
| 2     | 2.2 Navigate Form      |      |      |       |
| 2     | 2.3 Go Back            |      |      |       |
| 2     | 2.4 Go Forward         |      |      |       |
| 2     | 2.5 Refresh            |      |      |       |
| 3     | 3.1 Snapshot           |      |      |       |
| 3     | 3.2 Find Kind          |      |      |       |
| 3     | 3.3 Find Label         |      |      |       |
| 3     | 3.4 Find Region        |      |      |       |
| 3     | 3.5 Find Combined      |      |      |       |
| 4     | 4.1 Click              |      |      |       |
| 4     | 4.2 Click Modal        |      |      |       |
| 4     | 4.3 Click Invalid      |      |      |       |
| 5     | 5.1 Type Input         |      |      |       |
| 5     | 5.2 Type Focused       |      |      |       |
| 5     | 5.3 Type Clear         |      |      |       |
| 5     | 5.4 Type Special       |      |      |       |
| 6     | 6.1 Press Enter        |      |      |       |
| 6     | 6.2 Press Tab          |      |      |       |
| 6     | 6.3 Press Escape       |      |      |       |
| 6     | 6.4 Press Arrow        |      |      |       |
| 6     | 6.5 Press Modifier     |      |      |       |
| 6     | 6.6 Press Unknown      |      |      |       |
| 7     | 7.1 Select Value       |      |      |       |
| 7     | 7.2 Select Text        |      |      |       |
| 7     | 7.3 Select Invalid     |      |      |       |
| 7     | 7.4 Select Non-Select  |      |      |       |
| 8     | 8.1 Hover              |      |      |       |
| 8     | 8.2 Hover Menu         |      |      |       |
| 9     | 9.1 Scroll Element     |      |      |       |
| 9     | 9.2 Scroll Down        |      |      |       |
| 9     | 9.3 Scroll Up          |      |      |       |
| 9     | 9.4 Scroll Amount      |      |      |       |
| 10    | 10.1 Google Search     |      |      |       |
| 10    | 10.2 Login Flow        |      |      |       |
| 10    | 10.3 Form Dropdown     |      |      |       |
| 10    | 10.4 Nav History       |      |      |       |
| 10    | 10.5 Modal             |      |      |       |
| 10    | 10.6 Scroll Interact   |      |      |       |
| 11    | 11.1 Multi-page        |      |      |       |
| 11    | 11.2 Iframe            |      |      |       |
| 11    | 11.3 Checkbox/Radio    |      |      |       |
| 11    | 11.4 JS Alerts         |      |      |       |
| 11    | 11.5 Dynamic Content   |      |      |       |
| 11    | 11.6 Cookie Consent    |      |      |       |
| 11    | 11.7 Efficient Extract |      |      |       |
| 11    | 11.8 Specific Cookies  |      |      |       |
| 12    | 12.1 Toast Local       |      |      |       |
| 12    | 12.2 Toast Real Site   |      |      |       |
| 12    | 12.3 Dialog Toast      |      |      |       |
| 12    | 12.4 Deduplication     |      |      |       |
| 12    | 12.5 Accumulated Obs   |      |      |       |
| 12    | 12.6 Below Threshold   |      |      |       |
| 12    | 12.7 Login Error       |      |      |       |
| 12    | 12.8 Staleness Recov   |      |      |       |

---

## Regression Checklist

After code changes:

- [ ] All 12 suites pass
- [ ] Error messages are descriptive
- [ ] No memory leaks (browser cleanup)
- [ ] Headless mode works
- [ ] Connect mode works
- [ ] DOM observations capture toasts/alerts
- [ ] Delta responses accurate
- [ ] Page state updates correctly
