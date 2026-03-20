/**
 * Tool Registrar Types
 *
 * Defines the minimal interface for registering MCP tools.
 * Used by both BrowserAutomationServer (stdio) and HttpGateway (HTTP).
 *
 * @module server/tool-registrar.types
 */

import type { ZodRawShape } from 'zod';

/**
 * Minimal interface for registering tools on an MCP server.
 *
 * Implemented by:
 * - BrowserAutomationServer (stdio transport with logging/error wrapping)
 * - HttpToolRegistrar (HTTP transport, wraps McpServer.registerTool)
 */
export interface ToolRegistrar {
  registerTool(
    name: string,
    definition: {
      title: string;
      description?: string;
      inputSchema: ZodRawShape;
      outputSchema?: ZodRawShape;
    },
    handler: (input: unknown) => Promise<unknown>
  ): void;
}
