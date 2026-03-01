# Multi-Tenancy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable multiple agents to use the MCP server in parallel with isolated browser sessions, tied to MCP connection lifecycle (not individual agent runs), with sessions that survive across runs within the same MCP connection.

**Architecture:** The MCP stdio transport already persists for the entire Claude Code session (across multiple agent runs). We hook `server.server.oninitialized` to create a browser session on MCP connect, and `server.server.onclose` to detach (not kill) the browser on MCP disconnect. Each MCP connection gets its own `BrowserContext` for cookie/storage isolation. For full process isolation, we port the stale branch's `WorkerManager` which spawns independent Chrome processes that outlive the MCP server.

**Tech Stack:** TypeScript, Puppeteer-core, MCP SDK `@modelcontextprotocol/sdk@^1.25.2`, Vitest, CDP

---

## Context: Current Architecture

### What exists today (single-tenant)
- **One `SessionManager` singleton** per process (`src/server/server-config.ts:47-50`)
- **One `BrowserContext`** — all pages share cookies/storage (`src/browser/session-manager.ts:266`)
- **Per-page state** — `StateManager` (keyed by `page_id` in `execute-action.ts:37`), `ElementRegistry` (`element-registry.ts:232`), `SnapshotStore` (`browser-tools.ts:79`)
- **Lazy browser init** — `withLazyInit()` in `index.ts:74-104` launches browser on first tool call
- **Kill on shutdown** — `shutdown()` at `session-manager.ts:818-887` closes launched browsers or disconnects connected ones
- **No MCP lifecycle hooks** — `oninitialized` and `onclose` are unused

### What exists but is unused
- **`SessionStore`** (`src/server/session-store.ts`) — TTL-based tenant session tracking with auto-cleanup. Has tests at `tests/unit/server/session-store.test.ts`. Never wired up.
- **Stale branch** `origin/backup/multi-tenant-worker-manager` — 5,400 lines: `WorkerManager`, `LeaseManager`, `HealthMonitor`, `PortAllocator`, `ChromeWorkerProcess`, error classes, full test suite. Designed for env-var tenancy (`TENANT_ID`), not MCP-session-scoped. `LeaseManager`, `HealthMonitor`, `PortAllocator`, error types are directly reusable.

### MCP SDK lifecycle hooks available
```typescript
// After MCP handshake completes (called once per MCP connection)
this.server.server.oninitialized = () => {
  const client = this.server.server.getClientVersion(); // { name, version }
  // → create or resume browser session
};

// When MCP connection closes (stdin closes / process exits)
this.server.server.onclose = () => {
  // → detach browser, mark session dormant
};
```

### The stale session problem
Agent loses page access because:
1. MCP server = child process of agent host → host exits → browser dies
2. No reconnect mechanism → new agent run = fresh process = fresh browser
3. `shutdown()` kills browser instead of detaching

### Solution: Tie browser to MCP session, not tool calls
```
Claude Code starts → spawns MCP server → oninitialized fires → create browser session
  Agent run 1: tool calls (browser persists)
  Agent run 2: tool calls (same browser, same pages)
  Agent run N: tool calls (same browser)
Claude Code exits → stdin closes → onclose fires → detach browser (don't kill)
```

---

## Task 1: Add MCP Lifecycle Hooks to BrowserAutomationServer

**Files:**
- Modify: `src/server/mcp-server.ts`
- Test: `tests/unit/server/mcp-server-lifecycle.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/server/mcp-server-lifecycle.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test that BrowserAutomationServer wires up oninitialized and onclose
// We'll mock the McpServer and StdioServerTransport

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  const mockServer = {
    oninitialized: undefined as (() => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    getClientVersion: vi.fn().mockReturnValue({ name: 'claude-code', version: '1.0' }),
    getClientCapabilities: vi.fn().mockReturnValue({}),
    setRequestHandler: vi.fn(),
    setNotificationHandler: vi.fn(),
    notification: vi.fn(),
  };
  return {
    McpServer: vi.fn().mockImplementation(() => ({
      server: mockServer,
      tool: vi.fn(),
      registerTool: vi.fn(),
      connect: vi.fn(),
      close: vi.fn(),
    })),
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  SetLevelRequestSchema: { method: 'logging/setLevel' },
}));

vi.mock('../../src/shared/services/logging.service.js', () => ({
  getLogger: vi.fn().mockReturnValue({
    setMcpServer: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    setMinLevel: vi.fn(),
  }),
}));

vi.mock('../../src/tools/tool-result.types.js', () => ({
  isImageResult: vi.fn().mockReturnValue(false),
  isFileResult: vi.fn().mockReturnValue(false),
}));

import { BrowserAutomationServer } from '../../src/server/mcp-server.js';

describe('BrowserAutomationServer lifecycle hooks', () => {
  let serverInstance: BrowserAutomationServer;

  beforeEach(() => {
    vi.clearAllMocks();
    serverInstance = new BrowserAutomationServer({ name: 'test', version: '1.0' });
  });

  it('should set oninitialized callback on underlying Server', () => {
    // Access the underlying McpServer's server property
    const underlyingServer = (serverInstance as any).server.server;
    expect(underlyingServer.oninitialized).toBeTypeOf('function');
  });

  it('should set onclose callback on underlying Server', () => {
    const underlyingServer = (serverInstance as any).server.server;
    expect(underlyingServer.onclose).toBeTypeOf('function');
  });

  it('should emit "session:start" when oninitialized fires', () => {
    const listener = vi.fn();
    serverInstance.on('session:start', listener);

    const underlyingServer = (serverInstance as any).server.server;
    underlyingServer.oninitialized();

    expect(listener).toHaveBeenCalledWith({
      clientInfo: { name: 'claude-code', version: '1.0' },
    });
  });

  it('should emit "session:end" when onclose fires', () => {
    const listener = vi.fn();
    serverInstance.on('session:end', listener);

    const underlyingServer = (serverInstance as any).server.server;
    underlyingServer.onclose();

    expect(listener).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/server/mcp-server-lifecycle.test.ts`
Expected: FAIL — `serverInstance.on is not a function` and `oninitialized` is undefined

**Step 3: Implement lifecycle hooks in BrowserAutomationServer**

Modify `src/server/mcp-server.ts`:
- Add `EventEmitter` to `BrowserAutomationServer`
- In constructor, after creating McpServer, wire up:
  ```typescript
  this.server.server.oninitialized = () => {
    const clientInfo = this.server.server.getClientVersion();
    this.emit('session:start', { clientInfo });
  };
  this.server.server.onclose = () => {
    this.emit('session:end');
  };
  ```
- Export event types: `session:start` and `session:end`

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/server/mcp-server-lifecycle.test.ts`
Expected: PASS

**Step 5: Run full checks**

Run: `npm run type-check && npm run lint`
Expected: PASS

**Step 6: Commit**

```
feat: add MCP lifecycle hooks (oninitialized, onclose) to BrowserAutomationServer
```

---

## Task 2: Create SessionRegistry — Session-Scoped State Container

**Files:**
- Create: `src/session/session-registry.ts`
- Create: `src/session/session-registry.types.ts`
- Test: `tests/unit/session/session-registry.test.ts`

This is the core abstraction: a registry mapping `session_id` → all session-scoped state (SessionManager, StateManagers, SnapshotStore, ElementRegistries, etc.).

**Step 1: Write the failing test**

```typescript
// tests/unit/session/session-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SessionRegistry } from '../../../src/session/session-registry.js';

describe('SessionRegistry', () => {
  let registry: SessionRegistry;

  beforeEach(() => {
    registry = new SessionRegistry();
  });

  describe('createSession', () => {
    it('should create a session with auto-generated ID', () => {
      const session = registry.createSession();
      expect(session.sessionId).toMatch(/^session-/);
    });

    it('should track session as active', () => {
      const session = registry.createSession();
      expect(registry.hasSession(session.sessionId)).toBe(true);
    });

    it('should set createdAt timestamp', () => {
      const before = Date.now();
      const session = registry.createSession();
      expect(session.createdAt).toBeGreaterThanOrEqual(before);
      expect(session.createdAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('getSession', () => {
    it('should return undefined for unknown session', () => {
      expect(registry.getSession('nonexistent')).toBeUndefined();
    });

    it('should return the session by ID', () => {
      const session = registry.createSession();
      const retrieved = registry.getSession(session.sessionId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.sessionId).toBe(session.sessionId);
    });

    it('should refresh lastAccessedAt on get', () => {
      const session = registry.createSession();
      const firstAccess = session.lastAccessedAt;
      // Tiny delay to ensure timestamp differs
      const retrieved = registry.getSession(session.sessionId);
      expect(retrieved!.lastAccessedAt).toBeGreaterThanOrEqual(firstAccess);
    });
  });

  describe('getDefaultSession', () => {
    it('should return undefined when no sessions exist', () => {
      expect(registry.getDefaultSession()).toBeUndefined();
    });

    it('should return the only session when one exists', () => {
      const session = registry.createSession();
      expect(registry.getDefaultSession()?.sessionId).toBe(session.sessionId);
    });

    it('should throw when multiple sessions exist and no ID provided', () => {
      registry.createSession();
      registry.createSession();
      expect(() => registry.getDefaultSession()).toThrow(/multiple sessions/i);
    });
  });

  describe('removeSession', () => {
    it('should remove a session', () => {
      const session = registry.createSession();
      registry.removeSession(session.sessionId);
      expect(registry.hasSession(session.sessionId)).toBe(false);
    });

    it('should return false for unknown session', () => {
      expect(registry.removeSession('nonexistent')).toBe(false);
    });
  });

  describe('listSessions', () => {
    it('should return all sessions', () => {
      registry.createSession();
      registry.createSession();
      expect(registry.listSessions()).toHaveLength(2);
    });
  });

  describe('sessionCount', () => {
    it('should return 0 initially', () => {
      expect(registry.sessionCount).toBe(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/session/session-registry.test.ts`
Expected: FAIL — module not found

**Step 3: Implement SessionRegistry**

Create `src/session/session-registry.types.ts`:
```typescript
export interface SessionEntry {
  sessionId: string;
  createdAt: number;
  lastAccessedAt: number;
  /** Page IDs belonging to this session */
  pageIds: Set<string>;
  /** Client info from MCP initialization */
  clientInfo?: { name: string; version: string };
}
```

Create `src/session/session-registry.ts`:
```typescript
import { randomUUID } from 'crypto';
import type { SessionEntry } from './session-registry.types.js';

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionEntry>();

  createSession(clientInfo?: { name: string; version: string }): SessionEntry {
    const now = Date.now();
    const entry: SessionEntry = {
      sessionId: `session-${randomUUID()}`,
      createdAt: now,
      lastAccessedAt: now,
      pageIds: new Set(),
      clientInfo,
    };
    this.sessions.set(entry.sessionId, entry);
    return entry;
  }

  getSession(sessionId: string): SessionEntry | undefined {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.lastAccessedAt = Date.now();
    return entry;
  }

  getDefaultSession(): SessionEntry | undefined {
    if (this.sessions.size === 0) return undefined;
    if (this.sessions.size > 1) {
      throw new Error(
        `Multiple sessions active (${this.sessions.size}). ` +
        `Provide an explicit session_id.`
      );
    }
    return this.sessions.values().next().value;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  removeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  listSessions(): SessionEntry[] {
    return Array.from(this.sessions.values());
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  clear(): void {
    this.sessions.clear();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/session/session-registry.test.ts`
Expected: PASS

**Step 5: Run full checks**

Run: `npm run type-check && npm run lint`
Expected: PASS

**Step 6: Commit**

```
feat: add SessionRegistry for session-scoped state tracking
```

---

## Task 3: Wire SessionRegistry into MCP Lifecycle

**Files:**
- Modify: `src/index.ts`
- Modify: `src/server/mcp-server.ts`
- Test: `tests/unit/server/session-lifecycle-integration.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/server/session-lifecycle-integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionRegistry } from '../../../src/session/session-registry.js';

describe('Session lifecycle integration', () => {
  let registry: SessionRegistry;

  beforeEach(() => {
    registry = new SessionRegistry();
  });

  it('should create session on MCP initialized event', () => {
    // Simulate what index.ts does when session:start fires
    const clientInfo = { name: 'claude-code', version: '1.0' };
    const session = registry.createSession(clientInfo);

    expect(registry.sessionCount).toBe(1);
    expect(session.clientInfo?.name).toBe('claude-code');
  });

  it('should mark session for cleanup on MCP close event', () => {
    const session = registry.createSession();
    registry.removeSession(session.sessionId);
    expect(registry.sessionCount).toBe(0);
  });
});
```

**Step 2: Run test to verify it passes** (this is a pure-logic test, should pass given Task 2)

Run: `npx vitest run tests/unit/server/session-lifecycle-integration.test.ts`
Expected: PASS

**Step 3: Wire into index.ts**

In `src/index.ts`, after `initializeServer()`:
- Create a global `SessionRegistry` instance
- Listen for `session:start` from `BrowserAutomationServer` → `registry.createSession(clientInfo)`
- Listen for `session:end` → mark session dormant (don't immediately destroy — browser should persist for reconnect)
- Export `getSessionRegistry()` for tool handlers to access

**Step 4: Modify shutdown handler**

In `src/index.ts`, the SIGINT/SIGTERM handler currently calls `session.shutdown()`. Change to:
- If browser was launched by us: save storage state, then close
- If browser was connected externally: just disconnect (already the behavior for `isExternalBrowser`)
- Log session info for debugging

**Step 5: Run full checks**

Run: `npm run type-check && npm run lint && npm test`
Expected: PASS

**Step 6: Commit**

```
feat: wire SessionRegistry into MCP lifecycle (oninitialized/onclose)
```

---

## Task 4: Session-Scoped Tool Routing

**Files:**
- Modify: `src/tools/browser-tools.ts`
- Modify: `src/tools/execute-action.ts`
- Test: `tests/unit/tools/session-routing.test.ts`

This task makes tool handlers session-aware. When only one session exists, behavior is unchanged (backwards compatible). When multiple sessions exist, `session_id` is required.

**Step 1: Write the failing test**

```typescript
// tests/unit/tools/session-routing.test.ts
import { describe, it, expect } from 'vitest';
import { SessionRegistry } from '../../../src/session/session-registry.js';

describe('resolveSession', () => {
  let registry: SessionRegistry;

  beforeEach(() => {
    registry = new SessionRegistry();
  });

  it('should return the only session when session_id is omitted', () => {
    const session = registry.createSession();
    const resolved = registry.getDefaultSession();
    expect(resolved?.sessionId).toBe(session.sessionId);
  });

  it('should return specific session by ID', () => {
    const s1 = registry.createSession();
    const s2 = registry.createSession();
    const resolved = registry.getSession(s2.sessionId);
    expect(resolved?.sessionId).toBe(s2.sessionId);
  });

  it('should throw if multiple sessions and no ID provided', () => {
    registry.createSession();
    registry.createSession();
    expect(() => registry.getDefaultSession()).toThrow();
  });
});
```

**Step 2: Run test to verify it fails/passes** (logic already in SessionRegistry from Task 2)

Run: `npx vitest run tests/unit/tools/session-routing.test.ts`
Expected: PASS

**Step 3: Add `session_id` to tool input schemas**

In `src/tools/tool-schemas.ts`, add `session_id: z.string().optional()` to input schemas that need session routing (all tools except `list_sessions`).

**Step 4: Update `resolveExistingPage` in browser-tools.ts**

Change the page resolution flow from:
```
page_id → SessionManager.resolvePage(page_id)
```
To:
```
session_id? → SessionRegistry.getSession(session_id) or getDefaultSession()
  → session's SessionManager → resolvePage(page_id)
```

**Step 5: Run full checks**

Run: `npm run type-check && npm run lint && npm test`
Expected: PASS

**Step 6: Commit**

```
feat: add session_id to tool schemas and session-scoped page routing
```

---

## Task 5: Per-Session BrowserContext Isolation

**Files:**
- Modify: `src/browser/session-manager.ts`
- Modify: `src/session/session-registry.ts`
- Test: `tests/unit/browser/session-context-isolation.test.ts`

Each session gets its own `BrowserContext` so cookies, storage, and cache are isolated between agents.

**Step 1: Write the failing test**

```typescript
// tests/unit/browser/session-context-isolation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLinkedMocks } from '../../mocks/puppeteer.mock.js';

describe('Per-session BrowserContext isolation', () => {
  it('should create a new BrowserContext for each session', () => {
    const { browser } = createLinkedMocks();
    // Mock browser.createBrowserContext to return new contexts
    const ctx1 = { newPage: vi.fn(), close: vi.fn(), pages: vi.fn().mockResolvedValue([]) };
    const ctx2 = { newPage: vi.fn(), close: vi.fn(), pages: vi.fn().mockResolvedValue([]) };
    browser.createBrowserContext = vi.fn()
      .mockResolvedValueOnce(ctx1)
      .mockResolvedValueOnce(ctx2);

    // Verify different contexts created
    expect(ctx1).not.toBe(ctx2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/browser/session-context-isolation.test.ts`
Expected: Behavior to define once we know exact API

**Step 3: Implement context-per-session**

In `SessionManager`, add method:
```typescript
async createIsolatedContext(): Promise<BrowserContext> {
  if (!this.browser) throw BrowserSessionError.notRunning();
  return await this.browser.createBrowserContext();
}
```

In `SessionRegistry.createSession()`, after creating the entry, create an isolated BrowserContext from the shared browser. Store the context reference in `SessionEntry`.

**Step 4: Update cleanup**

When a session is removed, close its BrowserContext (which closes all its pages).

**Step 5: Run full checks**

Run: `npm run type-check && npm run lint && npm test`
Expected: PASS

**Step 6: Commit**

```
feat: per-session BrowserContext isolation for cookie/storage separation
```

---

## Task 6: Detach-on-Close Instead of Kill

**Files:**
- Modify: `src/browser/session-manager.ts`
- Modify: `src/index.ts`
- Test: `tests/unit/browser/session-manager-detach.test.ts`

Change shutdown behavior so the browser process survives MCP server exit.

**Step 1: Write the failing test**

```typescript
// tests/unit/browser/session-manager-detach.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLinkedMocks } from '../../mocks/puppeteer.mock.js';

describe('SessionManager detach behavior', () => {
  it('should call browser.disconnect() instead of browser.close() on detach', async () => {
    const { browser } = createLinkedMocks();
    // After detach, browser should be disconnected but not closed
    // browser.close should NOT have been called
    // browser.disconnect SHOULD have been called
    expect(browser.disconnect).toBeDefined();
  });
});
```

**Step 2: Run test, then implement**

Add `detach()` method to `SessionManager`:
```typescript
async detach(): Promise<void> {
  // Close CDP sessions but don't close browser
  // Call browser.disconnect() not browser.close()
  // Save connection info for future reconnect
}
```

**Step 3: Update index.ts shutdown handler**

Replace `session.shutdown()` with `session.detach()` so browser survives.

**Step 4: Run full checks**

Run: `npm run type-check && npm run lint && npm test`
Expected: PASS

**Step 5: Commit**

```
feat: add detach() to SessionManager — browser survives MCP server exit
```

---

## Task 7: Port Reusable Worker Components from Stale Branch

**Files:**
- Create: `src/worker/types.ts` (from stale branch)
- Create: `src/worker/errors/worker.error.ts` (from stale branch)
- Create: `src/worker/errors/index.ts` (from stale branch)
- Create: `src/worker/lease-manager.ts` (from stale branch)
- Create: `src/worker/health-monitor.ts` (from stale branch)
- Create: `src/worker/port-allocator.ts` (from stale branch)
- Tests: port corresponding test files from stale branch

These components are self-contained and reusable as-is.

**Step 1: Cherry-pick files from stale branch**

```bash
git checkout origin/backup/multi-tenant-worker-manager -- \
  src/worker/types.ts \
  src/worker/errors/worker.error.ts \
  src/worker/errors/index.ts \
  src/worker/lease-manager.ts \
  src/worker/health-monitor.ts \
  src/worker/port-allocator.ts \
  tests/unit/worker/lease-manager.test.ts \
  tests/unit/worker/health-monitor.test.ts \
  tests/unit/worker/port-allocator.test.ts
```

**Step 2: Fix imports for current codebase**

Update any import paths that have changed since the stale branch (e.g. logging service path).

**Step 3: Run ported tests**

Run: `npx vitest run tests/unit/worker/`
Expected: PASS (all ported tests green)

**Step 4: Run full checks**

Run: `npm run type-check && npm run lint && npm test`
Expected: PASS

**Step 5: Commit**

```
feat: port LeaseManager, HealthMonitor, PortAllocator from stale multi-tenant branch
```

---

## Task 8: WorkerManager for Process-Level Isolation

**Files:**
- Create: `src/worker/chrome-worker-process.ts` (adapted from stale branch)
- Create: `src/worker/worker-manager.ts` (adapted from stale branch)
- Create: `src/worker/index.ts`
- Tests: port and adapt from stale branch

The WorkerManager spawns independent Chrome processes per session. Each Chrome process has its own user data directory and CDP port. The MCP server connects to these via `SessionManager.connect()`.

**Step 1: Port and adapt ChromeWorkerProcess**

Cherry-pick from stale branch, then verify it works with Puppeteer (the stale branch already uses direct Chrome spawning, not Playwright).

**Step 2: Port and adapt WorkerManager**

Key change: replace `tenantId` concept with `sessionId` from SessionRegistry.

**Step 3: Run tests**

Run: `npx vitest run tests/unit/worker/`
Expected: PASS

**Step 4: Run full checks**

Run: `npm run type-check && npm run lint && npm test`
Expected: PASS

**Step 5: Commit**

```
feat: add WorkerManager for process-level Chrome isolation per session
```

---

## Task 9: Integration — Connect SessionRegistry to WorkerManager

**Files:**
- Modify: `src/index.ts`
- Modify: `src/session/session-registry.ts`
- Create: `src/session/session-worker-binding.ts`
- Test: `tests/unit/session/session-worker-binding.test.ts`

When `ISOLATION_MODE=process` (env var), session creation spawns a Chrome worker via WorkerManager. When `ISOLATION_MODE=context` (default), session creation uses BrowserContext isolation from Task 5.

**Step 1: Write the failing test**

```typescript
// tests/unit/session/session-worker-binding.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('SessionWorkerBinding', () => {
  it('should acquire a worker on session create when isolation=process', async () => {
    // Mock WorkerManager.acquireForTenant
    // Verify CDP endpoint is returned
  });

  it('should create BrowserContext on session create when isolation=context', async () => {
    // Verify context created from shared browser
  });

  it('should release worker on session remove when isolation=process', async () => {
    // Verify worker released
  });
});
```

**Step 2: Implement SessionWorkerBinding**

Thin adapter that routes session lifecycle to either WorkerManager or BrowserContext based on config.

**Step 3: Wire into index.ts**

In the `session:start` handler:
- Read `ISOLATION_MODE` from env/config
- Create session via SessionRegistry
- If process mode: acquire worker, connect SessionManager to its CDP endpoint
- If context mode: create BrowserContext from shared browser

**Step 4: Run full checks**

Run: `npm run type-check && npm run lint && npm test`
Expected: PASS

**Step 5: Commit**

```
feat: SessionWorkerBinding — route session lifecycle to context or process isolation
```

---

## Task 10: Add `list_sessions` Tool

**Files:**
- Modify: `src/tools/browser-tools.ts`
- Modify: `src/index.ts`
- Test: `tests/unit/tools/list-sessions.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/tools/list-sessions.test.ts
import { describe, it, expect } from 'vitest';
import { SessionRegistry } from '../../../src/session/session-registry.js';

describe('list_sessions tool', () => {
  it('should return all active sessions with metadata', () => {
    const registry = new SessionRegistry();
    registry.createSession({ name: 'claude-code', version: '1.0' });
    registry.createSession({ name: 'cursor', version: '2.0' });

    const sessions = registry.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].clientInfo?.name).toBe('claude-code');
    expect(sessions[1].clientInfo?.name).toBe('cursor');
  });
});
```

**Step 2: Implement list_sessions tool handler and register in index.ts**

**Step 3: Run full checks**

Run: `npm run type-check && npm run lint && npm test`
Expected: PASS

**Step 4: Commit**

```
feat: add list_sessions tool for session visibility
```

---

## Task 11: Final Integration Test & Cleanup

**Files:**
- Modify: `PLAN.md` → delete (no longer needed)
- Run: full test suite

**Step 1: Run all checks**

Run: `npm run check`
Expected: PASS (type-check + lint + format:check + test)

**Step 2: Review for dead code**

Remove any unused code from `session-store.ts` if it was superseded by `SessionRegistry`.

**Step 3: Commit**

```
chore: cleanup — remove old PLAN.md, remove dead session-store code
```

---

## Implementation Order Summary

| Task | What | Depends On |
|------|------|-----------|
| 1 | MCP lifecycle hooks | — |
| 2 | SessionRegistry | — |
| 3 | Wire registry to lifecycle | 1, 2 |
| 4 | Session-scoped tool routing | 2, 3 |
| 5 | Per-session BrowserContext | 2, 3 |
| 6 | Detach-on-close | 1 |
| 7 | Port worker components | — |
| 8 | WorkerManager (process isolation) | 7 |
| 9 | Integration binding | 5, 8 |
| 10 | list_sessions tool | 2 |
| 11 | Final cleanup | all |

Tasks 1, 2, 6, 7 can be parallelized. Tasks 3-5 are sequential. Tasks 8-9 are for process isolation mode only.
