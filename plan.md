# Plan: Network Watcher Feature

## Overview

Add a network watcher system that lets AI agents monitor HTTP requests/responses made by the browser. The pattern follows the existing DOM observation accumulator: start watching, accumulate requests, retrieve-and-clear on demand.

## Two New MCP Tools

### 1. `watch_network` — Start/configure network watching

**Input schema:**

- `page_id` (string, optional) — Target page (defaults to MRU)
- `resource_types` (string[], optional) — Filter to specific resource types. Defaults to `["xhr"]`. Full set available: `xhr`, `fetch`, `document`, `stylesheet`, `image`, `media`, `font`, `script`, `websocket`, `manifest`, `other`

**Behavior:**

- Attaches network event listeners to the target page
- Starts accumulating request/response entries
- If already watching, reconfigures the filter (clears previous accumulated data)
- Returns a confirmation message with what's being watched

**Output:** Plain text confirmation, e.g. `"Watching network requests on page abc123 for: xhr, fetch, document"`

### 2. `get_network_requests` — Retrieve accumulated requests and clear

**Input schema:**

- `page_id` (string, optional) — Target page (defaults to MRU)

**Behavior:**

- Returns all network requests accumulated since the last `watch_network` or `get_network_requests` call
- **Clears** the accumulated buffer after retrieval (so next call only returns new requests)
- If not currently watching, returns an error/empty message
- Returns data as structured XML (consistent with other tool outputs)

**Output:** XML string containing the captured requests:

```xml
<network_requests count="3" page_id="abc123">
  <request seq="1" method="GET" url="https://api.example.com/users" resource_type="fetch" status="200" duration_ms="142" timestamp="1707900000000">
    <request_headers>
      <header name="Authorization">Bearer ***</header>
      <header name="Content-Type">application/json</header>
    </request_headers>
    <response_headers>
      <header name="Content-Type">application/json; charset=utf-8</header>
    </response_headers>
    <response_body truncated="false">{"users": [...]}</response_body>
  </request>
  <request seq="2" method="POST" url="https://api.example.com/data" resource_type="xhr" status="201" duration_ms="89" timestamp="1707900001000">
    <request_body>{"name": "test"}</request_body>
    <response_body truncated="true">{"id": 42, "name": "test", ...}</response_body>
  </request>
  <request seq="3" method="GET" url="https://cdn.example.com/style.css" resource_type="stylesheet" status="304" duration_ms="12" timestamp="1707900002000" />
</network_requests>
```

If no requests captured: `<network_requests count="0" page_id="abc123" />`
If not watching: `<error>Network watcher not active on this page. Call watch_network first.</error>`

## New Files

### `src/network/network-watcher.ts` — Core accumulator class

**`NetworkWatcher` class** (per-page instance, stored in WeakMap registry):

```
Fields:
  - page: Page
  - entries: CapturedNetworkEntry[]
  - resourceTypeFilter: Set<string>
  - sequenceCounter: number
  - generation: number (for safe navigation handling, same pattern as PageNetworkTracker)
  - event handlers (for cleanup via page.off())

Methods:
  - attach(page, resourceTypes): void — Attach listeners, set filter, clear buffer
  - detach(): void — Remove listeners, cleanup
  - getAndClear(): CapturedNetworkEntry[] — Return accumulated entries, reset buffer
  - isActive(): boolean
  - markNavigation(): void — Bump generation, keep watching across navigations
```

**Event handling:**

- `page.on('request', ...)` — Capture request metadata (method, url, headers, postData)
- `page.on('requestfinished', ...)` — Match with pending request, capture response (status, headers, body text)
- `page.on('requestfailed', ...)` — Match with pending request, capture failure reason

**Correlation:** Use a `Map<string, PendingRequest>` keyed by Puppeteer's request ID to correlate request → response.

**Body capture:**

- Use `response.text()` for response bodies (with try/catch for binary/large responses)
- Truncate bodies to 10KB max, set `truncated: true` flag
- Mask sensitive headers (Authorization, Cookie, Set-Cookie) — show `***` for values
- Capture `request.postData()` for request bodies

**Global registry functions** (same pattern as `page-network-tracker.ts`):

```typescript
const watchers = new WeakMap<Page, NetworkWatcher>();
export function getOrCreateWatcher(page: Page): NetworkWatcher;
export function getWatcher(page: Page): NetworkWatcher | undefined;
export function removeWatcher(page: Page): void;
```

### `src/network/network-watcher.types.ts` — Type definitions

```typescript
export interface CapturedNetworkEntry {
  seq: number; // Sequence number
  method: string; // GET, POST, PUT, DELETE, etc.
  url: string; // Full URL
  resourceType: string; // xhr, fetch, document, etc.
  timestamp: number; // Epoch ms when request started

  // Response (populated on requestfinished)
  status?: number; // HTTP status code
  statusText?: string; // HTTP status text
  durationMs?: number; // Time from request to response

  // Headers (sensitive values masked)
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;

  // Bodies (truncated at 10KB)
  requestBody?: string;
  responseBody?: string;
  bodyTruncated?: boolean;

  // Failure (populated on requestfailed)
  failureReason?: string;
  state: 'pending' | 'completed' | 'failed';
}

export type NetworkResourceType =
  | 'xhr'
  | 'fetch'
  | 'document'
  | 'stylesheet'
  | 'image'
  | 'media'
  | 'font'
  | 'script'
  | 'websocket'
  | 'manifest'
  | 'other';

export const DEFAULT_RESOURCE_TYPES: NetworkResourceType[] = ['xhr'];
```

### `src/network/network-renderer.ts` — XML rendering for results

Renders `CapturedNetworkEntry[]` into XML string format (following the project's XML rendering convention used in `xml-renderer.ts`).

### `src/network/index.ts` — Barrel exports

## Modified Files

### `src/tools/tool-schemas.ts`

Add:

- `WatchNetworkInputSchema` — page_id (optional), resource_types (optional string array with enum validation)
- `WatchNetworkOutputSchema` — z.string()
- `GetNetworkRequestsInputSchema` — page_id (optional)
- `GetNetworkRequestsOutputSchema` — z.string()

### `src/tools/browser-tools.ts`

Add two new tool handler functions:

- `watchNetwork(rawInput)` — Validates input, resolves page, creates/reconfigures NetworkWatcher, returns confirmation
- `getNetworkRequests(rawInput)` — Validates input, resolves page, calls `watcher.getAndClear()`, renders XML, returns result

### `src/tools/index.ts`

Export the new handlers and schemas.

### `src/index.ts`

Register the two new tools in the "OBSERVATION TOOLS" section:

- `watch_network` with description and schema
- `get_network_requests` with description and schema

## Navigation Handling

When the page navigates, the watcher needs to survive (keep watching on the new document). This is handled by:

- Puppeteer page event listeners persist across navigations (they're on the Page object, not the document)
- Bump the generation counter via `markNavigation()` to ignore stale in-flight request events from the previous page
- The watcher stays active — no need to re-call `watch_network` after navigation

Integration point: In the navigation handler in `browser-tools.ts`, after navigation completes, call `watcher.markNavigation()` if a watcher exists for the page.

## Security Considerations

- **Sensitive header masking:** Authorization, Cookie, Set-Cookie, X-API-Key headers have values replaced with `"***"`
- **Body size limits:** Response/request bodies truncated at 10KB to prevent memory issues
- **No binary bodies:** Skip body capture for non-text content types (images, fonts, etc.)

## Tests

### `tests/unit/network/network-watcher.test.ts`

- Attach/detach lifecycle
- Request accumulation and filtering by resource type
- Get-and-clear semantics (buffer resets after retrieval)
- Navigation generation handling
- Sensitive header masking
- Body truncation
- Request/response correlation

### `tests/unit/network/network-renderer.test.ts`

- XML rendering of captured entries
- Empty results rendering
- Truncated body rendering
- Special character escaping in URLs/headers

## Implementation Order

1. Create type definitions (`network-watcher.types.ts`)
2. Create NetworkWatcher class (`network-watcher.ts`)
3. Create XML renderer (`network-renderer.ts`)
4. Create barrel exports (`network/index.ts`)
5. Add tool schemas (`tool-schemas.ts`)
6. Add tool handlers (`browser-tools.ts`)
7. Update tool exports (`tools/index.ts`)
8. Register tools in MCP server (`index.ts`)
9. Add navigation integration (call `markNavigation()` in nav handlers)
10. Write unit tests
11. Run `npm run check` to validate
