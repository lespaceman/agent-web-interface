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

const logger = getLogger();
import {
  initializeTools,
  initializeFormTools,
  // Tool handlers
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
    'close_page',
    {
      title: 'Close Page',
      description: 'Close a specific page by page_id.',
      inputSchema: ClosePageInputSchema.shape,
    },
    withLazyInit(closePage, 'close_page')
  );

  server.registerTool(
    'close_session',
    {
      title: 'Close Session',
      description:
        'Close the browser session and clear all state. The browser will be re-initialized automatically on the next tool call.',
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
      description: 'Navigate directly to a URL and return the new snapshot.',
      inputSchema: NavigateInputSchema.shape,
    },
    withLazyInit(navigate, 'navigate')
  );

  server.registerTool(
    'go_back',
    {
      title: 'Go Back',
      description: 'Navigate back in browser history.',
      inputSchema: GoBackInputSchema.shape,
    },
    withLazyInit(goBack, 'go_back')
  );

  server.registerTool(
    'go_forward',
    {
      title: 'Go Forward',
      description: 'Navigate forward in browser history.',
      inputSchema: GoForwardInputSchema.shape,
    },
    withLazyInit(goForward, 'go_forward')
  );

  server.registerTool(
    'reload',
    {
      title: 'Reload',
      description: 'Reload the current page and return the refreshed snapshot.',
      inputSchema: ReloadInputSchema.shape,
    },
    withLazyInit(reload, 'reload')
  );

  server.registerTool(
    'capture_snapshot',
    {
      title: 'Capture Snapshot',
      description: 'Capture a fresh snapshot of the current page.',
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
      description: 'Find elements by kind, label, or region in the current snapshot.',
      inputSchema: FindElementsInputSchema.shape,
    },
    withLazyInit(findElements, 'find_elements')
  );

  server.registerTool(
    'get_node_details',
    {
      title: 'Get Node Details',
      description: 'Return full details for a single eid.',
      inputSchema: GetNodeDetailsInputSchema.shape,
    },
    withLazyInit(getNodeDetails, 'get_node_details')
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
    withLazyInit(scrollElementIntoView, 'scroll_element_into_view')
  );

  server.registerTool(
    'scroll_page',
    {
      title: 'Scroll Page',
      description: 'Scroll the page up or down by a specified amount.',
      inputSchema: ScrollPageInputSchema.shape,
    },
    withLazyInit(scrollPage, 'scroll_page')
  );

  server.registerTool(
    'click',
    {
      title: 'Click Element',
      description: 'Click an element by eid.',
      inputSchema: ClickInputSchemaBase.shape,
    },
    withLazyInit(click, 'click')
  );

  server.registerTool(
    'type',
    {
      title: 'Type Text',
      description: 'Type text into a specific element (by eid) with optional clearing.',
      inputSchema: TypeInputSchemaBase.shape,
    },
    withLazyInit(type, 'type')
  );

  server.registerTool(
    'press',
    {
      title: 'Press Key',
      description: 'Press a keyboard key with optional modifiers.',
      inputSchema: PressInputSchema.shape,
    },
    withLazyInit(press, 'press')
  );

  server.registerTool(
    'select',
    {
      title: 'Select Option',
      description: 'Select an option from a <select> element (by eid) by value or text.',
      inputSchema: SelectInputSchemaBase.shape,
    },
    withLazyInit(select, 'select')
  );

  server.registerTool(
    'hover',
    {
      title: 'Hover Element',
      description: 'Hover over an element by eid.',
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
        'Analyze forms on the page and return semantic understanding of form regions, fields, dependencies, and state. Use this to understand complex form interactions.',
      inputSchema: GetFormUnderstandingInputSchema.shape,
    },
    withLazyInit(getFormUnderstanding, 'get_form_understanding')
  );

  server.registerTool(
    'get_field_context',
    {
      title: 'Get Field Context',
      description:
        'Get detailed context for a specific form field including purpose inference, constraints, dependencies, and suggested next action.',
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
