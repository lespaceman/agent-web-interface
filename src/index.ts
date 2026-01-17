#!/usr/bin/env node

/**
 * Browser Automation MCP Server
 *
 * Main entry point - initializes the MCP server with Playwright-based browser automation.
 */

import { BrowserAutomationServer } from './server/mcp-server.js';
import { SessionManager } from './browser/session-manager.js';
import {
  initializeTools,
  initializeFormTools,
  // Tool handlers
  launchBrowser,
  connectBrowser,
  closePage,
  closeSession,
  navigate,
  goBack,
  goForward,
  reload,
  captureSnapshot,
  findElements,
  getNodeDetails,
  scrollElementIntoView,
  scrollPage,
  click,
  type,
  press,
  select,
  hover,
  getFormUnderstanding,
  getFieldContext,
  // Input schemas only (all outputs are XML strings now)
  LaunchBrowserInputSchema,
  ConnectBrowserInputSchema,
  ClosePageInputSchema,
  CloseSessionInputSchema,
  NavigateInputSchema,
  GoBackInputSchema,
  GoForwardInputSchema,
  ReloadInputSchema,
  CaptureSnapshotInputSchema,
  FindElementsInputSchema,
  GetNodeDetailsInputSchema,
  ScrollElementIntoViewInputSchemaBase,
  ScrollPageInputSchema,
  ClickInputSchemaBase,
  TypeInputSchemaBase,
  PressInputSchema,
  SelectInputSchemaBase,
  HoverInputSchemaBase,
  GetFormUnderstandingInputSchema,
  GetFieldContextInputSchema,
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
  initializeFormTools(session);

  // ============================================================================
  // SESSION TOOLS
  // ============================================================================

  server.registerTool(
    'launch_browser',
    {
      title: 'Launch Browser',
      description: 'Launch a new browser instance and return the initial page snapshot.',
      inputSchema: LaunchBrowserInputSchema.shape,
    },
    launchBrowser
  );

  server.registerTool(
    'connect_browser',
    {
      title: 'Connect Browser',
      description:
        'Connect to an existing browser instance via CDP. Defaults to the Athena CEF bridge endpoint.',
      inputSchema: ConnectBrowserInputSchema.shape,
    },
    connectBrowser
  );

  server.registerTool(
    'close_page',
    {
      title: 'Close Page',
      description: 'Close a specific page by page_id.',
      inputSchema: ClosePageInputSchema.shape,
    },
    closePage
  );

  server.registerTool(
    'close_session',
    {
      title: 'Close Session',
      description: 'Close the entire browser session.',
      inputSchema: CloseSessionInputSchema.shape,
    },
    closeSession
  );

  // ============================================================================
  // NAVIGATION TOOLS
  // ============================================================================

  server.registerTool(
    'navigate',
    {
      title: 'Navigate',
      description: 'Navigate directly to a URL and return the new snapshot.',
      inputSchema: NavigateInputSchema.shape,
    },
    navigate
  );

  server.registerTool(
    'go_back',
    {
      title: 'Go Back',
      description: 'Navigate back in browser history.',
      inputSchema: GoBackInputSchema.shape,
    },
    goBack
  );

  server.registerTool(
    'go_forward',
    {
      title: 'Go Forward',
      description: 'Navigate forward in browser history.',
      inputSchema: GoForwardInputSchema.shape,
    },
    goForward
  );

  server.registerTool(
    'reload',
    {
      title: 'Reload',
      description: 'Reload the current page and return the refreshed snapshot.',
      inputSchema: ReloadInputSchema.shape,
    },
    reload
  );

  server.registerTool(
    'capture_snapshot',
    {
      title: 'Capture Snapshot',
      description: 'Capture a fresh snapshot of the current page.',
      inputSchema: CaptureSnapshotInputSchema.shape,
    },
    captureSnapshot
  );

  // ============================================================================
  // OBSERVATION TOOLS
  // ============================================================================

  server.registerTool(
    'find_elements',
    {
      title: 'Find Elements',
      description: 'Find elements by kind, label, or region in the current snapshot.',
      inputSchema: FindElementsInputSchema.shape,
    },
    (input) => Promise.resolve(findElements(input))
  );

  server.registerTool(
    'get_node_details',
    {
      title: 'Get Node Details',
      description: 'Return full details for a single eid.',
      inputSchema: GetNodeDetailsInputSchema.shape,
    },
    (input) => Promise.resolve(getNodeDetails(input))
  );

  // ============================================================================
  // INTERACTION TOOLS
  // ============================================================================

  server.registerTool(
    'scroll_element_into_view',
    {
      title: 'Scroll Element Into View',
      description: 'Scroll a specific element into view.',
      inputSchema: ScrollElementIntoViewInputSchemaBase.shape,
    },
    scrollElementIntoView
  );

  server.registerTool(
    'scroll_page',
    {
      title: 'Scroll Page',
      description: 'Scroll the page up or down by a specified amount.',
      inputSchema: ScrollPageInputSchema.shape,
    },
    scrollPage
  );

  server.registerTool(
    'click',
    {
      title: 'Click Element',
      description: 'Click an element by eid.',
      inputSchema: ClickInputSchemaBase.shape,
    },
    click
  );

  server.registerTool(
    'type',
    {
      title: 'Type Text',
      description: 'Type text into a specific element (by eid) with optional clearing.',
      inputSchema: TypeInputSchemaBase.shape,
    },
    type
  );

  server.registerTool(
    'press',
    {
      title: 'Press Key',
      description: 'Press a keyboard key with optional modifiers.',
      inputSchema: PressInputSchema.shape,
    },
    press
  );

  server.registerTool(
    'select',
    {
      title: 'Select Option',
      description: 'Select an option from a <select> element (by eid) by value or text.',
      inputSchema: SelectInputSchemaBase.shape,
    },
    select
  );

  server.registerTool(
    'hover',
    {
      title: 'Hover Element',
      description: 'Hover over an element by eid.',
      inputSchema: HoverInputSchemaBase.shape,
    },
    hover
  );

  // ============================================================================
  // FORM UNDERSTANDING TOOLS
  // ============================================================================

  server.registerTool(
    'get_form_understanding',
    {
      title: 'Get Form Understanding',
      description:
        'Analyze forms on the page and return semantic understanding of form regions, fields, dependencies, and state. Use this to understand complex form interactions.',
      inputSchema: GetFormUnderstandingInputSchema.shape,
    },
    (input) => Promise.resolve(getFormUnderstanding(input))
  );

  server.registerTool(
    'get_field_context',
    {
      title: 'Get Field Context',
      description:
        'Get detailed context for a specific form field including purpose inference, constraints, dependencies, and suggested next action.',
      inputSchema: GetFieldContextInputSchema.shape,
    },
    (input) => Promise.resolve(getFieldContext(input))
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
