/**
 * MCP Server
 *
 * Main server orchestration for the Browser Automation MCP Server
 * Handles tool registration, request routing, and MCP protocol implementation
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ServerConfig } from './types.js';
import type { Handlers } from './tool-registry.js';

// Import Zod schemas for all domains
import * as PerceptionSchemas from '../domains/perception/perception.schemas.js';
import * as InteractionSchemas from '../domains/interaction/interaction.schemas.js';
import * as NavigationSchemas from '../domains/navigation/navigation.schemas.js';
import * as SessionSchemas from '../domains/session/session.schemas.js';

// Import error handling and logging
import {
  createSuccessResponse,
  createErrorResponse,
  type McpToolResponse,
} from '../shared/errors/index.js';
import {
  getLogger,
  type LogLevel,
  type McpNotificationSender,
} from '../shared/services/logging.service.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * Helper function to wrap handler output for MCP
 * Now returns McpToolResponse type
 */
function wrapOutput(output: unknown): McpToolResponse {
  return createSuccessResponse(output);
}

/**
 * Helper function to wrap handler execution with error handling and logging
 */
async function executeWithLogging<T>(
  toolName: string,
  handler: () => Promise<T>
): Promise<McpToolResponse> {
  const logger = getLogger();
  const startTime = Date.now();

  console.error(`[executeWithLogging] Starting execution of tool: ${toolName}`);

  try {
    logger.debug(`Executing tool: ${toolName}`);
    const result = await handler();
    const executionTime = Date.now() - startTime;
    console.error(`[executeWithLogging] Tool ${toolName} completed in ${executionTime}ms`);
    logger.debug(`Tool ${toolName} completed in ${executionTime}ms`);
    return createSuccessResponse(result);
  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error(`[executeWithLogging] Tool ${toolName} FAILED:`, error);
    logger.error(
      `Tool ${toolName} failed after ${executionTime}ms`,
      error instanceof Error ? error : undefined,
      { toolName }
    );
    return createErrorResponse(error);
  }
}

/**
 * Browser Automation MCP Server
 *
 * Modern implementation using McpServer with native Zod integration
 * and structured output support
 */
export class BrowserAutomationServer implements McpNotificationSender {
  private server: McpServer;
  private transport: StdioServerTransport;

  constructor(
    private readonly config: ServerConfig,
    private readonly handlers: Handlers
  ) {
    // Create modern MCP server instance with capabilities
    this.server = new McpServer(
      {
        name: config.name,
        version: config.version,
      },
      {
        capabilities: config.capabilities,
      }
    );

    // Create stdio transport
    this.transport = new StdioServerTransport();

    // Register logging request handler
    this.registerLoggingHandlers();

    // Register all tools with native Zod support
    this.registerAllTools();

    // Wire up logging service to MCP server
    const logger = getLogger();
    logger.setMcpServer(this);
  }

  /**
   * Send logging message notification via MCP protocol
   * Implements McpNotificationSender interface
   */
  async sendLoggingMessage(params: {
    level: LogLevel;
    logger?: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    // Send notifications/message notification
    await this.server.server.notification({
      method: 'notifications/message',
      params: {
        level: params.level,
        logger: params.logger,
        data: params.data,
      },
    });
  }

  /**
   * Register logging request handlers
   */
  private registerLoggingHandlers(): void {
    // Handle logging/setLevel requests
    this.server.server.setRequestHandler(SetLevelRequestSchema, (request) => {
      const logger = getLogger();
      const { level } = request.params;
      logger.setMinLevel(level as LogLevel);
      logger.info(`Log level set to: ${level}`);
      return {}; // Empty result as per spec
    });
  }

  /**
   * Register all tools using the modern McpServer API
   */
  private registerAllTools(): void {
    // Register perception tools
    this.registerPerceptionTools();

    // Register interaction tools
    this.registerInteractionTools();

    // Register navigation tools
    this.registerNavigationTools();

    // Register session tools
    this.registerSessionTools();
  }

  /**
   * Register perception domain tools
   */
  private registerPerceptionTools(): void {
    // dom_get_tree
    this.server.registerTool(
      'dom_get_tree',
      {
        title: 'Get DOM Tree',
        description:
          'Retrieve the DOM tree structure with configurable depth and visibility filtering',
        inputSchema: PerceptionSchemas.DomGetTreeInputSchema.shape,
        outputSchema: PerceptionSchemas.DomGetTreeOutputSchema.shape,
      },
      async (input) => executeWithLogging('dom_get_tree', () => this.handlers.domTree.handle(input))
    );

    // ax_get_tree
    this.server.registerTool(
      'ax_get_tree',
      {
        title: 'Get Accessibility Tree',
        description: 'Retrieve the accessibility tree with ARIA roles and properties',
        inputSchema: PerceptionSchemas.AxGetTreeInputSchema.shape,
        outputSchema: PerceptionSchemas.AxGetTreeOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.axTree.handle(input))
    );

    // ui_discover
    this.server.registerTool(
      'ui_discover',
      {
        title: 'Discover UI Elements',
        description:
          'Discover interactive UI elements by fusing DOM, accessibility, and layout information',
        inputSchema: PerceptionSchemas.UiDiscoverInputSchema.shape,
        outputSchema: PerceptionSchemas.UiDiscoverOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.uiDiscover.handle(input))
    );

    // layout_get_box_model
    this.server.registerTool(
      'layout_get_box_model',
      {
        title: 'Get Box Model',
        description: 'Get element box model including position, size, and quad coordinates',
        inputSchema: PerceptionSchemas.LayoutGetBoxModelInputSchema.shape,
        outputSchema: PerceptionSchemas.LayoutGetBoxModelOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.layout.getBoxModel(input))
    );

    // layout_is_visible
    this.server.registerTool(
      'layout_is_visible',
      {
        title: 'Check Visibility',
        description: 'Check if an element is currently visible in the viewport',
        inputSchema: PerceptionSchemas.LayoutIsVisibleInputSchema.shape,
        outputSchema: PerceptionSchemas.LayoutIsVisibleOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.layout.isVisible(input))
    );

    // vision_find_by_text
    this.server.registerTool(
      'vision_find_by_text',
      {
        title: 'Find by Text',
        description: 'Find elements by visible text using OCR (Optical Character Recognition)',
        inputSchema: PerceptionSchemas.VisionFindByTextInputSchema.shape,
        outputSchema: PerceptionSchemas.VisionFindByTextOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.vision.findByText(input))
    );

    // content_extract
    this.server.registerTool(
      'content_extract',
      {
        title: 'Extract Content',
        description: 'Extract page content including text and metadata',
        inputSchema: PerceptionSchemas.ContentGetTextInputSchema.shape,
        outputSchema: PerceptionSchemas.ContentGetTextOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.content.extract(input))
    );

    // network_observe
    this.server.registerTool(
      'network_observe',
      {
        title: 'Observe Network',
        description: 'Observe network activity including requests and responses',
        inputSchema: PerceptionSchemas.NetObserveInputSchema.shape,
        outputSchema: PerceptionSchemas.NetObserveOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.network.observe(input))
    );
  }

  /**
   * Register interaction domain tools
   */
  private registerInteractionTools(): void {
    // targets_resolve
    this.server.registerTool(
      'targets_resolve',
      {
        title: 'Resolve Target',
        description: `Resolve a locator hint to a specific element reference with selectors.

IMPORTANT USAGE GUIDELINES:
- ALWAYS use concrete selectors (css, xpath, ax) rather than semantic hints alone
- Semantic hints (role, label, name) by themselves are unreliable and may fail
- Use nearText ONLY when combined with a concrete selector like css or xpath
- Avoid attribute selectors for implicit HTML attributes (e.g., button[type='submit'])

Examples:
✅ {css: "a", nearText: "Learn more"} - concrete selector + proximity
✅ {xpath: "//button"} - simple, reliable
❌ {role: "link", nearText: "Learn more"} - semantic only, unreliable
❌ {css: "button[type='submit']"} - implicit attribute, may fail`,
        inputSchema: InteractionSchemas.TargetsResolveInputSchema.shape,
        outputSchema: InteractionSchemas.TargetsResolveOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.action.resolve(input))
    );

    // act_click
    this.server.registerTool(
      'act_click',
      {
        title: 'Click Element',
        description: `Click an element using multiple strategies (accessibility, DOM, or bounding box).

TARGET SELECTION:
- Use concrete CSS/XPath selectors for reliability
- Avoid attribute selectors for implicit HTML attributes
- Can combine concrete selectors with nearText for disambiguation

Examples:
✅ {css: "button.submit"} - reliable
✅ {css: "a", nearText: "Learn more"} - selector + proximity
❌ {role: "button"} - semantic alone, unreliable
❌ {css: "button[type='submit']"} - implicit attribute`,
        inputSchema: InteractionSchemas.ActClickInputSchema.shape,
        outputSchema: InteractionSchemas.ActClickOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.action.click(input))
    );

    // act_type
    this.server.registerTool(
      'act_type',
      {
        title: 'Type Text',
        description: `Type text into an input field with optional clearing and Enter key support.

TARGET SELECTION:
- Use concrete CSS/XPath selectors to identify input fields
- Avoid attribute selectors for implicit HTML attributes
- ID and name selectors work well for form fields

Examples:
✅ {css: "input[name='email']"} - explicit name attribute
✅ {css: "#username"} - ID selector
✅ {xpath: "//textarea[@name='message']"}
❌ {role: "textbox", label: "Email"} - semantic only`,
        inputSchema: InteractionSchemas.ActTypeInputSchema.shape,
        outputSchema: InteractionSchemas.ActTypeOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.action.type(input))
    );

    // act_scroll_into_view
    this.server.registerTool(
      'act_scroll_into_view',
      {
        title: 'Scroll Into View',
        description: `Scroll an element into the viewport, optionally centering it.

SELECTOR GUIDELINES:
- Use concrete CSS/XPath selectors (e.g., 'button', 'a.nav-link')
- Avoid attribute selectors for implicit HTML attributes
- Prefer simple selectors over complex ones with implicit attributes

Examples:
✅ {css: "button"} - works reliably
✅ {css: "#submit-btn"} - specific and reliable
❌ {css: "button[type='submit']"} - may fail if type is implicit`,
        inputSchema: InteractionSchemas.ActScrollIntoViewInputSchema.shape,
        outputSchema: InteractionSchemas.ActScrollIntoViewOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.action.scrollIntoView(input))
    );

    // act_upload
    this.server.registerTool(
      'act_upload',
      {
        title: 'Upload Files',
        description: 'Upload one or more files to a file input element',
        inputSchema: InteractionSchemas.ActUploadInputSchema.shape,
        outputSchema: InteractionSchemas.ActUploadOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.action.upload(input))
    );

    // form_detect
    this.server.registerTool(
      'form_detect',
      {
        title: 'Detect Form',
        description: 'Detect form fields and submit buttons using enhanced field detection',
        inputSchema: InteractionSchemas.FormDetectInputSchema.shape,
        outputSchema: InteractionSchemas.FormDetectOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.form.detect(input))
    );

    // form_fill
    this.server.registerTool(
      'form_fill',
      {
        title: 'Fill Form',
        description: 'Fill multiple form fields at once with optional auto-submit',
        inputSchema: InteractionSchemas.FormFillInputSchema.shape,
        outputSchema: InteractionSchemas.FormFillOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.form.fill(input))
    );

    // kb_press
    this.server.registerTool(
      'kb_press',
      {
        title: 'Press Key',
        description: 'Press a key or key combination with optional modifiers',
        inputSchema: InteractionSchemas.KeyboardPressInputSchema.shape,
        outputSchema: InteractionSchemas.KeyboardPressOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.keyboard.press(input))
    );

    // kb_hotkey
    this.server.registerTool(
      'kb_hotkey',
      {
        title: 'Execute Hotkey',
        description: 'Execute common hotkeys like copy, paste, save, etc.',
        inputSchema: InteractionSchemas.KeyboardHotkeyInputSchema.shape,
        outputSchema: InteractionSchemas.KeyboardHotkeyOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.keyboard.hotkey(input))
    );
  }

  /**
   * Register navigation domain tools
   */
  private registerNavigationTools(): void {
    // nav_goto
    this.server.registerTool(
      'nav_goto',
      {
        title: 'Navigate to URL',
        description: 'Navigate to a URL with configurable wait conditions and timeout',
        inputSchema: NavigationSchemas.NavGotoInputSchema.shape,
        outputSchema: NavigationSchemas.NavGotoOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.navigation.goto(input))
    );

    // nav_back
    this.server.registerTool(
      'nav_back',
      {
        title: 'Go Back',
        description: 'Navigate back in browser history',
        inputSchema: NavigationSchemas.NavBackInputSchema.shape,
        outputSchema: NavigationSchemas.NavBackOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.navigation.back(input))
    );

    // nav_forward
    this.server.registerTool(
      'nav_forward',
      {
        title: 'Go Forward',
        description: 'Navigate forward in browser history',
        inputSchema: NavigationSchemas.NavForwardInputSchema.shape,
        outputSchema: NavigationSchemas.NavForwardOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.navigation.forward(input))
    );

    // nav_reload
    this.server.registerTool(
      'nav_reload',
      {
        title: 'Reload Page',
        description: 'Reload the current page with optional cache bypass',
        inputSchema: NavigationSchemas.NavReloadInputSchema.shape,
        outputSchema: NavigationSchemas.NavReloadOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.navigation.reload(input))
    );

    // nav_get_url
    this.server.registerTool(
      'nav_get_url',
      {
        title: 'Get Current URL',
        description: 'Get the current page URL and title',
        inputSchema: NavigationSchemas.NavGetUrlInputSchema.shape,
        outputSchema: NavigationSchemas.NavGetUrlOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.navigation.getUrl(input))
    );
  }

  /**
   * Register session domain tools
   */
  private registerSessionTools(): void {
    // session_cookies_get
    this.server.registerTool(
      'session_cookies_get',
      {
        title: 'Get Cookies',
        description: 'Retrieve browser cookies, optionally filtered by URL',
        inputSchema: SessionSchemas.SessionCookiesGetInputSchema.shape,
        outputSchema: SessionSchemas.SessionCookiesGetOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.session.getCookies(input))
    );

    // session_cookies_set
    this.server.registerTool(
      'session_cookies_set',
      {
        title: 'Set Cookies',
        description: 'Set one or more browser cookies with full attribute control',
        inputSchema: SessionSchemas.SessionCookiesSetInputSchema.shape,
        outputSchema: SessionSchemas.SessionCookiesSetOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.session.setCookies(input))
    );

    // session_state_get
    this.server.registerTool(
      'session_state_get',
      {
        title: 'Get Session State',
        description: 'Get complete session state including URL, cookies, and localStorage',
        inputSchema: SessionSchemas.SessionStateGetInputSchema.shape,
        outputSchema: SessionSchemas.SessionStateGetOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.session.getState(input))
    );

    // session_state_set
    this.server.registerTool(
      'session_state_set',
      {
        title: 'Set Session State',
        description: 'Restore complete session state from a previous snapshot',
        inputSchema: SessionSchemas.SessionStateSetInputSchema.shape,
        outputSchema: SessionSchemas.SessionStateSetOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.session.setState(input))
    );

    // session_close
    this.server.registerTool(
      'session_close',
      {
        title: 'Close Session',
        description: 'Close the browser session, optionally saving state first',
        inputSchema: SessionSchemas.SessionCloseInputSchema.shape,
        outputSchema: SessionSchemas.SessionCloseOutputSchema.shape,
      },
      async (input) => wrapOutput(await this.handlers.session.close(input))
    );
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    // Connect transport
    await this.server.connect(this.transport);

    console.error(`${this.config.name} v${this.config.version} started`);
    console.error(`Registered 32 tools`);
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    await this.server.close();
  }
}

// Export legacy MCPServer for backward compatibility (deprecated)
export { BrowserAutomationServer as MCPServer };
