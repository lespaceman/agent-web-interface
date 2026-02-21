# Multi-Tenancy Implementation Plan

## Current State

### Existing Architecture (Single-Tenant)
- **Single SessionManager singleton** — one browser instance per MCP server process
- **Single shared BrowserContext** — all pages share cookies/storage/cache
- **Global tool state** — module-level `sessionManager` and `stateManagers` map
- **No client identification** — MCP protocol doesn't identify which agent made a request
- **No session persistence** — when CDP connection drops (browser restart, timeout, network), all state is lost

### Existing Multi-Tenancy Code (Stale Branch)
Branch `origin/backup/multi-tenant-worker-manager` has ~5,400 lines of prior work:
- `src/worker/worker-manager.ts` — orchestrator for tenant-bound Chrome workers
- `src/worker/chrome-worker-process.ts` — spawns Chrome child processes with per-tenant profile dirs
- `src/worker/lease-manager.ts` — exclusive lease-based access per tenant (TTL, refresh, revoke)
- `src/worker/health-monitor.ts` — periodic CDP health checks per worker
- `src/worker/port-allocator.ts` — allocates unique CDP ports from a range
- `src/worker/multi-tenant-config.ts` — env-var based config (`MULTI_TENANT_MODE`, `TENANT_ID`, etc.)
- `src/worker/types.ts` — full type definitions
- Integration in `browser-tools.ts` — `launchBrowser`/`connectBrowser`/`closeSession` route through WorkerManager when multi-tenant mode is on
- Full test suite (6 test files)

Also unused but present on `main`:
- `src/server/session-store.ts` — TTL-based session tracking with tenant isolation (not wired up)

### The "Session Goes Stale" Problem
The agent loses access after a period because:
1. The MCP server runs as a child process of the agent — when the agent disconnects, the process dies, killing the browser
2. CDP sessions can become stale if the browser tab navigates or the page is garbage-collected
3. There's no reconnect/resume mechanism — a new agent invocation starts fresh

## Implementation Plan

### Phase 1: Session Lifecycle & Persistence (Fixes the "stale session" problem)

**Goal**: Allow agents to create named sessions that survive agent disconnects, and reconnect to them later.

#### 1a. Wire up SessionStore to SessionManager
- Integrate the existing `SessionStore` into the server lifecycle
- Each `launch_browser` / `connect_browser` call creates a named session (agent provides `session_id` or one is auto-generated)
- `session_id` is returned to the agent and must be passed on subsequent tool calls
- Sessions track: browser connection info, page IDs, creation time, last-accessed time

#### 1b. Add `create_session` and `resume_session` tools
- `create_session({ session_id?, profile_name?, headless? })` → launches/connects a browser, returns `session_id`
- `resume_session({ session_id })` → reconnects to an existing session's browser (validates it's still alive)
- `list_sessions()` → returns active sessions with their state
- All existing tools gain an optional `session_id` parameter to target a specific session

#### 1c. Session TTL with heartbeat
- Sessions have a configurable TTL (default 30min, configurable via env)
- Each tool call touching a session refreshes its TTL
- Expired sessions trigger browser shutdown + cleanup
- Optional: agent can call `keep_alive({ session_id })` to extend without doing work

### Phase 2: Multi-Tenant Isolation (Multiple agents in parallel)

**Goal**: Multiple agents use the same MCP server, each with isolated browser contexts.

#### 2a. Per-Session Browser Context Isolation
- Upgrade from single `SessionManager` to a session-scoped model
- Each session gets its own `BrowserContext` (separate cookies, storage, cache)
- Option A: Multiple contexts within one browser (lightweight, shared process)
- Option B: Separate Chrome processes per tenant (full isolation, from stale branch)
- **Recommendation**: Start with Option A (multiple BrowserContexts), add Option B as opt-in for full isolation

#### 2b. Session-Scoped State Management
- `StateManager` instances keyed by `(session_id, page_id)` instead of just `page_id`
- `ElementRegistry` scoped per session
- `SnapshotStore` scoped per session
- `ObservationAccumulator` scoped per session

#### 2c. Tool Routing
- Every tool call includes `session_id` (required when >1 session exists, optional otherwise for backwards compat)
- Tool handlers resolve `session_id` → SessionManager → BrowserContext → Page
- Default behavior when no `session_id`: use the single active session (error if multiple)

### Phase 3: Worker Manager Integration (Optional, for full process isolation)

**Goal**: Use the existing worker manager code for scenarios needing OS-level isolation.

#### 3a. Port the stale branch code
- Cherry-pick `src/worker/*` from `backup/multi-tenant-worker-manager`
- Update imports for current codebase (Puppeteer instead of Playwright, current API surface)
- Wire WorkerManager as an alternative backend to Phase 2's context-based isolation

#### 3b. Configuration
- `ISOLATION_MODE=context` (default) — BrowserContext-based isolation
- `ISOLATION_MODE=process` — Separate Chrome processes via WorkerManager
- Per-tenant profile directories for persistent state across process restarts

### Phase 4: Profile Persistence (Same/different browser profiles)

**Goal**: Agents can share or have dedicated browser profiles.

#### 4a. Named profiles
- `create_session({ profile: "work-account" })` — reuses a persistent Chrome profile
- Multiple agents can share a profile (sequential access via lease) or each get their own
- Profiles stored at `~/.cache/agent-web-interface/profiles/<name>/`

#### 4b. Storage state save/restore
- On session close, save cookies + localStorage to disk
- On session resume, restore from disk
- Allows surviving browser process restarts

## File Changes Summary

### New Files
- `src/session/session-registry.ts` — Maps session_id → {SessionManager, BrowserContext, StateManagers}
- `src/tools/tool-schemas.ts` — Add `session_id` to all tool input schemas

### Modified Files
- `src/server/session-store.ts` — Wire into server lifecycle
- `src/tools/browser-tools.ts` — Add session routing, new session management tools
- `src/index.ts` — Initialize session registry, register new tools
- `src/tools/execute-action.ts` — Session-scoped state manager lookup
- `src/browser/session-manager.ts` — Support multiple instances, reconnect logic

### Ported from Stale Branch (Phase 3)
- `src/worker/worker-manager.ts`
- `src/worker/chrome-worker-process.ts`
- `src/worker/lease-manager.ts`
- `src/worker/health-monitor.ts`
- `src/worker/port-allocator.ts`
- `src/worker/multi-tenant-config.ts`
- `src/worker/types.ts`
- `src/worker/errors/`

## Implementation Order
1. Phase 1 (session lifecycle) — addresses the immediate "stale session" pain
2. Phase 2a-2c (multi-context isolation) — enables parallel agents
3. Phase 4 (profile persistence) — enables profile sharing/reuse
4. Phase 3 (worker manager) — opt-in full process isolation
