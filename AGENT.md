# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Athena Browser MCP is an MCP (Model Context Protocol) server for AI-powered browser automation via Playwright and CDP (Chrome DevTools Protocol). It provides **semantic page snapshots** - compact, structured representations designed for LLM consumption with stable element IDs that survive DOM mutations.

**18 Tools** across 5 categories:

- **Session**: launch_browser, connect_browser, close_page, close_session
- **Navigation**: navigate, go_back, go_forward, reload
- **Observation**: capture_snapshot, find_elements, get_node_details
- **Interaction**: click, type, press, select, hover, scroll_element_into_view, scroll_page

## Build and Development Commands

```bash
# Build
npm run build              # Compile TypeScript
npm run dev                # Watch mode compilation

# Quality checks
npm run type-check         # TypeScript type checking
npm run lint               # ESLint
npm run lint:fix           # ESLint with auto-fix
npm run format             # Prettier format
npm run check              # Run all checks (type-check + lint + format:check + test)

# Testing
npm test                   # Run all tests once
npm run test:watch         # Watch mode for development
npm run test:coverage      # Generate coverage report
npm run test:unit          # Run only unit tests
npm run test:integration   # Run only integration tests

# Run single test file
npx vitest run tests/unit/browser/session-manager.test.ts

# Run tests matching pattern
npx vitest run -t "should launch with default options"

# Debug/inspect
npm run mcp:inspect        # MCP protocol inspector
```

## Architecture

```
AI Agent
    ↓ MCP Protocol (stdio)
Tool Handlers (browser-tools.ts)
    ↓
┌─────────────────────────────────────┐
│ Core Systems                        │
│ ├─ SessionManager (lifecycle)       │
│ ├─ StateManager (state + diff)      │
│ ├─ SnapshotCompiler (extraction)    │
│ └─ ElementRegistry (eid lookup)     │
└─────────────────────────────────────┘
    ↓ Playwright + CDP
Chromium Browser
```

**Data Flow** (e.g., click action):

1. Tool handler receives `{ eid, page_id }`
2. ElementRegistry resolves eid → backend_node_id
3. CDP executes click via PlaywrightCdpClient
4. Page stabilization (network idle wait)
5. SnapshotCompiler extracts fresh snapshot
6. StateManager computes diff against previous snapshot
7. LayerDetector determines active layer (modal/drawer/main)
8. Actionables filtered to active layer only
9. XML response rendered and returned

## Key Components

### SessionManager (`src/browser/session-manager.ts`)

- Browser lifecycle: `launch()` or `connect()` (to existing CDP endpoint)
- Single BrowserContext shared across pages (preserves cookies/storage)
- Environment config: `CEF_BRIDGE_HOST`, `CEF_BRIDGE_PORT`

### StateManager (`src/state/state-manager.ts`)

- Per-page instance tracking state and computing diffs
- Computes stable semantic element IDs (eids)
- Detects layers: modal > drawer > popover > main
- Masks sensitive values (passwords, tokens, SSNs)

### SnapshotCompiler (`src/snapshot/snapshot-compiler.ts`)

Orchestrates modular extractors to build BaseSnapshot:

- `dom-extractor.ts`: DOM tree with frame/shadow tracking
- `ax-extractor.ts`: ARIA roles, accessible names, states
- `layout-extractor.ts`: Bounding boxes, visibility, z-index
- `label-resolver.ts`: Multi-source accessible name resolution
- `region-resolver.ts`: Semantic regions (header/main/sidebar/footer)

### Element Identity (`src/state/element-identity.ts`)

EIDs computed from semantic hash of: role, accessible name, landmark path, position hint, layer context. Survives DOM mutations.

## Directory Structure

```
src/
├── index.ts                     # Entry point, tool registration
├── browser/
│   ├── session-manager.ts       # Browser lifecycle
│   ├── page-registry.ts         # Page tracking with MRU
│   └── page-stabilization.ts    # Network idle detection
├── cdp/
│   ├── cdp-client.interface.ts  # Generic CDP abstraction
│   └── playwright-cdp-client.ts # Playwright implementation
├── server/
│   └── mcp-server.ts            # MCP server with tool registration
├── tools/
│   ├── browser-tools.ts         # Tool handler implementations
│   ├── execute-action.ts        # Action execution with retry
│   └── tool-schemas.ts          # Zod input schemas
├── snapshot/
│   ├── snapshot-compiler.ts     # Orchestrates extractors
│   └── extractors/              # Modular extraction algorithms
├── state/
│   ├── state-manager.ts         # Per-page state + diff
│   ├── element-identity.ts      # EID computation
│   ├── layer-detector.ts        # Modal/drawer/popover detection
│   └── element-registry.ts      # EID → node mapping
├── observation/
│   └── observation-accumulator.ts # DOM mutation tracking
├── query/
│   └── query-engine.ts          # Find elements by criteria
├── renderer/
│   └── xml-renderer.ts          # XML output rendering
├── delta/
│   └── dom-stabilizer.ts        # Stabilize DOM after actions
├── lib/                         # Reusable algorithms
└── shared/                      # Types, services, errors

tests/
├── setup.ts                     # Global test setup
├── mocks/
│   ├── playwright.mock.ts       # Browser/Page/CDP mocks
│   └── cdp-client.mock.ts       # MockCdpClient class
├── helpers/
│   └── test-utils.ts            # Test utilities
├── fixtures/
│   └── cdp-responses/           # Real CDP JSON responses
├── unit/                        # Unit tests by module
└── integration/                 # Integration tests
```

## Testing Patterns

**Mocks**: Use `createLinkedMocks()` from `tests/mocks/playwright.mock.ts` for full Browser→Context→Page→CDP chain. Use `MockCdpClient` from `tests/mocks/cdp-client.mock.ts` for CDP response stubbing.

**Pattern**:

```typescript
import { createLinkedMocks } from '../../mocks/playwright.mock.js';
import { MockCdpClient } from '../../mocks/cdp-client.mock.js';

beforeEach(() => {
  vi.clearAllMocks();
  const { browser, context, page, cdpSession } = createLinkedMocks();
});
```

## Technical Notes

- All imports use `.js` extensions (ESM with NodeNext resolution)
- CDP domains (Page, DOM, Network) enabled on-demand
- Vitest with globals, v8 coverage provider
- Node >= 20.0.0 required
