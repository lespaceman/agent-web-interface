# Manual Test Plan: Browser MCP Tools

This document outlines manual testing procedures for the Athena Browser MCP tools, including the new FactPack extraction and page_brief features.

## Prerequisites

1. Build the project: `npm run build`
2. Start the MCP server or connect via MCP client
3. Have a CEF browser running on `localhost:9223` (or configure `CEF_BRIDGE_HOST`/`CEF_BRIDGE_PORT`)

---

## Test 1: Browser Launch and Connect

### 1.1 Launch Mode (Headless)

```json
{
  "tool": "browser_launch",
  "input": {
    "mode": "launch",
    "headless": true
  }
}
```

**Expected:**

- [ ] Returns `page_id`, `url`, `title`, `mode: "launched"`
- [ ] Returns `snapshot_id`, `node_count`, `interactive_count`
- [ ] Returns `factpack` with `page_type`, `dialogs`, `forms`, `actions`
- [ ] Returns `page_brief` (XML-compact string)
- [ ] Returns `page_brief_tokens` (number > 0)

### 1.2 Connect Mode (CEF Browser)

```json
{
  "tool": "browser_launch",
  "input": {
    "mode": "connect"
  }
}
```

**Expected:**

- [ ] Connects to existing CEF browser
- [ ] Returns `mode: "connected"`
- [ ] All other fields same as launch mode

---

## Test 2: Browser Navigate

### 2.1 Navigate to Product Page

```json
{
  "tool": "browser_navigate",
  "input": {
    "page_id": "<page_id_from_launch>",
    "url": "https://www.apple.com/shop/buy-iphone/iphone-16-pro"
  }
}
```

**Expected:**

- [ ] Returns updated `url` and `title`
- [ ] `factpack.page_type.classification.type` is `"product"` or similar
- [ ] `factpack.actions.actions` contains cart/buy actions
- [ ] `page_brief` contains `<page type="product"`
- [ ] `page_brief` contains `<actions>` with Add to Bag or similar

### 2.2 Navigate to Login Page

```json
{
  "tool": "browser_navigate",
  "input": {
    "page_id": "<page_id>",
    "url": "https://github.com/login"
  }
}
```

**Expected:**

- [ ] `factpack.page_type.classification.type` is `"login"`
- [ ] `factpack.forms.forms` contains login form
- [ ] Form has `purpose: "login"` with email/username and password fields
- [ ] `page_brief` contains `<forms count="1" primary="login">`
- [ ] `page_brief` contains field list with `(required)` markers

### 2.3 Navigate to Page with Cookie Dialog

```json
{
  "tool": "browser_navigate",
  "input": {
    "page_id": "<page_id>",
    "url": "https://www.bbc.com"
  }
}
```

**Expected:**

- [ ] `factpack.dialogs.dialogs` contains cookie consent dialog
- [ ] `factpack.dialogs.has_blocking_dialog` is `true`
- [ ] Dialog has `type: "cookie-consent"`
- [ ] `page_brief` contains `<dialogs blocking="true">`
- [ ] `page_brief` contains `[cookie-consent]`

---

## Test 3: Snapshot Capture

### 3.1 Basic Snapshot

```json
{
  "tool": "snapshot_capture",
  "input": {
    "page_id": "<page_id>"
  }
}
```

**Expected:**

- [ ] Returns fresh `snapshot_id`
- [ ] Returns `factpack` and `page_brief`
- [ ] `node_count` reflects current page state

### 3.2 Snapshot with Nodes

```json
{
  "tool": "snapshot_capture",
  "input": {
    "page_id": "<page_id>",
    "include_nodes": true
  }
}
```

**Expected:**

- [ ] Returns `nodes` array with `node_id`, `kind`, `label`, `selector`
- [ ] Nodes are interactive elements (buttons, links, inputs)

---

## Test 4: Find Elements

### 4.1 Find Buttons

```json
{
  "tool": "find_elements",
  "input": {
    "page_id": "<page_id>",
    "kind": "button"
  }
}
```

**Expected:**

- [ ] Returns array of button elements
- [ ] Each has `node_id`, `label`, `locator`

### 4.2 Find by Label

```json
{
  "tool": "find_elements",
  "input": {
    "page_id": "<page_id>",
    "label": "Sign in"
  }
}
```

**Expected:**

- [ ] Returns elements with "Sign in" in label
- [ ] Case-insensitive by default

### 4.3 Find by Region

```json
{
  "tool": "find_elements",
  "input": {
    "page_id": "<page_id>",
    "region": "header",
    "kind": "link"
  }
}
```

**Expected:**

- [ ] Returns only links in header region
- [ ] No main/footer elements included

### 4.4 Find by State

```json
{
  "tool": "find_elements",
  "input": {
    "page_id": "<page_id>",
    "kind": "input",
    "state": {
      "enabled": true,
      "visible": true
    }
  }
}
```

**Expected:**

- [ ] Returns only enabled, visible inputs
- [ ] Disabled inputs excluded

---

## Test 5: Action Click

### 5.1 Click Button

```json
{
  "tool": "action_click",
  "input": {
    "page_id": "<page_id>",
    "node_id": "<node_id_from_snapshot>"
  }
}
```

**Expected:**

- [ ] Returns `success: true`
- [ ] Returns `clicked_element` with label
- [ ] Page responds to click (navigation, state change, etc.)

### 5.2 Click Invalid Node

```json
{
  "tool": "action_click",
  "input": {
    "page_id": "<page_id>",
    "node_id": "invalid-node-id"
  }
}
```

**Expected:**

- [ ] Returns error: "Node not found in snapshot"

---

## Test 6: Get Node Details

### 6.1 Get Details for Button

```json
{
  "tool": "get_node_details",
  "input": {
    "page_id": "<page_id>",
    "node_id": "<node_id>"
  }
}
```

**Expected:**

- [ ] Returns full node info: `kind`, `label`, `where`, `layout`, `state`
- [ ] `where` includes `region`, `group_id`, `heading_context`
- [ ] `layout.bbox` has x, y, w, h coordinates
- [ ] `state` has `visible`, `enabled`, etc.

---

## Test 7: Get FactPack

### 7.1 Get FactPack with Default Options

```json
{
  "tool": "get_factpack",
  "input": {
    "page_id": "<page_id>"
  }
}
```

**Expected:**

- [ ] Returns full FactPack structure
- [ ] `page_type`, `dialogs`, `forms`, `actions` all present

### 7.2 Get FactPack with Custom Options

```json
{
  "tool": "get_factpack",
  "input": {
    "page_id": "<page_id>",
    "max_actions": 5,
    "min_action_score": 0.5
  }
}
```

**Expected:**

- [ ] `actions.actions` has at most 5 items
- [ ] All actions have `score >= 0.5`

---

## Test 8: Page Brief Quality

### 8.1 Verify XML Structure

For any page_brief output:

**Expected:**

- [ ] Wrapped in `<page_context>...</page_context>`
- [ ] Contains `<page type="..." confidence="...">` section
- [ ] Contains `<dialogs blocking="...">` section
- [ ] Contains `<forms count="...">` section
- [ ] Contains `<actions>` section with numbered list
- [ ] All actionable items have `node:` references

### 8.2 Verify Token Count

```json
{
  "tool": "browser_navigate",
  "input": {
    "page_id": "<page_id>",
    "url": "https://www.apple.com"
  }
}
```

**Expected:**

- [ ] `page_brief_tokens` is reasonable (typically 200-1000)
- [ ] `page_brief_tokens <= 2000` (standard budget cap)

### 8.3 Verify Node References Work

1. Get `page_brief` from navigate
2. Extract a `node:nXXXX` reference from actions
3. Use that node_id in `action_click`

**Expected:**

- [ ] Click succeeds with the node_id from page_brief

---

## Test 9: Browser Close

### 9.1 Close Single Page

```json
{
  "tool": "browser_close",
  "input": {
    "page_id": "<page_id>"
  }
}
```

**Expected:**

- [ ] Returns `closed: true`
- [ ] Subsequent operations on that page_id fail

### 9.2 Close Entire Session

```json
{
  "tool": "browser_close",
  "input": {}
}
```

**Expected:**

- [ ] Returns `closed: true`
- [ ] All pages closed
- [ ] Browser process terminated (launch mode) or disconnected (connect mode)

---

## Test 10: Optional page_id (MRU Behavior)

### 10.1 Navigate Without page_id (Auto-create)

First, ensure no browser is running, then:

```json
{
  "tool": "browser_launch",
  "input": { "mode": "launch" }
}
```

Then navigate without specifying page_id:

```json
{
  "tool": "browser_navigate",
  "input": {
    "url": "https://example.com"
  }
}
```

**Expected:**

- [ ] Navigate succeeds using the MRU page from launch
- [ ] Returns same `page_id` as launch

### 10.2 Snapshot Without page_id

After navigating:

```json
{
  "tool": "snapshot_capture",
  "input": {}
}
```

**Expected:**

- [ ] Returns snapshot for the MRU page
- [ ] `snapshot_id` is new (fresh capture)

### 10.3 Find Elements Without page_id

```json
{
  "tool": "find_elements",
  "input": {
    "kind": "link"
  }
}
```

**Expected:**

- [ ] Returns links from MRU page
- [ ] Works same as with explicit page_id

### 10.4 Action Click Without page_id

```json
{
  "tool": "action_click",
  "input": {
    "node_id": "<node_id_from_snapshot>"
  }
}
```

**Expected:**

- [ ] Click succeeds on MRU page
- [ ] Returns `success: true`

### 10.5 MRU Tracking Across Pages

1. Launch browser
2. Navigate to page A (page_id: p1)
3. Create second page, navigate to page B (page_id: p2)
4. Call `snapshot_capture` without page_id

**Expected:**

- [ ] Snapshot is from page B (p2) - the most recently used

5. Navigate page A again (with explicit page_id: p1)
6. Call `snapshot_capture` without page_id

**Expected:**

- [ ] Snapshot is now from page A (p1) - updated MRU

### 10.6 No Pages Available Error

Close all pages, then:

```json
{
  "tool": "snapshot_capture",
  "input": {}
}
```

**Expected:**

- [ ] Returns error: "No page available. Use browser_launch first."

### 10.7 Navigate Auto-creates When No Pages

Close all pages, then:

```json
{
  "tool": "browser_navigate",
  "input": {
    "url": "https://example.com"
  }
}
```

**Expected:**

- [ ] Auto-creates a new page
- [ ] Navigation succeeds
- [ ] Returns valid `page_id`

---

## Test 11: Edge Cases

### 11.1 Empty Page

Navigate to `about:blank`:

- [ ] FactPack has `page_type.type: "unknown"`
- [ ] `forms.forms` is empty
- [ ] `dialogs.dialogs` is empty
- [ ] `actions.actions` is empty or minimal

### 11.2 Page with Many Actions

Navigate to a complex page (e.g., Amazon homepage):

- [ ] `page_brief_tokens` stays within budget
- [ ] Actions are limited to top N (default 12)
- [ ] Most relevant actions appear first (by score)

### 11.3 Page with Complex Form

Navigate to a checkout page:

- [ ] Form fields have correct `semantic_type` (email, address, card-number, etc.)
- [ ] Required fields marked appropriately
- [ ] Form purpose correctly inferred

---

## Test Results Template

| Test                               | Pass/Fail | Notes |
| ---------------------------------- | --------- | ----- |
| 1.1 Launch Mode                    |           |       |
| 1.2 Connect Mode                   |           |       |
| 2.1 Product Page                   |           |       |
| 2.2 Login Page                     |           |       |
| 2.3 Cookie Dialog                  |           |       |
| 3.1 Basic Snapshot                 |           |       |
| 3.2 Snapshot with Nodes            |           |       |
| 4.1 Find Buttons                   |           |       |
| 4.2 Find by Label                  |           |       |
| 4.3 Find by Region                 |           |       |
| 4.4 Find by State                  |           |       |
| 5.1 Click Button                   |           |       |
| 5.2 Click Invalid                  |           |       |
| 6.1 Node Details                   |           |       |
| 7.1 Get FactPack                   |           |       |
| 7.2 FactPack Options               |           |       |
| 8.1 XML Structure                  |           |       |
| 8.2 Token Count                    |           |       |
| 8.3 Node References                |           |       |
| 9.1 Close Page                     |           |       |
| 9.2 Close Session                  |           |       |
| 10.1 Navigate Without page_id      |           |       |
| 10.2 Snapshot Without page_id      |           |       |
| 10.3 Find Elements Without page_id |           |       |
| 10.4 Action Click Without page_id  |           |       |
| 10.5 MRU Tracking Across Pages     |           |       |
| 10.6 No Pages Available Error      |           |       |
| 10.7 Navigate Auto-creates         |           |       |
| 11.1 Empty Page                    |           |       |
| 11.2 Many Actions                  |           |       |
| 11.3 Complex Form                  |           |       |
