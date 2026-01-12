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
  // Legacy simplified tool handlers (V1)
  open,
  close,
  goto,
  snapshot,
  find,
  click,
  type,
  press,
  select,
  hover,
  scroll,
  // V2 simplified tool handlers
  launchBrowser,
  connectBrowser,
  closePage,
  closeSession,
  navigate,
  goBack,
  goForward,
  reload,
  findElementsV2,
  getNodeDetailsV2,
  scrollElementIntoView,
  scrollPageV2,
  clickV2,
  typeV2,
  pressV2,
  selectV2,
  hoverV2,
  // Legacy schemas (V1)
  OpenInputSchema,
  OpenOutputSchema,
  CloseInputSchema,
  CloseOutputSchema,
  GotoInputSchemaBase,
  GotoOutputSchema,
  SnapshotInputSchema,
  SnapshotOutputSchema,
  FindInputSchema,
  FindOutputSchema,
  ClickInputSchema,
  ClickOutputSchema,
  TypeInputSchema,
  TypeOutputSchema,
  PressInputSchema,
  PressOutputSchema,
  SelectInputSchema,
  SelectOutputSchema,
  HoverInputSchema,
  HoverOutputSchema,
  ScrollInputSchemaBase,
  ScrollOutputSchema,
  // V2 simplified schemas
  LaunchBrowserInputSchema,
  LaunchBrowserOutputSchema,
  ConnectBrowserInputSchema,
  ConnectBrowserOutputSchema,
  ClosePageInputSchema,
  ClosePageOutputSchema,
  CloseSessionInputSchema,
  CloseSessionOutputSchema,
  NavigateInputSchema,
  NavigateOutputSchema,
  GoBackInputSchema,
  GoBackOutputSchema,
  GoForwardInputSchema,
  GoForwardOutputSchema,
  ReloadInputSchema,
  ReloadOutputSchema,
  FindElementsV2InputSchema,
  FindElementsV2OutputSchema,
  GetNodeDetailsV2InputSchema,
  GetNodeDetailsV2OutputSchema,
  ScrollElementIntoViewInputSchema,
  ScrollElementIntoViewOutputSchema,
  ScrollPageInputSchema,
  ScrollPageOutputSchema,
  ClickV2InputSchema,
  ClickV2OutputSchema,
  TypeV2InputSchema,
  TypeV2OutputSchema,
  PressV2InputSchema,
  PressV2OutputSchema,
  SelectV2InputSchema,
  SelectV2OutputSchema,
  HoverV2InputSchema,
  HoverV2OutputSchema,
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

  // ============================================================================
  // SESSION TOOLS
  // ============================================================================

  server.registerTool(
    'open',
    {
      title: 'Open Browser',
      description:
        'Launch a new browser or connect to an existing one (e.g., Athena browser). ' +
        'Returns page state with page_brief (compact XML) by default. ' +
        'Use include_factpack: true for FactPack JSON with dialogs, forms, actions. ' +
        'Use include_nodes: true for raw node list.',
      inputSchema: OpenInputSchema.shape,
      outputSchema: OpenOutputSchema.shape,
    },
    open
  );

  server.registerTool(
    'close',
    {
      title: 'Close Browser',
      description:
        'Close a specific page or the entire browser session. ' +
        'If page_id is omitted, closes the entire session.',
      inputSchema: CloseInputSchema.shape,
      outputSchema: CloseOutputSchema.shape,
    },
    close
  );

  // ============================================================================
  // NAVIGATION TOOLS
  // ============================================================================

  server.registerTool(
    'goto',
    {
      title: 'Navigate',
      description:
        'Navigate a page: go to URL, back, forward, or refresh. ' +
        'For URL navigation, provide { url: "https://..." }. ' +
        'For history navigation, use { back: true } or { forward: true }. ' +
        'For refresh, use { refresh: true }. ' +
        'Returns page state after navigation.',
      inputSchema: GotoInputSchemaBase.shape,
      outputSchema: GotoOutputSchema.shape,
    },
    goto
  );

  // ============================================================================
  // OBSERVATION TOOLS
  // ============================================================================

  server.registerTool(
    'snapshot',
    {
      title: 'Capture Snapshot',
      description:
        'Capture a fresh snapshot of the page using CDP accessibility tree. ' +
        'Returns page_brief (compact XML) by default. ' +
        'Use include_factpack: true for FactPack JSON. ' +
        'Use include_nodes: true for raw node list.',
      inputSchema: SnapshotInputSchema.shape,
      outputSchema: SnapshotOutputSchema.shape,
    },
    snapshot
  );

  server.registerTool(
    'find',
    {
      title: 'Find Elements',
      description:
        'Find elements in the current snapshot by semantic filters, OR get details for a specific node. ' +
        'Query mode: filter by kind (button, link, input), label, region (header, footer, nav, main). ' +
        'Detail mode: pass node_id to get full info including layout, state, and attributes.',
      inputSchema: FindInputSchema.shape,
      outputSchema: FindOutputSchema.shape,
    },
    (input) => Promise.resolve(find(input))
  );

  // ============================================================================
  // INTERACTION TOOLS
  // ============================================================================

  server.registerTool(
    'click',
    {
      title: 'Click Element',
      description:
        'Click an element by its node_id from a previous snapshot. ' +
        'Uses CDP for reliable clicking with scrolling into view.',
      inputSchema: ClickInputSchema.shape,
      outputSchema: ClickOutputSchema.shape,
    },
    click
  );

  server.registerTool(
    'type',
    {
      title: 'Type Text',
      description:
        'Type text into an element. ' +
        'If node_id is provided, clicks the element first to focus it. ' +
        'Use clear: true to clear existing text before typing.',
      inputSchema: TypeInputSchema.shape,
      outputSchema: TypeOutputSchema.shape,
    },
    type
  );

  server.registerTool(
    'press',
    {
      title: 'Press Key',
      description:
        'Press a keyboard key. ' +
        'Supports: Enter, Tab, Escape, Backspace, Delete, Space, ' +
        'ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown. ' +
        'Optional modifiers: Control, Shift, Alt, Meta.',
      inputSchema: PressInputSchema.shape,
      outputSchema: PressOutputSchema.shape,
    },
    press
  );

  server.registerTool(
    'select',
    {
      title: 'Select Option',
      description:
        'Select an option from a <select> dropdown element. ' +
        'Provide the node_id of the select element and the value or visible text of the option.',
      inputSchema: SelectInputSchema.shape,
      outputSchema: SelectOutputSchema.shape,
    },
    select
  );

  server.registerTool(
    'hover',
    {
      title: 'Hover Element',
      description:
        'Hover over an element to reveal menus or tooltips. ' +
        'Scrolls the element into view and moves the mouse to its center.',
      inputSchema: HoverInputSchema.shape,
      outputSchema: HoverOutputSchema.shape,
    },
    hover
  );

  server.registerTool(
    'scroll',
    {
      title: 'Scroll',
      description:
        'Scroll the page or an element into view. ' +
        'If node_id is provided, scrolls that element into view. ' +
        'Otherwise, scrolls the page up or down by the specified amount.',
      inputSchema: ScrollInputSchemaBase.shape,
      outputSchema: ScrollOutputSchema.shape,
    },
    scroll
  );

  // ============================================================================
  // V2 SESSION TOOLS
  // ============================================================================

  server.registerTool(
    'launch_browser',
    {
      title: 'Launch Browser (V2)',
      description: 'Launch a new browser instance and return the initial page snapshot.',
      inputSchema: LaunchBrowserInputSchema.shape,
      outputSchema: LaunchBrowserOutputSchema.shape,
    },
    launchBrowser
  );

  server.registerTool(
    'connect_browser',
    {
      title: 'Connect Browser (V2)',
      description: 'Connect to an existing browser instance via CDP.',
      inputSchema: ConnectBrowserInputSchema.shape,
      outputSchema: ConnectBrowserOutputSchema.shape,
    },
    connectBrowser
  );

  server.registerTool(
    'close_page',
    {
      title: 'Close Page (V2)',
      description: 'Close a specific page by page_id.',
      inputSchema: ClosePageInputSchema.shape,
      outputSchema: ClosePageOutputSchema.shape,
    },
    closePage
  );

  server.registerTool(
    'close_session',
    {
      title: 'Close Session (V2)',
      description: 'Close the entire browser session.',
      inputSchema: CloseSessionInputSchema.shape,
      outputSchema: CloseSessionOutputSchema.shape,
    },
    closeSession
  );

  // ============================================================================
  // V2 NAVIGATION TOOLS
  // ============================================================================

  server.registerTool(
    'navigate',
    {
      title: 'Navigate (V2)',
      description: 'Navigate directly to a URL and return the new snapshot.',
      inputSchema: NavigateInputSchema.shape,
      outputSchema: NavigateOutputSchema.shape,
    },
    navigate
  );

  server.registerTool(
    'go_back',
    {
      title: 'Go Back (V2)',
      description: 'Navigate back in browser history.',
      inputSchema: GoBackInputSchema.shape,
      outputSchema: GoBackOutputSchema.shape,
    },
    goBack
  );

  server.registerTool(
    'go_forward',
    {
      title: 'Go Forward (V2)',
      description: 'Navigate forward in browser history.',
      inputSchema: GoForwardInputSchema.shape,
      outputSchema: GoForwardOutputSchema.shape,
    },
    goForward
  );

  server.registerTool(
    'reload',
    {
      title: 'Reload (V2)',
      description: 'Reload the current page and return the refreshed snapshot.',
      inputSchema: ReloadInputSchema.shape,
      outputSchema: ReloadOutputSchema.shape,
    },
    reload
  );

  // ============================================================================
  // V2 OBSERVATION TOOLS
  // ============================================================================

  server.registerTool(
    'find_elements_v2',
    {
      title: 'Find Elements (V2)',
      description: 'Find elements by kind, label, or region in the current snapshot.',
      inputSchema: FindElementsV2InputSchema.shape,
      outputSchema: FindElementsV2OutputSchema.shape,
    },
    findElementsV2
  );

  server.registerTool(
    'get_node_details_v2',
    {
      title: 'Get Node Details (V2)',
      description: 'Return full details for a single node_id.',
      inputSchema: GetNodeDetailsV2InputSchema.shape,
      outputSchema: GetNodeDetailsV2OutputSchema.shape,
    },
    getNodeDetailsV2
  );

  // ============================================================================
  // V2 INTERACTION TOOLS
  // ============================================================================

  server.registerTool(
    'scroll_element_into_view',
    {
      title: 'Scroll Element Into View (V2)',
      description: 'Scroll a specific element into view and return a delta.',
      inputSchema: ScrollElementIntoViewInputSchema.shape,
      outputSchema: ScrollElementIntoViewOutputSchema.shape,
    },
    scrollElementIntoView
  );

  server.registerTool(
    'scroll_page',
    {
      title: 'Scroll Page (V2)',
      description: 'Scroll the page up or down by a specified amount and return a delta.',
      inputSchema: ScrollPageInputSchema.shape,
      outputSchema: ScrollPageOutputSchema.shape,
    },
    scrollPageV2
  );

  server.registerTool(
    'click_v2',
    {
      title: 'Click Element (V2)',
      description: 'Click an element by node_id with automatic delta reporting.',
      inputSchema: ClickV2InputSchema.shape,
      outputSchema: ClickV2OutputSchema.shape,
    },
    clickV2
  );

  server.registerTool(
    'type_v2',
    {
      title: 'Type Text (V2)',
      description: 'Type text into a specific node_id with optional clearing.',
      inputSchema: TypeV2InputSchema.shape,
      outputSchema: TypeV2OutputSchema.shape,
    },
    typeV2
  );

  server.registerTool(
    'press_v2',
    {
      title: 'Press Key (V2)',
      description: 'Press a keyboard key with optional modifiers.',
      inputSchema: PressV2InputSchema.shape,
      outputSchema: PressV2OutputSchema.shape,
    },
    pressV2
  );

  server.registerTool(
    'select_v2',
    {
      title: 'Select Option (V2)',
      description: 'Select an option from a <select> element by value or text.',
      inputSchema: SelectV2InputSchema.shape,
      outputSchema: SelectV2OutputSchema.shape,
    },
    selectV2
  );

  server.registerTool(
    'hover_v2',
    {
      title: 'Hover Element (V2)',
      description: 'Hover over an element by node_id and return a delta.',
      inputSchema: HoverV2InputSchema.shape,
      outputSchema: HoverV2OutputSchema.shape,
    },
    hoverV2
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
