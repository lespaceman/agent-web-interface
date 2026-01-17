# Test Plan - Athena Browser MCP

Comprehensive test plan for all MCP tools.

## Prerequisites

1. Build: `npm run build`
2. Start MCP server or use with Claude Desktop
3. Test sites: public websites or localhost test servers

---

## Tool Reference

| Tool                       | Purpose                             |
| -------------------------- | ----------------------------------- |
| `launch_browser`           | Start browser session               |
| `connect_browser`          | Connect to existing browser via CDP |
| `close_page`               | Close a specific page               |
| `close_session`            | End browser session                 |
| `navigate`                 | Navigate to URL                     |
| `go_back`                  | Navigate back in history            |
| `go_forward`               | Navigate forward in history         |
| `reload`                   | Reload current page                 |
| `capture_snapshot`         | Capture page state                  |
| `find_elements`            | Query elements by kind/label/region |
| `get_node_details`         | Get full details for an element     |
| `click`                    | Click element                       |
| `type`                     | Type text                           |
| `press`                    | Press keyboard key                  |
| `select`                   | Choose dropdown option              |
| `hover`                    | Hover over element                  |
| `scroll_page`              | Scroll page up/down                 |
| `scroll_element_into_view` | Scroll element into view            |

---

## Suite 1: Session Management

### 1.1 Launch Browser (Visible)

```json
{ "tool": "launch_browser", "input": { "headless": false } }
```

**Verify:**

- [ ] Browser window opens
- [ ] Returns `page_id`, `url`, `title`

### 1.2 Launch Browser (Headless)

```json
{ "tool": "launch_browser", "input": { "headless": true } }
```

**Verify:**

- [ ] No visible window
- [ ] Returns valid `page_id`

### 1.3 Connect Browser (CDP)

**Prerequisite:** `google-chrome --remote-debugging-port=9222`

```json
{ "tool": "connect_browser", "input": { "endpoint_url": "http://localhost:9222" } }
```

**Verify:**

- [ ] Connects to existing browser
- [ ] Can interact with existing tabs

### 1.4 Close Session

```json
{ "tool": "close_session", "input": {} }
```

**Verify:**

- [ ] Browser closes
- [ ] Returns success

### 1.5 Close Specific Page

```json
{ "tool": "close_page", "input": { "page_id": "<id>" } }
```

**Verify:**

- [ ] Only target page closes
- [ ] Other pages remain

---

## Suite 2: Navigation

### 2.1 Navigate to URL

```json
{ "tool": "navigate", "input": { "url": "https://example.com" } }
```

**Verify:**

- [ ] Page loads
- [ ] Returns snapshot

### 2.2 Navigate to Form Page

```json
{ "tool": "navigate", "input": { "url": "https://github.com/login" } }
```

**Verify:**

- [ ] Form fields detected (username, password)

### 2.3 Go Back

**Prerequisite:** Navigate to 2+ pages first

```json
{ "tool": "go_back", "input": {} }
```

**Verify:**

- [ ] URL matches previous page

### 2.4 Go Forward

**Prerequisite:** Went back in history

```json
{ "tool": "go_forward", "input": {} }
```

**Verify:**

- [ ] Returns to page before going back

### 2.5 Reload

```json
{ "tool": "reload", "input": {} }
```

**Verify:**

- [ ] Page reloads
- [ ] Fresh snapshot captured

---

## Suite 3: Snapshot & Query

### 3.1 Capture Snapshot

```json
{ "tool": "capture_snapshot", "input": {} }
```

**Verify:**

- [ ] Returns snapshot data
- [ ] Contains page elements

### 3.2 Find by Kind

**Test on Google.com:**

```json
{ "tool": "find_elements", "input": { "kind": "button" } }
```

**Verify:**

- [ ] Returns buttons on page
- [ ] Each has `eid`, `label`, `kind`

### 3.3 Find by Label

```json
{ "tool": "find_elements", "input": { "label": "search" } }
```

**Verify:**

- [ ] Returns elements with "search" in label
- [ ] Fuzzy matching works

### 3.4 Find by Region

```json
{ "tool": "find_elements", "input": { "region": "header" } }
```

**Verify:**

- [ ] Only header elements returned

### 3.5 Combined Filters

```json
{ "tool": "find_elements", "input": { "kind": "textbox", "region": "main" } }
```

**Verify:**

- [ ] Filters combine (AND logic)

### 3.6 Get Node Details

```json
{ "tool": "get_node_details", "input": { "eid": "<element_id>" } }
```

**Verify:**

- [ ] Returns full element details

---

## Suite 4: Click

### 4.1 Click Element

**Setup:** Find a link first with `find_elements { "kind": "link" }`

```json
{ "tool": "click", "input": { "eid": "<link_id>" } }
```

**Verify:**

- [ ] Element clicked
- [ ] Navigation if link

### 4.2 Click Opens Modal

**Test on site with modal:**

```json
{ "tool": "click", "input": { "eid": "<modal_trigger>" } }
```

**Verify:**

- [ ] Modal opens
- [ ] Modal info in snapshot

### 4.3 Click Invalid Element

```json
{ "tool": "click", "input": { "eid": "99999999" } }
```

**Verify:**

- [ ] Error with descriptive message
- [ ] Browser doesn't crash

---

## Suite 5: Type

### 5.1 Type in Input

**Setup:** Find input with `find_elements { "kind": "textbox" }`

```json
{ "tool": "type", "input": { "eid": "<input_id>", "text": "hello world" } }
```

**Verify:**

- [ ] Text appears in input

### 5.2 Type with Clear

```json
{ "tool": "type", "input": { "eid": "<id>", "text": "new", "clear": true } }
```

**Verify:**

- [ ] Old text cleared
- [ ] Only new text present

### 5.3 Type Special Characters

```json
{ "tool": "type", "input": { "eid": "<id>", "text": "test@example.com" } }
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

### 6.2 Press Tab (Focus Change)

```json
{ "tool": "press", "input": { "key": "Tab" } }
```

**Verify:**

- [ ] Focus moves to next element

### 6.3 Press Escape (Close Modal)

**Setup:** Open modal first

```json
{ "tool": "press", "input": { "key": "Escape" } }
```

**Verify:**

- [ ] Modal closes

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

**Supported Keys:** Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown

---

## Suite 7: Select Dropdown

### 7.1 Select by Value

**Test on form with dropdown:**

```json
{ "tool": "select", "input": { "eid": "<select_id>", "value": "US" } }
```

**Verify:**

- [ ] Option selected

### 7.2 Select by Visible Text

```json
{ "tool": "select", "input": { "eid": "<id>", "value": "United States" } }
```

**Verify:**

- [ ] Matches by visible text

### 7.3 Select Invalid Option

```json
{ "tool": "select", "input": { "eid": "<id>", "value": "NotReal" } }
```

**Verify:**

- [ ] Error lists available options

### 7.4 Select on Non-Select Element

```json
{ "tool": "select", "input": { "eid": "<button_id>", "value": "x" } }
```

**Verify:**

- [ ] Error: element is not a select

---

## Suite 8: Hover

### 8.1 Hover Over Element

```json
{ "tool": "hover", "input": { "eid": "<element_id>" } }
```

**Verify:**

- [ ] Mouse moves to element
- [ ] Hover effects triggered (if any)

### 8.2 Hover Reveals Menu

**Test on site with hover menus:**

```json
{ "tool": "hover", "input": { "eid": "<menu_trigger>" } }
```

**Verify:**

- [ ] Dropdown menu appears
- [ ] New elements visible in next snapshot

---

## Suite 9: Scroll

### 9.1 Scroll Element Into View

```json
{ "tool": "scroll_element_into_view", "input": { "eid": "<below_fold_id>" } }
```

**Verify:**

- [ ] Element now visible
- [ ] Can interact with element

### 9.2 Scroll Page Down

```json
{ "tool": "scroll_page", "input": { "direction": "down" } }
```

**Verify:**

- [ ] Viewport moves down

### 9.3 Scroll Page Up

```json
{ "tool": "scroll_page", "input": { "direction": "up" } }
```

**Verify:**

- [ ] Viewport moves up

### 9.4 Scroll Custom Amount

```json
{ "tool": "scroll_page", "input": { "direction": "down", "amount": 1000 } }
```

**Verify:**

- [ ] Scrolls 1000px

---

## Suite 10: End-to-End Workflows

### 10.1 Google Search

```
1. launch_browser { "headless": false }
2. navigate { "url": "https://www.google.com" }
3. find_elements { "kind": "textbox" }
4. click { "eid": "<search_input>" }
5. type { "text": "MCP protocol" }
6. press { "key": "Enter" }
7. find_elements { "kind": "link", "region": "main" }
8. click { "eid": "<first_result>" }
9. close_session {}
```

**Verify:** All steps complete without errors

---

### 10.2 Login Flow

**Test Site:** https://the-internet.herokuapp.com/login

```
1. launch_browser {}
2. navigate { "url": "https://the-internet.herokuapp.com/login" }
3. find_elements { "kind": "textbox" }
4. type { "eid": "<username>", "text": "tomsmith" }
5. press { "key": "Tab" }
6. type { "text": "SuperSecretPassword!" }
7. find_elements { "kind": "button", "label": "Login" }
8. click { "eid": "<login_btn>" }
9. Verify success message
```

**Verify:** Login succeeds, success message displayed

---

### 10.3 Form with Dropdown

```
1. navigate { "url": "<form_url>" }
2. find_elements { "kind": "combobox" }
3. select { "eid": "<dropdown>", "value": "<option>" }
4. find_elements { "kind": "textbox" }
5. type { "eid": "<input>", "text": "test" }
6. find_elements { "kind": "button", "label": "submit" }
7. click { "eid": "<submit>" }
```

**Verify:** Form submits with selections

---

### 10.4 Navigation History

```
1. launch_browser {}
2. navigate { "url": "https://example.com" }
3. find_elements { "kind": "link" }
4. click { "eid": "<link>" }
5. go_back {}  // Should return to example.com
6. go_forward {}  // Should return to linked page
7. reload {}  // Should reload
```

**Verify:** Back/forward/reload all work

---

### 10.5 Modal Handling

```
1. navigate { "url": "<site_with_modal>" }
2. click { "eid": "<modal_trigger>" }
3. Verify modal opened
4. press { "key": "Escape" }
5. Verify modal closed
```

**Verify:** Modal detection and dismissal work

---

### 10.6 Scroll and Interact

```
1. navigate { "url": "<long_page>" }
2. scroll_page { "direction": "down", "amount": 2000 }
3. capture_snapshot {}
4. find_elements { "kind": "button" }
5. scroll_element_into_view { "eid": "<button_id>" }
6. click { "eid": "<button_id>" }
```

**Verify:** Can scroll and interact with below-fold elements

---

## Suite 11: Advanced Scenarios

### 11.1 Iframe Interaction

**Test Site:** https://the-internet.herokuapp.com/iframe

```json
1. navigate { "url": "https://the-internet.herokuapp.com/iframe" }
2. find_elements { "kind": "textbox" }
```

**Verify:**

- [ ] Elements inside iframes are detected and interactable

### 11.2 Checkboxes and Radio Buttons

**Test Site:** https://the-internet.herokuapp.com/checkboxes

```json
1. navigate { "url": "https://the-internet.herokuapp.com/checkboxes" }
2. find_elements { "kind": "checkbox" }
3. click { "eid": "<checkbox_id>" }
```

**Verify:**

- [ ] Checkboxes are detected
- [ ] Click toggles the state

### 11.3 Dynamic Content Loading

**Test Site:** https://the-internet.herokuapp.com/dynamic_loading/1

```json
1. navigate { "url": "https://the-internet.herokuapp.com/dynamic_loading/1" }
2. click { "eid": "<start_btn>" }
3. capture_snapshot {} // Repeat until content loads
```

**Verify:**

- [ ] Snapshot eventually captures dynamically loaded element

### 11.4 Cookie Consent

**Test Site:** https://www.economist.com

**Verify:**

- [ ] Cookie consent dialog detected
- [ ] Can interact with consent options
- [ ] Dialog dismisses after acceptance

---

## Test Results

| Suite | Test                  | Pass | Fail | Notes |
| ----- | --------------------- | ---- | ---- | ----- |
| 1     | 1.1 Launch Visible    |      |      |       |
| 1     | 1.2 Launch Headless   |      |      |       |
| 1     | 1.3 Connect CDP       |      |      |       |
| 1     | 1.4 Close Session     |      |      |       |
| 1     | 1.5 Close Page        |      |      |       |
| 2     | 2.1 Navigate URL      |      |      |       |
| 2     | 2.2 Navigate Form     |      |      |       |
| 2     | 2.3 Go Back           |      |      |       |
| 2     | 2.4 Go Forward        |      |      |       |
| 2     | 2.5 Reload            |      |      |       |
| 3     | 3.1 Snapshot          |      |      |       |
| 3     | 3.2 Find Kind         |      |      |       |
| 3     | 3.3 Find Label        |      |      |       |
| 3     | 3.4 Find Region       |      |      |       |
| 3     | 3.5 Find Combined     |      |      |       |
| 3     | 3.6 Node Details      |      |      |       |
| 4     | 4.1 Click             |      |      |       |
| 4     | 4.2 Click Modal       |      |      |       |
| 4     | 4.3 Click Invalid     |      |      |       |
| 5     | 5.1 Type Input        |      |      |       |
| 5     | 5.2 Type Clear        |      |      |       |
| 5     | 5.3 Type Special      |      |      |       |
| 6     | 6.1 Press Enter       |      |      |       |
| 6     | 6.2 Press Tab         |      |      |       |
| 6     | 6.3 Press Escape      |      |      |       |
| 6     | 6.4 Press Arrow       |      |      |       |
| 6     | 6.5 Press Modifier    |      |      |       |
| 7     | 7.1 Select Value      |      |      |       |
| 7     | 7.2 Select Text       |      |      |       |
| 7     | 7.3 Select Invalid    |      |      |       |
| 7     | 7.4 Select Non-Select |      |      |       |
| 8     | 8.1 Hover             |      |      |       |
| 8     | 8.2 Hover Menu        |      |      |       |
| 9     | 9.1 Scroll Element    |      |      |       |
| 9     | 9.2 Scroll Down       |      |      |       |
| 9     | 9.3 Scroll Up         |      |      |       |
| 9     | 9.4 Scroll Amount     |      |      |       |
| 10    | 10.1 Google Search    |      |      |       |
| 10    | 10.2 Login Flow       |      |      |       |
| 10    | 10.3 Form Dropdown    |      |      |       |
| 10    | 10.4 Nav History      |      |      |       |
| 10    | 10.5 Modal            |      |      |       |
| 10    | 10.6 Scroll Interact  |      |      |       |
| 11    | 11.1 Iframe           |      |      |       |
| 11    | 11.2 Checkbox/Radio   |      |      |       |
| 11    | 11.3 Dynamic Content  |      |      |       |
| 11    | 11.4 Cookie Consent   |      |      |       |

---

## Regression Checklist

After code changes:

- [ ] All 11 suites pass
- [ ] Error messages are descriptive
- [ ] No memory leaks (browser cleanup)
- [ ] Headless mode works
- [ ] Connect mode works
- [ ] Snapshots capture page state correctly
