# Athena Browser MCP

[![CI](https://github.com/lespaceman/athena-browser-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/lespaceman/athena-browser-mcp/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/athena-browser-mcp.svg)](https://www.npmjs.com/package/athena-browser-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Minimal MCP server for AI browser automation - 8 simple tools.

## Design Philosophy

1. **Page state in system prompt** - Agent always knows current page state without querying
2. **Lightweight delta responses** - Tools return what changed, not full snapshots
3. **Simple verb-based naming** - `click`, `type`, `press` instead of `action_click`, `action_type`

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         AI Agent                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ System Prompt: Current page state (URL, forms, actions)    │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │ MCP Protocol (stdio)
┌───────────────────────────▼─────────────────────────────────────┐
│  open │ close │ goto │ find │ click │ type │ press │ select     │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Playwright + CDP
┌───────────────────────────▼─────────────────────────────────────┐
│                     Chromium Browser                             │
└─────────────────────────────────────────────────────────────────┘
```

## Tools

### Session

| Tool | Purpose | Input |
|------|---------|-------|
| `open` | Start browser session | `{ headless?, connect_to? }` |
| `close` | End browser session | `{ page_id? }` |

### Navigation

| Tool | Purpose | Input |
|------|---------|-------|
| `goto` | Navigate to URL | `{ url }` |
| | Go back/forward/refresh | `{ back: true }` / `{ forward: true }` / `{ refresh: true }` |

### Query

| Tool | Purpose | Input |
|------|---------|-------|
| `find` | Find elements by criteria | `{ kind?, label?, region? }` |

### Interaction

| Tool | Purpose | Input |
|------|---------|-------|
| `click` | Click element | `{ node_id }` |
| `type` | Type text into element | `{ text, node_id?, clear? }` |
| `press` | Press keyboard key | `{ key }` (Enter, Tab, Escape, etc.) |
| `select` | Choose dropdown option | `{ node_id, value }` |

## Response Format

Tools return lightweight deltas describing what changed:

```json
{
  "delta": {
    "action": "Clicked 'Sign In' button",
    "changes": [
      { "type": "navigation", "from": "/login", "to": "/dashboard" }
    ]
  },
  "page_state": { ... }
}
```

### Change Types

| Type | Description |
|------|-------------|
| `focused` | Element received focus |
| `filled` | Input field value changed |
| `selected` | Dropdown option selected |
| `clicked` | Element was clicked |
| `navigation` | URL changed |
| `page_changed` | Page type changed |
| `modal_opened` | Modal dialog appeared |
| `modal_closed` | Modal dialog dismissed |
| `form_submitted` | Form was submitted |

## Usage Examples

### Login Flow

```
1. open { }
   → System prompt updated with initial page state

2. goto { url: "https://example.com/login" }
   → Page changed: login form detected
   → System prompt updated with form fields

3. find { kind: "input", label: "email" }
   → { matches: [{ node_id: "42", label: "Email" }] }

4. click { node_id: "42" }
   → Focused: Email field

5. type { text: "user@example.com" }
   → Filled: Email = "user@example.com"

6. press { key: "Tab" }
   → Focused: Password field

7. type { text: "password123" }
   → Filled: Password = "••••••••••••"

8. press { key: "Enter" }
   → Form submitted
   → Navigation: /login → /dashboard
```

### E-commerce Purchase

```
1. goto { url: "https://shop.example.com/product/123" }
   → System prompt: product page, Add to Cart [node:101], Size [node:103]

2. select { node_id: "103", value: "Large" }
   → Selected: Size = "Large"

3. click { node_id: "101" }
   → Clicked: Add to Cart
   → Modal opened: "Added to cart"
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
      "command": "node",
      "args": ["/path/to/athena-browser-mcp/dist/src/index.js"]
    }
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DEFAULT_TIMEOUT_MS` | Default operation timeout | `30000` |

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
