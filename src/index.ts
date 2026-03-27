#!/usr/bin/env node

/**
 * Browser Automation MCP Server
 *
 * Main entry point - initializes the MCP server with Puppeteer-based browser automation.
 */

import { BrowserAutomationServer } from './server/mcp-server.js';
import { initServerConfig } from './server/server-config.js';
import { cleanupTempFiles } from './lib/temp-file.js';
import { VERSION } from './shared/version.js';
import { SessionRouter } from './gateway/session-router.js';
import { registerAllTools } from './tools/tool-registration.js';

/**
 * Initialize all services and start the server
 */
function initializeServer(): { server: BrowserAutomationServer; router: SessionRouter } {
  // Parse CLI arguments and initialize server configuration
  initServerConfig(process.argv.slice(2));

  // Create MCP server shell
  const server = new BrowserAutomationServer({
    name: 'agent-web-interface',
    version: VERSION,
  });

  // Create session router (stdio mode — implicit single session)
  const router = new SessionRouter();

  // Register all browser automation tools
  // Browser init is session-scoped: each SessionController owns its own
  // SessionManager and lazily launches/connects via ctx.ensureBrowser().
  registerAllTools(server, () => router.resolve());

  return { server, router };
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

    const { server, router } = initializeServer();
    await server.start();

    // Handle shutdown gracefully
    const shutdown = (signal: NodeJS.Signals) => {
      console.error(`Shutting down... (${signal})`);
      void (async () => {
        try {
          await cleanupTempFiles();
          await router.shutdown();
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
