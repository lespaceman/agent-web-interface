/**
 * MCP Server
 *
 * Minimal MCP server shell for the Browser Automation MCP Server.
 * Tool registrations will be added as the new semantic snapshot system is built.
 */

import { EventEmitter } from 'events';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ZodRawShape } from 'zod';
import {
  getLogger,
  type LogLevel,
  type McpNotificationSender,
} from '../shared/services/logging.service.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ToolRegistrar } from './tool-registrar.types.js';
import { wrapToolHandler } from './tool-result-handler.js';

export interface ServerConfig {
  name: string;
  version: string;
}

/**
 * Browser Automation MCP Server
 *
 * Minimal shell - tool handlers will be registered by the new semantic snapshot system.
 */
export interface SessionStartEvent {
  clientInfo: { name: string; version: string } | undefined;
}

export interface BrowserAutomationServerEvents {
  'session:start': [event: SessionStartEvent];
  'session:end': [];
}

export class BrowserAutomationServer
  extends EventEmitter
  implements McpNotificationSender, ToolRegistrar
{
  private server: McpServer;
  private transport: StdioServerTransport;

  constructor(private readonly config: ServerConfig) {
    super();

    // Create MCP server instance
    // Note: Tools capability is auto-registered when tools are added via .tool()
    // But logging capability must be declared explicitly for setRequestHandler to work
    this.server = new McpServer(
      {
        name: config.name,
        version: config.version,
      },
      {
        capabilities: {
          logging: {},
        },
      }
    );

    // Create stdio transport
    this.transport = new StdioServerTransport();

    // Register logging request handler
    this.registerLoggingHandlers();

    // Register a minimal ping tool (required for tools/list to work)
    this.registerPingTool();

    // Wire up MCP lifecycle hooks
    this.registerLifecycleHooks();

    // Wire up logging service to MCP server
    const logger = getLogger();
    logger.setMcpServer(this);
  }

  /**
   * Register a minimal ping tool
   * This is required because McpServer only sets up tools/list handler
   * when at least one tool is registered.
   */
  private registerPingTool(): void {
    this.server.tool('ping', 'Check if the server is responsive', () => ({
      content: [{ type: 'text' as const, text: 'pong' }],
    }));
  }

  /**
   * Register a custom tool with the MCP server
   */
  registerTool(
    name: string,
    definition: {
      title: string;
      description?: string;
      inputSchema: ZodRawShape;
      outputSchema?: ZodRawShape;
    },
    handler: (input: unknown) => Promise<unknown>
  ): void {
    const wrapped = wrapToolHandler(name, handler, !!definition.outputSchema);
    this.server.registerTool(
      name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
      },
      wrapped
    );
  }

  /**
   * Send logging message notification via MCP protocol
   */
  async sendLoggingMessage(params: {
    level: LogLevel;
    logger?: string;
    data: Record<string, unknown>;
  }): Promise<void> {
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
    this.server.server.setRequestHandler(SetLevelRequestSchema, (request) => {
      const logger = getLogger();
      const { level } = request.params;
      logger.setMinLevel(level as LogLevel);
      logger.info(`Log level set to: ${level}`);
      return {};
    });
  }

  /**
   * Wire up MCP protocol lifecycle hooks.
   * Emits 'session:start' after MCP handshake and 'session:end' on connection close.
   */
  private registerLifecycleHooks(): void {
    const logger = getLogger();

    this.server.server.oninitialized = () => {
      const clientInfo = this.server.server.getClientVersion();
      logger.info('MCP session initialized', { clientInfo });
      this.emit('session:start', { clientInfo });
    };

    this.server.server.onclose = () => {
      logger.info('MCP session closed');
      this.emit('session:end');
    };
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    await this.server.connect(this.transport);
    console.error(`${this.config.name} v${this.config.version} started`);
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    await this.server.close();
  }
}
