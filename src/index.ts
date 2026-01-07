#!/usr/bin/env node

/**
 * Browser Automation MCP Server
 *
 * Main entry point - initializes the MCP server with Playwright-based browser automation.
 * CEFBridge is deprecated - use SessionManager instead.
 */

import { BrowserAutomationServer } from './server/mcp-server.js';
import { SessionManager } from './browser/session-manager.js';
import {
  initializeTools,
  browserLaunch,
  browserNavigate,
  browserClose,
  snapshotCapture,
  actionClick,
  BrowserLaunchInputSchema,
  BrowserLaunchOutputSchema,
  BrowserNavigateInputSchema,
  BrowserNavigateOutputSchema,
  BrowserCloseInputSchema,
  BrowserCloseOutputSchema,
  SnapshotCaptureInputSchema,
  SnapshotCaptureOutputSchema,
  ActionClickInputSchema,
  ActionClickOutputSchema,
} from './tools/index.js';

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

  // Initialize session manager and tools
  const session = getSessionManager();
  initializeTools(session);

  // Register browser_launch tool
  server.registerTool(
    'browser_launch',
    {
      title: 'Launch or Connect Browser',
      description:
        'Launch a new browser or connect to an existing one (e.g., Athena browser). ' +
        'Returns a page_id that can be used with other tools.',
      inputSchema: BrowserLaunchInputSchema.shape,
      outputSchema: BrowserLaunchOutputSchema.shape,
    },
    browserLaunch
  );

  // Register browser_navigate tool
  server.registerTool(
    'browser_navigate',
    {
      title: 'Navigate to URL',
      description: 'Navigate a page to the specified URL. Wait for page load to complete.',
      inputSchema: BrowserNavigateInputSchema.shape,
      outputSchema: BrowserNavigateOutputSchema.shape,
    },
    browserNavigate
  );

  // Register browser_close tool
  server.registerTool(
    'browser_close',
    {
      title: 'Close Browser',
      description:
        'Close a specific page or the entire browser session. ' +
        'If page_id is omitted, closes the entire session.',
      inputSchema: BrowserCloseInputSchema.shape,
      outputSchema: BrowserCloseOutputSchema.shape,
    },
    browserClose
  );

  // Register snapshot_capture tool
  server.registerTool(
    'snapshot_capture',
    {
      title: 'Capture Page Snapshot',
      description:
        'Extract interactive elements from the page using CDP accessibility tree. ' +
        'Returns a list of clickable elements with their node_ids for use with action tools.',
      inputSchema: SnapshotCaptureInputSchema.shape,
      outputSchema: SnapshotCaptureOutputSchema.shape,
    },
    snapshotCapture
  );

  // Register action_click tool
  server.registerTool(
    'action_click',
    {
      title: 'Click Element',
      description:
        'Click an element by its node_id from a previous snapshot_capture. ' +
        'Uses Playwright for reliable clicking with built-in waits.',
      inputSchema: ActionClickInputSchema.shape,
      outputSchema: ActionClickOutputSchema.shape,
    },
    actionClick
  );

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
