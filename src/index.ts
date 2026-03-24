#!/usr/bin/env node

/**
 * Browser Automation MCP Server
 *
 * Main entry point - initializes the MCP server with Puppeteer-based browser automation.
 */

import { BrowserAutomationServer, type SessionStartEvent } from './server/mcp-server.js';
import {
  initServerConfig,
  getSessionManager,
  ensureBrowserForTools,
  isSessionManagerInitialized,
} from './server/server-config.js';
import { SessionStore } from './server/session-store.js';
import { SessionWorkerBinding, type IsolationMode } from './session/session-worker-binding.js';
import { getLogger } from './shared/services/logging.service.js';
import { cleanupTempFiles } from './lib/temp-file.js';
import { VERSION } from './shared/version.js';
import { SessionRouter } from './gateway/session-router.js';
import { registerAllTools } from './tools/tool-registration.js';

const logger = getLogger();

/** Module-level session store for tenant isolation */
const sessionStore = new SessionStore();

/** Isolation mode from environment (default: 'context') */
const isolationMode: IsolationMode =
  (process.env.ISOLATION_MODE as IsolationMode) === 'process' ? 'process' : 'context';

/** Session-to-worker binding adapter */
const sessionBinding = new SessionWorkerBinding(isolationMode);

/**
 * Get the SessionStore instance for use in tool handlers.
 */
export function getSessionStore(): SessionStore {
  return sessionStore;
}

/**
 * Get the SessionWorkerBinding instance.
 */
export function getSessionBinding(): SessionWorkerBinding {
  return sessionBinding;
}

/**
 * Initialize all services and start the server
 */
function initializeServer(): BrowserAutomationServer {
  // Parse CLI arguments and initialize server configuration
  initServerConfig(process.argv.slice(2));

  // Create MCP server shell
  // Note: Don't pass tools/logging capabilities - McpServer registers them automatically
  // when tools are registered via .tool() or .registerTool()
  const server = new BrowserAutomationServer({
    name: 'agent-web-interface',
    version: VERSION,
  });

  // Wire SessionStore to MCP lifecycle events
  server.on('session:start', (event: SessionStartEvent) => {
    const { clientInfo } = event;
    const sessionId = sessionStore.createSession(clientInfo?.name ?? 'unknown', clientInfo);
    const session = sessionStore.getSession(sessionId)!;

    // Route session start through the isolation binding.
    // Browser init is lazy (first tool call), so context creation may fail here
    // if the browser isn't launched yet. That's OK — the tool's ensureBrowser
    // callback will ensure the browser is ready before any real work happens.
    sessionBinding
      .onSessionStart(sessionId, getSessionManager())
      .then((result) => {
        if (result.browserContext) {
          session.browser_context = result.browserContext;
        }
      })
      .catch((err) => {
        logger.error(
          'Failed to initialize session isolation',
          err instanceof Error ? err : undefined,
          { sessionId, isolationMode }
        );
      });
  });
  server.on('session:end', () => {
    const session = sessionStore.getDefaultSession();
    if (session) {
      sessionBinding.onSessionEnd(session.session_id);
      void sessionStore.destroySession(session.session_id);
    }
  });

  // Initialize session manager and session router (stdio mode — no browser pool)
  const session = getSessionManager();
  const router = new SessionRouter(session);

  // Register all 22 browser automation tools
  registerAllTools(server, () => router.resolve(), ensureBrowserForTools);

  return server;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    // Check for HTTP transport mode before initializing the stdio server.
    // We parse early to detect the transport flag, then delegate to http-entry.
    const transportIdx = process.argv.indexOf('--transport');
    const transportArg = transportIdx !== -1 ? process.argv[transportIdx + 1] : undefined;
    const isHttp = transportArg === 'http' || process.env.TRANSPORT === 'http';

    if (isHttp) {
      // Initialize config first so http-entry can read it
      initServerConfig(process.argv.slice(2));
      const { main: httpMain } = await import('./http-entry.js');
      return await httpMain();
    }

    const server = initializeServer();
    await server.start();

    // Handle shutdown gracefully
    const shutdown = (signal: NodeJS.Signals) => {
      console.error(`Shutting down... (${signal})`);
      void (async () => {
        try {
          await cleanupTempFiles();
          // Shutdown browser session (only if initialized)
          if (isSessionManagerInitialized()) {
            const session = getSessionManager();
            await session.shutdown();
          }
          await server.stop();
          process.exit(0);
        } catch (shutdownError) {
          console.error('Error during shutdown:', shutdownError);
          process.exit(1);
        }
      })();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start server
void main();
