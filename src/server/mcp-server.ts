/**
 * MCP Server
 *
 * Minimal MCP server shell for the Browser Automation MCP Server.
 * Tool registrations will be added as the new semantic snapshot system is built.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ZodRawShape } from 'zod';
import {
  getLogger,
  type LogLevel,
  type McpNotificationSender,
} from '../shared/services/logging.service.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export interface ServerConfig {
  name: string;
  version: string;
}

/**
 * Browser Automation MCP Server
 *
 * Minimal shell - tool handlers will be registered by the new semantic snapshot system.
 */
export class BrowserAutomationServer implements McpNotificationSender {
  private server: McpServer;
  private transport: StdioServerTransport;

  constructor(private readonly config: ServerConfig) {
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
    this.server.registerTool(
      name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
      },
      async (input) => {
        const logger = getLogger();
        const startTime = Date.now();

        try {
          logger.debug(`Executing tool: ${name}`);
          const result = await handler(input);
          const executionTime = Date.now() - startTime;
          logger.debug(`Tool ${name} completed in ${executionTime}ms`);

          // When outputSchema is defined, return structuredContent for MCP validation
          if (definition.outputSchema) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result) }],
              structuredContent: result as Record<string, unknown>,
            };
          }

          // If result is already a string (e.g., XML), use it directly
          // Otherwise JSON.stringify it
          const textContent = typeof result === 'string' ? result : JSON.stringify(result);
          return {
            content: [{ type: 'text' as const, text: textContent }],
          };
        } catch (error) {
          const executionTime = Date.now() - startTime;
          logger.error(
            `Tool ${name} failed after ${executionTime}ms`,
            error instanceof Error ? error : undefined
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: error instanceof Error ? error.message : String(error),
                }),
              },
            ],
            isError: true,
          };
        }
      }
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
