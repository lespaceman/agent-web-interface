# Athena Browser MCP

[![CI](https://github.com/lespaceman/athena-browser-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/lespaceman/athena-browser-mcp/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/athena-browser-mcp.svg)](https://www.npmjs.com/package/athena-browser-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for AI browser automation - 18 tools with semantic element targeting.

## Design Philosophy

1. **Semantic element IDs** - Stable `eid` references survive DOM mutations
2. **XML state responses** - Structured page state with layers, actionables, and diffs
3. **Multi-frame support** - Extract content from iframes (cookie consent, widgets)
4. **Automatic retry** - Stale element recovery with fresh snapshot

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         AI Agent                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ System Prompt: XML state (layers, actionables, atoms)      │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │ MCP Protocol (stdio)
┌───────────────────────────▼─────────────────────────────────────┐
│  SESSION: launch_browser, connect_browser, close_page,          │
│           close_session                                          │
│  NAVIGATION: navigate, go_back, go_forward, reload               │
│  OBSERVATION: capture_snapshot, find_elements, get_node_details  │
│  INTERACTION: click, type, press, select, hover,                 │
│               scroll_element_into_view, scroll_page              │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Playwright + CDP
┌───────────────────────────▼─────────────────────────────────────┐
│                     Chromium Browser                             │
└─────────────────────────────────────────────────────────────────┘
```

## Tools

### Session

| Tool              | Purpose                   | Input               |
| ----------------- | ------------------------- | ------------------- |
| `launch_browser`  | Launch new browser        | `{ headless? }`     |
| `connect_browser` | Connect to existing (CDP) | `{ endpoint_url? }` |
| `close_page`      | Close specific page       | `{ page_id }`       |
| `close_session`   | Close entire browser      | `{}`                |

### Navigation

| Tool         | Purpose         | Input               |
| ------------ | --------------- | ------------------- |
| `navigate`   | Go to URL       | `{ url, page_id? }` |
| `go_back`    | Browser back    | `{ page_id? }`      |
| `go_forward` | Browser forward | `{ page_id? }`      |
| `reload`     | Refresh page    | `{ page_id? }`      |

### Observation

| Tool               | Purpose             | Input                                                             |
| ------------------ | ------------------- | ----------------------------------------------------------------- |
| `capture_snapshot` | Capture page state  | `{ page_id? }`                                                    |
| `find_elements`    | Find by criteria    | `{ kind?, label?, region?, limit?, include_readable?, page_id? }` |
| `get_node_details` | Get element details | `{ eid, page_id? }`                                               |

### Interaction

| Tool                       | Purpose            | Input                              |
| -------------------------- | ------------------ | ---------------------------------- |
| `click`                    | Click element      | `{ eid, page_id? }`                |
| `type`                     | Type text          | `{ eid, text, clear?, page_id? }`  |
| `press`                    | Press keyboard key | `{ key, modifiers?, page_id? }`    |
| `select`                   | Select option      | `{ eid, value, page_id? }`         |
| `hover`                    | Hover element      | `{ eid, page_id? }`                |
| `scroll_element_into_view` | Scroll to element  | `{ eid, page_id? }`                |
| `scroll_page`              | Scroll viewport    | `{ direction, amount?, page_id? }` |

## Element IDs (eid)

Elements are identified by stable semantic IDs (`eid`) instead of transient DOM node IDs:

```xml
<match eid="a1b2c3d4e5f6" kind="button" label="Sign In" region="header" />
```

EIDs are computed from:

- Role/kind (button, link, input)
- Accessible name (label text)
- Landmark path (region + group hierarchy)
- Position hint (screen zone, quadrant)

This means the same logical element keeps its `eid` across page updates.

## Response Format

Tools return XML state responses with page understanding:

```xml
<state page_id="abc123" url="https://example.com" title="Example">
  <layer type="main" active="true">
    <actionables count="12">
      <el eid="a1b2c3" kind="button" label="Sign In" />
      <el eid="d4e5f6" kind="link" label="Forgot password?" />
      <el eid="g7h8i9" kind="input" label="Email" type="email" />
    </actionables>
  </layer>
  <atoms>
    <viewport w="1280" h="720" />
    <scroll x="0" y="0" />
  </atoms>
</state>
```

### Layer Types

| Layer     | Description                |
| --------- | -------------------------- |
| `main`    | Primary page content       |
| `modal`   | Dialog overlays            |
| `drawer`  | Slide-in panels            |
| `popover` | Dropdowns, tooltips, menus |

## Usage Examples

### Login Flow

```
1. launch_browser { }
   → XML state with initial page

2. navigate { url: "https://example.com/login" }
   → State shows login form elements

3. find_elements { kind: "input", label: "email" }
   → <match eid="abc123" kind="input" label="Email" />

4. click { eid: "abc123" }
   → Element focused

5. type { eid: "abc123", text: "user@example.com" }
   → Value filled

6. press { key: "Tab" }
   → Focus moved to password field

7. type { eid: "def456", text: "password123" }
   → Password filled

8. press { key: "Enter" }
   → Form submitted, navigation to dashboard
```

### Cookie Consent (Multi-Frame)

```
1. navigate { url: "https://news-site.com" }
   → Modal layer detected (cookie consent iframe)

2. find_elements { label: "Accept", kind: "button" }
   → <match eid="xyz789" kind="button" label="Accept All" />

3. click { eid: "xyz789" }
   → Modal closed, main layer active
```

## Installation

```bash
npm install
npm run build
```

## Configuration

### Claude Desktop

Add to your Claude Desktop config:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": ["athena-browser-mcp@latest"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add athena-browser-mcp npx athena-browser-mcp@latest
```

### VS Code

```bash
code --add-mcp '{"name":"athena-browser-mcp","command":"npx","args":["athena-browser-mcp@latest"]}'
```

### Cursor

Go to **Cursor Settings → MCP → Add new MCP Server**. Use command type with:

```
npx athena-browser-mcp@latest
```

### Codex

```bash
codex mcp add athena-browser-mcp npx athena-browser-mcp@latest
```

### Gemini CLI

```bash
gemini mcp add -s user athena-browser-mcp -- npx athena-browser-mcp@latest
```

### Connect to Existing Browser

To connect to an existing Chromium browser with CDP enabled:

```bash
# Start Chrome with remote debugging
google-chrome --remote-debugging-port=9222

# Or use environment variables
export CEF_BRIDGE_HOST=127.0.0.1
export CEF_BRIDGE_PORT=9222
```

Then use `connect_browser` instead of `launch_browser`.

### Environment Variables

| Variable          | Description          | Default     |
| ----------------- | -------------------- | ----------- |
| `CEF_BRIDGE_HOST` | CDP host for connect | `127.0.0.1` |
| `CEF_BRIDGE_PORT` | CDP port for connect | `9223`      |

## Development

```bash
npm run build          # Compile TypeScript
npm run type-check     # TypeScript type checking
npm run lint           # ESLint
npm run format         # Prettier format
npm run check          # Run all checks
npm test               # Run tests
```

## License

MIT
