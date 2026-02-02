#!/usr/bin/env node

/**
 * Browser Automation MCP Server
 *
 * Main entry point - initializes the MCP server with Puppeteer-based browser automation.
 */

import { BrowserAutomationServer } from './server/mcp-server.js';
import {
  initServerConfig,
  getSessionManager,
  getServerConfig,
  ensureBrowserForTools,
  isSessionManagerInitialized,
} from './server/server-config.js';
import { getLogger } from './shared/services/logging.service.js';
import { cleanupTempFiles } from './lib/temp-file.js';

const logger = getLogger();
import {
  initializeTools,
  initializeFormTools,
  // Tool handlers
  listPages,
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
  takeScreenshot,
  // Input schemas only (all outputs are XML strings now)
  ListPagesInputSchema,
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
  TakeScreenshotInputSchemaBase,
} from './tools/index.js';

/**
 * Wrap a tool handler with lazy browser initialization.
 * Works with both sync and async handlers - sync return values are automatically
 * wrapped in a resolved promise by the async function.
 * Includes error context logging when browser initialization fails.
 */
function withLazyInit<T, R>(
  handler: (input: T) => R | Promise<R>,
  toolName?: string
): (input: T) => Promise<R> {
  return async (input: T) => {
    try {
      await ensureBrowserForTools();
    } catch (error) {
      const config = getServerConfig();
      const mode = config.autoConnect
        ? 'autoConnect'
        : config.browserUrl || config.wsEndpoint
          ? 'connect'
          : 'launch';
      logger.error(
        'Browser initialization failed during tool execution',
        error instanceof Error ? error : undefined,
        {
          tool: toolName,
          mode,
          headless: config.headless,
          autoConnect: config.autoConnect,
          browserUrl: config.browserUrl,
          wsEndpoint: config.wsEndpoint,
        }
      );
      throw error;
    }
    return handler(input);
  };
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
    version: '3.0.0',
  });

  // Initialize session manager and tools
  const session = getSessionManager();
  initializeTools(session);
  initializeFormTools(session);

  // ============================================================================
  // SESSION TOOLS
  // ============================================================================

  server.registerTool(
    'list_pages',
    {
      title: 'List Pages',
      description:
        'List all open browser pages with their page_id, URL, and title. Use when working with multiple pages or to get the page_id for targeting a specific page.',
      inputSchema: ListPagesInputSchema.shape,
    },
    withLazyInit(listPages, 'list_pages')
  );

  server.registerTool(
    'close_page',
    {
      title: 'Close Page',
      description: 'Close a browser tab. Use list_pages first to get the page_id.',
      inputSchema: ClosePageInputSchema.shape,
    },
    withLazyInit(closePage, 'close_page')
  );

  server.registerTool(
    'close_session',
    {
      title: 'Close Session',
      description:
        'Close the entire browser and clear all state. Use when done with browser tasks or to reset after errors. Browser auto-restarts on next tool call.',
      inputSchema: CloseSessionInputSchema.shape,
    },
    withLazyInit(closeSession, 'close_session')
  );

  // ============================================================================
  // NAVIGATION TOOLS
  // ============================================================================

  server.registerTool(
    'navigate',
    {
      title: 'Navigate',
      description:
        'Go to a URL. Returns page snapshot with interactive elements. This is typically your first action when starting browser automation.',
      inputSchema: NavigateInputSchema.shape,
    },
    withLazyInit(navigate, 'navigate')
  );

  server.registerTool(
    'go_back',
    {
      title: 'Go Back',
      description:
        'Go back one page in browser history (like clicking the back button). Returns updated page snapshot.',
      inputSchema: GoBackInputSchema.shape,
    },
    withLazyInit(goBack, 'go_back')
  );

  server.registerTool(
    'go_forward',
    {
      title: 'Go Forward',
      description: 'Go forward one page in browser history. Returns updated page snapshot.',
      inputSchema: GoForwardInputSchema.shape,
    },
    withLazyInit(goForward, 'go_forward')
  );

  server.registerTool(
    'reload',
    {
      title: 'Reload',
      description:
        'Refresh the current page. Use when content may be stale or after waiting for server-side changes. Returns updated snapshot.',
      inputSchema: ReloadInputSchema.shape,
    },
    withLazyInit(reload, 'reload')
  );

  server.registerTool(
    'capture_snapshot',
    {
      title: 'Capture Snapshot',
      description:
        'Re-capture the page state without performing any action. Use when the page may have changed on its own (timers, live updates, animations completing). NOT needed after click/type/etc - those already return fresh snapshots.',
      inputSchema: CaptureSnapshotInputSchema.shape,
    },
    withLazyInit(captureSnapshot, 'capture_snapshot')
  );

  // ============================================================================
  // OBSERVATION TOOLS
  // ============================================================================

  server.registerTool(
    'find_elements',
    {
      title: 'Find Elements',
      description:
        'Search for interactive elements OR read page text content. Filter by `kind` (button, link, textbox), `label` (case-insensitive substring match), or `region` (header, main, footer). To READ page content, ensure `include_readable: true` (default) which includes paragraphs and headings.',
      inputSchema: FindElementsInputSchema.shape,
    },
    withLazyInit(findElements, 'find_elements')
  );

  server.registerTool(
    'get_element_details',
    {
      title: 'Get Element Details',
      description:
        'Get complete details for one element: exact position, size, state, attributes. Use when you need more info than find_elements provides, like precise coordinates or full attribute list.',
      inputSchema: GetNodeDetailsInputSchema.shape,
    },
    withLazyInit(getNodeDetails, 'get_element_details')
  );

  server.registerTool(
    'take_screenshot',
    {
      title: 'Take Screenshot',
      description:
        'Capture a screenshot of the current page or a specific element. Returns the image directly for small screenshots (<2MB) or saves to a temp file for large ones. Use `eid` for element screenshots (requires a prior snapshot) or `fullPage: true` for full-page capture. Supports PNG (lossless, default) and JPEG (lossy with quality 0-100). Cannot combine eid and fullPage.',
      inputSchema: TakeScreenshotInputSchemaBase.shape,
    },
    withLazyInit(takeScreenshot, 'take_screenshot')
  );

  // ============================================================================
  // INTERACTION TOOLS
  // ============================================================================

  server.registerTool(
    'scroll_element_into_view',
    {
      title: 'Scroll Element Into View',
      description:
        'Scroll until a specific element is visible in the viewport. Use BEFORE clicking or interacting with elements that are off-screen.',
      inputSchema: ScrollElementIntoViewInputSchemaBase.shape,
    },
    withLazyInit(scrollElementIntoView, 'scroll_element_into_view')
  );

  server.registerTool(
    'scroll_page',
    {
      title: 'Scroll Page',
      description:
        'Scroll the viewport up or down by pixels. Use to explore page content, load lazy content, or reach elements below the fold. Returns updated snapshot.',
      inputSchema: ScrollPageInputSchema.shape,
    },
    withLazyInit(scrollPage, 'scroll_page')
  );

  server.registerTool(
    'click',
    {
      title: 'Click Element',
      description:
        'Click an element. Use for buttons, links, checkboxes, or any clickable element. Returns updated page snapshot reflecting any changes from the click.',
      inputSchema: ClickInputSchemaBase.shape,
    },
    withLazyInit(click, 'click')
  );

  server.registerTool(
    'type',
    {
      title: 'Type Text',
      description:
        'Type text into an input field, search box, or text area. Set `clear: true` to replace existing text instead of appending. Returns updated snapshot.',
      inputSchema: TypeInputSchemaBase.shape,
    },
    withLazyInit(type, 'type')
  );

  server.registerTool(
    'press',
    {
      title: 'Press Key',
      description:
        'Press a keyboard key (Enter, Tab, Escape, arrows, etc.) with optional Ctrl/Shift/Alt modifiers. Use for: submitting forms (Enter), moving between fields (Tab), closing dialogs (Escape), or keyboard shortcuts.',
      inputSchema: PressInputSchema.shape,
    },
    withLazyInit(press, 'press')
  );

  server.registerTool(
    'select',
    {
      title: 'Select Option',
      description:
        'Choose an option from a dropdown menu. Specify the option by its value attribute or visible text. Returns updated snapshot.',
      inputSchema: SelectInputSchemaBase.shape,
    },
    withLazyInit(select, 'select')
  );

  server.registerTool(
    'hover',
    {
      title: 'Hover Element',
      description:
        'Move mouse over an element without clicking. Use to trigger hover menus, tooltips, or reveal hidden content that appears on mouseover.',
      inputSchema: HoverInputSchemaBase.shape,
    },
    withLazyInit(hover, 'hover')
  );

  // ============================================================================
  // FORM UNDERSTANDING TOOLS
  // ============================================================================

  server.registerTool(
    'get_form_understanding',
    {
      title: 'Get Form Understanding',
      description:
        'Analyze all forms on the page: fields, required inputs, validation rules, and field dependencies. Use BEFORE filling complex forms (multi-step, conditional fields) to understand what is required and in what order.',
      inputSchema: GetFormUnderstandingInputSchema.shape,
    },
    withLazyInit(getFormUnderstanding, 'get_form_understanding')
  );

  server.registerTool(
    'get_field_context',
    {
      title: 'Get Field Context',
      description:
        'Get detailed info about one form field: what it is for, valid input formats, dependencies on other fields, and suggested values. Use when unsure how to fill a specific field.',
      inputSchema: GetFieldContextInputSchema.shape,
    },
    withLazyInit(getFieldContext, 'get_field_context')
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
          await cleanupTempFiles();
          // Shutdown browser session first (only if initialized)
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
