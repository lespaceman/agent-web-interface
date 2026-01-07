# Architectural Review Request: SessionManager CDP Connection

**Date:** 2026-01-07
**Author:** Nadeem M
**Component:** `src/browser/session-manager.ts`
**Status:** Ready for Review

---

## Summary

Added capability for `SessionManager` to connect to an **existing browser** via CDP, in addition to launching a new browser. This enables integration with Athena Browser (CEF-based) without requiring Playwright browser installation.

---

## Changes Overview

| File                                         | Change Type  | Description                                 |
| -------------------------------------------- | ------------ | ------------------------------------------- |
| `src/browser/session-manager.ts`             | **Modified** | Added `connect()` and `adoptPage()` methods |
| `src/browser/index.ts`                       | Modified     | Export new types                            |
| `tests/unit/browser/session-manager.test.ts` | Modified     | Added 11 new tests                          |

---

## Motivation

1. **Existing Infrastructure**: Athena Browser is a CEF-based browser already running with CDP enabled on port 9223
2. **Avoid Duplication**: No need to launch a second browser when one is already available
3. **Playwright Dependency**: `chromium.launch()` requires `npx playwright install` (~165MB download)
4. **Unified Interface**: Same `CdpClient` interface works for both connection modes

---

## Technical Design

### New Public API

```typescript
interface ConnectOptions {
  endpointUrl?: string; // Full URL: http://127.0.0.1:9223
  host?: string; // Default: 127.0.0.1 (or CEF_BRIDGE_HOST env)
  port?: number; // Default: 9223 (or CEF_BRIDGE_PORT env)
}

class SessionManager {
  // Existing
  async launch(options?: LaunchOptions): Promise<void>;

  // New
  async connect(options?: ConnectOptions): Promise<void>;
  async adoptPage(index?: number): Promise<PageHandle>;
}
```

### Connection Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      SessionManager                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  launch()                          connect()                     │
│     │                                  │                         │
│     ▼                                  ▼                         │
│  chromium.launch()              chromium.connectOverCDP()        │
│     │                                  │                         │
│     ▼                                  ▼                         │
│  browser.newContext()           browser.contexts()[0]            │
│     │                                  │                         │
│     └──────────────┬───────────────────┘                         │
│                    ▼                                             │
│              this.context                                        │
│                    │                                             │
│     ┌──────────────┼──────────────┐                              │
│     ▼              ▼              ▼                              │
│  createPage()  adoptPage()   navigateTo()                        │
│     │              │                                             │
│     └──────────────┴──────────────────┐                          │
│                                       ▼                          │
│                              context.newCDPSession(page)         │
│                                       │                          │
│                                       ▼                          │
│                              PlaywrightCdpClient                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Shutdown Behavior Difference

| Mode        | `shutdown()` Behavior                                       |
| ----------- | ----------------------------------------------------------- |
| `launch()`  | Close all pages, context, and browser                       |
| `connect()` | Detach CDP sessions only; **do not** close external browser |

This is critical: we must not close the user's Athena browser when disconnecting.

---

## Implementation Details

### Key Code Paths

**connect():**

```typescript
async connect(options: ConnectOptions = {}): Promise<void> {
  const endpointUrl = options.endpointUrl ?? `http://${host}:${port}`;

  // Playwright's connectOverCDP - same CDP protocol, different transport
  this.browser = await chromium.connectOverCDP(endpointUrl);

  // Reuse existing context (Athena's context)
  const contexts = this.browser.contexts();
  this.context = contexts[0] ?? await this.browser.newContext();

  this.isExternalBrowser = true;  // Flag for shutdown behavior
}
```

**adoptPage():**

```typescript
async adoptPage(index = 0): Promise<PageHandle> {
  const pages = this.context.pages();
  const page = pages[index];

  // Create CDP session for existing page
  const cdpSession = await this.context.newCDPSession(page);
  const cdpClient = new PlaywrightCdpClient(cdpSession);

  return this.registry.register(page, cdpClient);
}
```

---

## Risk Assessment

| Risk                                 | Severity | Mitigation                                                           |
| ------------------------------------ | -------- | -------------------------------------------------------------------- |
| External browser closed unexpectedly | Medium   | `PlaywrightCdpClient` detects disconnection, sets `isActive = false` |
| Multiple CDP sessions to same page   | Low      | Each `adoptPage()` creates new session; old ones still work          |
| Context mismatch (cookies/storage)   | Low      | We use Athena's existing context, not creating new one               |
| Env var conflicts (`CEF_BRIDGE_*`)   | Low      | Explicit options take precedence over env vars                       |

---

## Questions for Reviewers

1. **Session Lifecycle**: Should `connect()` support reconnection if the browser disconnects, or should the caller handle this?

2. **Multiple Contexts**: Athena typically has one context. Should we support selecting a specific context by index?

3. **Page Tracking**: When adopting pages, should we auto-adopt all pages or require explicit `adoptPage()` calls?

4. **Error Handling**: Should `connect()` throw immediately if the endpoint is unreachable, or should it retry with backoff?

5. **Deprecation Path**: Should we formally deprecate `CEFBridge` now that `SessionManager.connect()` provides equivalent functionality?

---

## Test Coverage

| Test Suite            | Tests  | Coverage                                                        |
| --------------------- | ------ | --------------------------------------------------------------- |
| `connect()`           | 5      | Endpoint URL, host/port, already-connected error, context reuse |
| `adoptPage()`         | 4      | Page adoption, URL tracking, invalid index, not-connected error |
| `shutdown (external)` | 2      | No browser close, CDP session detach                            |
| **Total New**         | **11** |                                                                 |

All 82 tests passing.

---

## Alternatives Considered

### 1. Separate `CefCdpClient` Implementation

Create a new `CdpClient` implementation using `chrome-remote-interface` directly.

**Rejected because:**

- Duplicates CDP handling logic
- Two code paths to maintain
- Playwright's `connectOverCDP` already provides this

### 2. Keep CEFBridge

Continue using the deprecated `CEFBridge` class.

**Rejected because:**

- Different interface from `SessionManager`
- No page registry integration
- Already marked deprecated

### 3. Factory Pattern

```typescript
const session = await SessionManager.connectToExternal({ port: 9223 });
const session = await SessionManager.launchNew({ headless: true });
```

**Deferred**: Could refactor to this pattern later if complexity grows.

---

## Rollout Plan

1. **Phase 1 (Current)**: Add `connect()` method, keep `launch()` unchanged
2. **Phase 2**: Update MCP tools to use `connect()` for Athena integration
3. **Phase 3**: Deprecate `CEFBridge` completely
4. **Phase 4**: Remove `CEFBridge` in next major version

---

## Files Changed

```
src/browser/session-manager.ts   (+95 lines)
src/browser/index.ts             (+3 lines)
tests/unit/browser/session-manager.test.ts (+105 lines)
eslint.config.js                 (+1 line - ignore scripts/)
```

---

## Approval Checklist

- [ ] Architecture pattern approved
- [ ] Error handling strategy approved
- [ ] Test coverage sufficient
- [ ] Documentation updated
- [ ] No security concerns
- [ ] Performance impact acceptable

---

## References

- [Playwright connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- Implementation Plan: `~/.claude/plans/dreamy-sleeping-stonebraker.md`
