/**
 * Tool Registration
 *
 * Extracts all 23 MCP tool registrations into a reusable function.
 * Used by both stdio (index.ts) and HTTP (http-gateway.ts) entry points.
 */

import type { ToolContext } from './tool-context.types.js';
import type { ToolRegistrar } from '../server/tool-registrar.types.js';

export type { ToolRegistrar } from '../server/tool-registrar.types.js';

// Import all tool handlers
import { listPages, closePage } from './navigation-tools.js';
import { navigate, goBack, goForward, reload } from './navigation-tools.js';
import {
  captureSnapshot,
  findElements,
  getNodeDetails,
  scrollElementIntoView,
  scrollPage,
} from './observation-tools.js';
import { click, type, press, select, hover } from './interaction-tools.js';
import { drag, wheel, takeScreenshot } from './viewport-tools.js';
import { inspectCanvas } from './canvas-tools.js';
import { getFormUnderstanding, getFieldContext } from './form-tools.js';
import { readPage } from './readability-tools.js';

// Import all input schemas
import {
  ListPagesInputSchema,
  ClosePageInputSchema,
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
  TakeScreenshotInputSchemaBase,
  InspectCanvasInputSchemaBase,
  ReadPageInputSchema,
} from './tool-schemas.js';
import { GetFormUnderstandingInputSchema, GetFieldContextInputSchema } from './form-tools.js';

/**
 * Context resolver function type.
 * Returns a ToolContext for the current request.
 */
export type ContextResolver = () => ToolContext | Promise<ToolContext>;

/** Tools that should not trigger lazy browser initialization */
const SKIP_BROWSER_INIT = new Set(['close_page', 'list_pages']);

/**
 * Register all browser automation tools on an MCP server.
 *
 * Browser initialization is session-scoped: each ToolContext owns its own
 * SessionManager and lazily launches/connects via ctx.ensureBrowser().
 *
 * @param server - The MCP server instance
 * @param resolveCtx - Function that returns the ToolContext for the current request
 */
export function registerAllTools(server: ToolRegistrar, resolveCtx: ContextResolver): void {
  // Helper: resolve context first, then ensure browser, then run handler.
  // Context resolution is cheap (returns existing SessionController),
  // so it's safe to resolve before the browser is running.
  function wrap<T, R>(
    handler: (input: T, ctx: ToolContext) => R | Promise<R>,
    toolName?: string
  ): (input: T) => Promise<R> {
    return async (input: T) => {
      const ctx = await resolveCtx();
      if (!SKIP_BROWSER_INIT.has(toolName ?? '')) {
        await ctx.ensureBrowser();
      }
      return handler(input, ctx);
    };
  }

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
    wrap(listPages, 'list_pages')
  );

  server.registerTool(
    'close_page',
    {
      title: 'Close Page',
      description: 'Close a browser tab. Use list_pages first to get the page_id.',
      inputSchema: ClosePageInputSchema.shape,
    },
    wrap(closePage, 'close_page')
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
    wrap(navigate)
  );

  server.registerTool(
    'go_back',
    {
      title: 'Go Back',
      description: 'Go back one page in browser history.',
      inputSchema: GoBackInputSchema.shape,
    },
    wrap(goBack)
  );

  server.registerTool(
    'go_forward',
    {
      title: 'Go Forward',
      description: 'Go forward one page in browser history.',
      inputSchema: GoForwardInputSchema.shape,
    },
    wrap(goForward)
  );

  server.registerTool(
    'reload',
    {
      title: 'Reload',
      description: 'Refresh the current page.',
      inputSchema: ReloadInputSchema.shape,
    },
    wrap(reload)
  );

  server.registerTool(
    'snapshot',
    {
      title: 'Snapshot',
      description:
        'Re-capture the page state without performing any action. Use when the page may have changed on its own (timers, live updates, animations).',
      inputSchema: CaptureSnapshotInputSchema.shape,
    },
    wrap(captureSnapshot)
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
    wrap(findElements)
  );

  server.registerTool(
    'get_element',
    {
      title: 'Get Element',
      description: 'Get complete details for one element: exact position, size, state, attributes.',
      inputSchema: GetNodeDetailsInputSchema.shape,
    },
    wrap(getNodeDetails)
  );

  server.registerTool(
    'screenshot',
    {
      title: 'Screenshot',
      description: 'Capture a screenshot of the current page or a specific element.',
      inputSchema: TakeScreenshotInputSchemaBase.shape,
    },
    wrap(takeScreenshot)
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
    wrap(scrollElementIntoView)
  );

  server.registerTool(
    'scroll',
    {
      title: 'Scroll',
      description: 'Scroll the viewport up or down by pixels.',
      inputSchema: ScrollPageInputSchema.shape,
    },
    wrap(scrollPage)
  );

  server.registerTool(
    'click',
    {
      title: 'Click Element',
      description: 'Click an element or at viewport coordinates.',
      inputSchema: ClickInputSchemaBase.shape,
    },
    wrap(click)
  );

  server.registerTool(
    'type',
    {
      title: 'Type Text',
      description: 'Type text into an input field or text area.',
      inputSchema: TypeInputSchemaBase.shape,
    },
    wrap(type)
  );

  server.registerTool(
    'press',
    {
      title: 'Press Key',
      description: 'Press a keyboard key with optional modifiers.',
      inputSchema: PressInputSchema.shape,
    },
    wrap(press)
  );

  server.registerTool(
    'select',
    {
      title: 'Select Option',
      description: 'Choose an option from a dropdown menu by value or visible text.',
      inputSchema: SelectInputSchemaBase.shape,
    },
    wrap(select)
  );

  server.registerTool(
    'hover',
    {
      title: 'Hover Element',
      description:
        'Move mouse over an element without clicking. Triggers hover menus and tooltips.',
      inputSchema: HoverInputSchemaBase.shape,
    },
    wrap(hover)
  );

  server.registerTool(
    'drag',
    {
      title: 'Drag',
      description: 'Drag from one point to another.',
      inputSchema: DragInputSchemaBase.shape,
    },
    wrap(drag)
  );

  server.registerTool(
    'wheel',
    {
      title: 'Wheel',
      description:
        'Dispatch a mouse wheel event at specific coordinates. Use for scroll-to-zoom (with Control modifier) or horizontal scrolling.',
      inputSchema: WheelInputSchemaBase.shape,
    },
    wrap(wheel)
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
    wrap(inspectCanvas)
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
    wrap(getFormUnderstanding)
  );

  server.registerTool(
    'get_field',
    {
      title: 'Get Field',
      description:
        'Get detailed info about one form field: purpose, valid input formats, dependencies, and suggested values.',
      inputSchema: GetFieldContextInputSchema.shape,
    },
    wrap(getFieldContext)
  );

  // ============================================================================
  // READABILITY TOOLS
  // ============================================================================

  server.registerTool(
    'read_page',
    {
      title: 'Read Page',
      description:
        'Extract the main readable content from the page, removing navigation, ads, and clutter. Uses Mozilla Readability (Firefox Reader View engine). Best for articles, blog posts, documentation, and content-heavy pages.',
      inputSchema: ReadPageInputSchema.shape,
    },
    wrap(readPage)
  );
}
