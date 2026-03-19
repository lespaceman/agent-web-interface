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
  getServerConfig,
  ensureBrowserForTools,
  isSessionManagerInitialized,
} from './server/server-config.js';
import { SessionStore } from './server/session-store.js';
import { SessionWorkerBinding, type IsolationMode } from './session/session-worker-binding.js';
import { getLogger } from './shared/services/logging.service.js';
import { cleanupTempFiles } from './lib/temp-file.js';

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
import {
  initializeToolContext,
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
  drag,
  wheel,
  getFormUnderstanding,
  getFieldContext,
  takeScreenshot,
  inspectCanvas,
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
  DragInputSchemaBase,
  WheelInputSchemaBase,
  GetFormUnderstandingInputSchema,
  GetFieldContextInputSchema,
  TakeScreenshotInputSchemaBase,
  InspectCanvasInputSchemaBase,
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

  // Wire SessionStore to MCP lifecycle events
  server.on('session:start', (event: SessionStartEvent) => {
    const { clientInfo } = event;
    const sessionId = sessionStore.createSession(clientInfo?.name ?? 'unknown', clientInfo);
    const session = sessionStore.getSession(sessionId)!;

    // Route session start through the isolation binding.
    // Browser init is lazy (first tool call), so context creation may fail here
    // if the browser isn't launched yet. That's OK — the tool's withLazyInit
    // will ensure the browser is ready before any real work happens.
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

  // Initialize session manager and tools
  const session = getSessionManager();
  initializeToolContext(session);

  // ============================================================================
  // SESSION TOOLS
  // ============================================================================

  server.registerTool(
    'list_pages',
    {
      title: 'List Pages',
      description: 'List all open browser pages with their page_id, URL, and title.',
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
      description: 'Close the entire browser and clear all state.',
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
      description: 'Go to a URL. Returns page snapshot with interactive elements.',
      inputSchema: NavigateInputSchema.shape,
    },
    withLazyInit(navigate, 'navigate')
  );

  server.registerTool(
    'go_back',
    {
      title: 'Go Back',
      description: 'Go back one page in browser history.',
      inputSchema: GoBackInputSchema.shape,
    },
    withLazyInit(goBack, 'go_back')
  );

  server.registerTool(
    'go_forward',
    {
      title: 'Go Forward',
      description: 'Go forward one page in browser history.',
      inputSchema: GoForwardInputSchema.shape,
    },
    withLazyInit(goForward, 'go_forward')
  );

  server.registerTool(
    'reload',
    {
      title: 'Reload',
      description: 'Refresh the current page.',
      inputSchema: ReloadInputSchema.shape,
    },
    withLazyInit(reload, 'reload')
  );

  server.registerTool(
    'snapshot',
    {
      title: 'Snapshot',
      description:
        'Re-capture the page state without performing any action. Use when the page may have changed on its own (timers, live updates, animations).',
      inputSchema: CaptureSnapshotInputSchema.shape,
    },
    withLazyInit(captureSnapshot, 'snapshot')
  );

  // ============================================================================
  // OBSERVATION TOOLS
  // ============================================================================

  server.registerTool(
    'find',
    {
      title: 'Find',
      description:
        'Search for interactive elements OR read page text content. Filter by `kind` (button, link, textbox, canvas), `label` (case-insensitive substring match), or `region` (header, main, footer).',
      inputSchema: FindElementsInputSchema.shape,
    },
    withLazyInit(findElements, 'find')
  );

  server.registerTool(
    'get_element',
    {
      title: 'Get Element',
      description: 'Get complete details for one element: exact position, size, state, attributes.',
      inputSchema: GetNodeDetailsInputSchema.shape,
    },
    withLazyInit(getNodeDetails, 'get_element')
  );

  server.registerTool(
    'screenshot',
    {
      title: 'Screenshot',
      description: 'Capture a screenshot of the current page or a specific element.',
      inputSchema: TakeScreenshotInputSchemaBase.shape,
    },
    withLazyInit(takeScreenshot, 'screenshot')
  );

  // ============================================================================
  // INTERACTION TOOLS
  // ============================================================================

  server.registerTool(
    'scroll_to',
    {
      title: 'Scroll To',
      description: 'Scroll until a specific element is visible in the viewport.',
      inputSchema: ScrollElementIntoViewInputSchemaBase.shape,
    },
    withLazyInit(scrollElementIntoView, 'scroll_to')
  );

  server.registerTool(
    'scroll',
    {
      title: 'Scroll',
      description: 'Scroll the viewport up or down by pixels.',
      inputSchema: ScrollPageInputSchema.shape,
    },
    withLazyInit(scrollPage, 'scroll')
  );

  server.registerTool(
    'click',
    {
      title: 'Click Element',
      description: 'Click an element or at viewport coordinates.',
      inputSchema: ClickInputSchemaBase.shape,
    },
    withLazyInit(click, 'click')
  );

  server.registerTool(
    'type',
    {
      title: 'Type Text',
      description: 'Type text into an input field or text area.',
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
      description: 'Choose an option from a dropdown menu by value or visible text.',
      inputSchema: SelectInputSchemaBase.shape,
    },
    withLazyInit(select, 'select')
  );

  server.registerTool(
    'hover',
    {
      title: 'Hover Element',
      description:
        'Move mouse over an element without clicking. Triggers hover menus and tooltips.',
      inputSchema: HoverInputSchemaBase.shape,
    },
    withLazyInit(hover, 'hover')
  );

  server.registerTool(
    'drag',
    {
      title: 'Drag',
      description: 'Drag from one point to another.',
      inputSchema: DragInputSchemaBase.shape,
    },
    withLazyInit(drag, 'drag')
  );

  server.registerTool(
    'wheel',
    {
      title: 'Wheel',
      description:
        'Dispatch a mouse wheel event at specific coordinates. Use for scroll-to-zoom (with Control modifier) or horizontal scrolling.',
      inputSchema: WheelInputSchemaBase.shape,
    },
    withLazyInit(wheel, 'wheel')
  );

  // ============================================================================
  // CANVAS INSPECTION TOOLS
  // ============================================================================

  server.registerTool(
    'inspect_canvas',
    {
      title: 'Inspect Canvas',
      description:
        'Analyze a canvas element: auto-detect the rendering library, query its scene graph, and return an annotated screenshot with coordinate grid overlay.',
      inputSchema: InspectCanvasInputSchemaBase.shape,
    },
    withLazyInit(inspectCanvas, 'inspect_canvas')
  );

  // ============================================================================
  // FORM UNDERSTANDING TOOLS
  // ============================================================================

  server.registerTool(
    'get_form',
    {
      title: 'Get Form',
      description:
        'Analyze all forms on the page: fields, required inputs, validation rules, and field dependencies.',
      inputSchema: GetFormUnderstandingInputSchema.shape,
    },
    withLazyInit(getFormUnderstanding, 'get_form')
  );

  server.registerTool(
    'get_field',
    {
      title: 'Get Field',
      description:
        'Get detailed info about one form field: purpose, valid input formats, dependencies, and suggested values.',
      inputSchema: GetFieldContextInputSchema.shape,
    },
    withLazyInit(getFieldContext, 'get_field')
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
