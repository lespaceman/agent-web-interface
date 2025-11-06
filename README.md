# Browser Automation MCP Server

[![CI](https://github.com/lespaceman/athena-browser-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/lespaceman/athena-browser-mcp/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/athena-browser-mcp.svg)](https://www.npmjs.com/package/athena-browser-mcp)
[![codecov](https://codecov.io/gh/lespaceman/athena-browser-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/lespaceman/athena-browser-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A comprehensive Model Context Protocol (MCP) server that exposes browser automation capabilities for AI agents through Qt + CEF (Chromium Embedded Framework).

## Overview

This MCP server provides 40+ tools organized into three categories:

### A) Perception & Understanding Tools (11 tools)

- **DOM & Accessibility**: Get stable DOM trees and accessibility information
- **Layout & Visibility**: Check element geometry and visibility
- **UI Discovery**: Fuse DOM+AX+layout for intelligent element discovery
- **Vision/OCR**: Fallback text detection for canvas/SVG elements
- **Network Observation**: Monitor and capture network requests
- **Content Extraction**: Extract main content using Readability/Trafilatura

### B) Interaction & Navigation Tools (14 tools)

- **Target Resolution**: Resolve semantic hints to concrete elements
- **Actions**: Click, type, select, scroll, upload files
- **Navigation**: Go to URLs, wait for conditions, switch frames
- **Form Toolkit**: Detect, fill, and submit forms intelligently
- **Keyboard**: Press key sequences and type text

### C) Session, Memory & Safety Tools (10 tools)

- **Session Management**: Save/restore cookies and storage
- **Site Memory**: Learn stable selectors for recurring sites
- **Safety Controls**: Domain allowlists, action budgets, audit logs
- **Audit Snapshots**: Capture screenshots, DOM, and HAR files

## Architecture

```
┌─────────────┐
│   Claude    │ (AI Agent)
└──────┬──────┘
       │ MCP Protocol
       │
┌──────▼──────────────────────┐
│  MCP Server (Node.js)       │
│  - Tool routing             │
│  - Safety policies          │
│  - Audit logging            │
└──────┬──────────────────────┘
       │ IPC/WebSocket
       │
┌──────▼──────────────────────┐
│  CEF Bridge (Qt/C++)        │
│  - CDP communication        │
│  - Screenshot capture       │
│  - File system access       │
└──────┬──────────────────────┘
       │ Chrome DevTools Protocol
       │
┌──────▼──────────────────────┐
│  Chromium Engine (CEF)      │
│  - Render web pages         │
│  - Execute JavaScript       │
│  - Network handling         │
└─────────────────────────────┘
```

## Installation

```bash
npm install
npm run build
```

## Configuration

### Claude Desktop Configuration

Add to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "browser-automation": {
      "command": "node",
      "args": ["/path/to/athena-browser-mcp/dist/src/index.js"],
      "env": {
        "CEF_BRIDGE_HOST": "localhost",
        "CEF_BRIDGE_PORT": "9222",
        "ALLOWED_FILE_DIRS": "/home/user/downloads,/tmp"
      }
    }
  }
}
```

### Environment Variables

- `CEF_BRIDGE_HOST`: Host for CEF bridge connection (default: localhost)
- `CEF_BRIDGE_PORT`: Port for CEF bridge connection (default: 9222)
- `ALLOWED_FILE_DIRS`: Comma-separated list of directories for file uploads
- `DEFAULT_TIMEOUT_MS`: Default timeout for operations (default: 30000)

## Usage Examples

### Example 1: Login Flow

```typescript
// 1. Discover form elements
const form = await mcp.tools.form_detect({});

// 2. Fill credentials
await mcp.tools.form_fill({
  pairs: [
    { slot: 'email', text: 'user@example.com' },
    { slot: 'password', text: '********' },
  ],
});

// 3. Submit form
await mcp.tools.form_submit({ strategy: 'button' });

// 4. Wait for navigation
await mcp.tools.nav_wait({ for: 'route-change' });

// 5. Save session
const session = await mcp.tools.session_save({ domain: 'example.com' });
```

### Example 2: Search and Extract

```typescript
// 1. Navigate to search page
await mcp.tools.nav_goto({ url: 'https://example.com/search' });

// 2. Find search box
const searchBox = await mcp.tools.targets_resolve({
  hint: { role: 'textbox', label: 'Search' },
});

// 3. Type search query
await mcp.tools.act_type({
  target: searchBox,
  text: 'machine learning',
  submit: 'Enter',
});

// 4. Wait for results
await mcp.tools.nav_wait({ for: 'network-idle' });

// 5. Extract main content
const content = await mcp.tools.content_extract_main({
  mode: 'readability',
});
```

### Example 3: Handle Canvas UI (with OCR fallback)

```typescript
// 1. Try semantic resolution first
let button = await mcp.tools.targets_resolve({
  hint: { role: 'button', label: 'Download' },
});

// 2. Fallback to vision if needed
if (!button) {
  button = await mcp.tools.vision_find_by_text({
    text: 'Download',
    fuzzy: true,
  });
}

// 3. Click using bbox strategy
if (button) {
  await mcp.tools.act_click({
    target: button,
    strategy: 'bbox',
  });
}

// 4. Verify with network observation
const download = await mcp.tools.net_observe({
  patterns: ['*.pdf', '*.csv'],
});
```

## Tool Categories

### Deterministic-First, Vision-Assisted Fallback

The toolkit prioritizes deterministic methods:

1. **Accessibility tree** (most stable)
2. **DOM selectors** (CSS, XPath)
3. **Layout/geometry** (bounding boxes)
4. **Vision/OCR** (last resort for canvas/SVG)

### Selector Bundles

Each `ElementRef` contains multiple locators for resilience:

```typescript
interface ElementRef {
  frameId: string;
  nodeId?: number;
  selectors: {
    ax?: string; // Accessibility path
    css?: string; // CSS selector
    xpath?: string; // XPath expression
  };
  bbox?: { x: number; y: number; w: number; h: number };
  role?: string;
  label?: string;
  name?: string;
}
```

### Safety Features

1. **Domain Allowlists**: Restrict navigation to approved domains
2. **Action Budgets**: Rate limit to prevent runaway automation
3. **File Path Validation**: Only upload files from allowed directories
4. **Audit Logging**: All actions captured with pre/post screenshots
5. **Confirmation Prompts**: For destructive actions (delete, purchase)

## Implementation Checklist

### Phase 1: Core Tools (Week 1-2)

- [ ] `targets_resolve` - Element resolution
- [ ] `act_click` - Click actions
- [ ] `act_type` - Text input
- [ ] `nav_wait` - Wait conditions
- [ ] `ui_discover` - Element discovery
- [ ] CEF Bridge basic IPC

### Phase 2: Robustness (Week 3-4)

- [ ] `form_detect` / `form_fill` / `form_submit`
- [ ] Selector bundle system
- [ ] Shadow DOM piercing
- [ ] Frame handling
- [ ] Visibility checks

### Phase 3: Advanced Features (Week 5-6)

- [ ] `vision_ocr` / `vision_find_by_text`
- [ ] `net_observe` / `net_get_response_body`
- [ ] `session_save` / `session_restore`
- [ ] Site memory profiles
- [ ] Virtualized list handling

### Phase 4: Safety & Production (Week 7-8)

- [ ] `safety_set_policy`
- [ ] `audit_snapshot`
- [ ] Domain allowlists
- [ ] Action budgets
- [ ] Comprehensive logging
- [ ] Error recovery

## CEF Bridge Requirements

Your Qt/CEF application must expose these capabilities via IPC:

```typescript
interface CEFBridge {
  // CDP Methods
  executeDevToolsMethod(method: string, params: any): Promise<any>;
  onDevToolsEvent(handler: (event: string, params: any) => void): void;

  // Screenshot
  captureScreenshot(region?: BBox): Promise<string>; // Returns base64 or path

  // File System
  saveFile(path: string, data: Buffer): Promise<void>;
  readFile(path: string): Promise<Buffer>;

  // Safety
  setSafetyPolicy(policy: SafetyPolicy): void;
}
```

## Testing

```bash
# Run tests
npm test

# Test with Claude Desktop
# 1. Configure Claude Desktop (see Configuration section)
# 2. Restart Claude Desktop
# 3. Start a conversation with Claude
# 4. Ask: "Can you help me navigate to example.com and find the search box?"
```

## Debugging

Enable debug logging:

```bash
DEBUG=mcp:* node dist/src/index.js
```

Check MCP communication:

```bash
# View MCP protocol messages
tail -f ~/Library/Logs/Claude/mcp*.log  # macOS
```

## API Reference

See [src/config/tools.json](./src/config/tools.json) for complete tool definitions.

See type definitions in:

- [src/domains/interaction/interaction.types.ts](./src/domains/interaction/interaction.types.ts)
- [src/domains/perception/perception.types.ts](./src/domains/perception/perception.types.ts)
- [src/domains/navigation/navigation.types.ts](./src/domains/navigation/navigation.types.ts)
- [src/domains/session/session.types.ts](./src/domains/session/session.types.ts)

## Design Principles

1. **Separation of Concerns**: Agent never touches CDP directly
2. **Resilience**: Multiple locator strategies with automatic fallback
3. **Observability**: Every action logged with screenshots
4. **Safety**: Allowlists, budgets, and confirmations built-in
5. **Determinism**: Prefer stable AX/DOM methods over vision
6. **Testability**: Each tool is independently testable

## Contributing

1. Add new tools to `src/config/tools.json`
2. Add type definitions to appropriate domain type files
3. Implement handlers in respective domain handler files
4. Add tests in `tests/`
5. Update README with examples

## License

MIT

## Support

For issues or questions, please open an issue on GitHub or contact the development team.

## Roadmap

- [ ] Multi-tab support
- [ ] Browser extension API bridge
- [ ] Performance profiling tools
- [ ] A/B testing utilities
- [ ] Visual regression testing
- [ ] Accessibility audit tools
- [ ] Network throttling
- [ ] Geolocation simulation
- [ ] Device emulation
