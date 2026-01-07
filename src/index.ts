#!/usr/bin/env node

/**
 * Browser Automation MCP Server
 *
 * Main entry point - initializes the MCP server with Playwright-based browser automation.
 * CEFBridge is deprecated - use SessionManager instead.
 */

import { BrowserAutomationServer } from './server/mcp-server.js';
import { SessionManager } from './browser/session-manager.js';

// Singleton session manager (initialized lazily on first tool use)
let sessionManager: SessionManager | null = null;

/**
 * Get or create the session manager
 */
export function getSessionManager(): SessionManager {
  sessionManager ??= new SessionManager();
  return sessionManager;
}

/**
 * Initialize all services and start the server
 */
function initializeServer(): BrowserAutomationServer {
  // Create MCP server shell
  // Note: Don't pass tools/logging capabilities - McpServer registers them automatically
  // when tools are registered via .tool() or .registerTool()
  const server = new BrowserAutomationServer({
    name: 'athena-browser-mcp',
    version: '2.0.0',
  });

  // TODO: Register new semantic snapshot tools here
  // - browser_open_page (uses SessionManager)
  // - browser_close_page
  // - snapshot_capture (BaseSnapshot extraction)
  // - page_brief (Page Brief generation)
  // - find_elements (Structured query engine)

  return server;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const server = initializeServer();
    await server.start();

    // Handle shutdown gracefully
    const shutdown = (signal: NodeJS.Signals) => {
      console.error(`Shutting down... (${signal})`);
      void (async () => {
        try {
          // Shutdown browser session first (if initialized)
          if (sessionManager) {
            await sessionManager.shutdown();
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
