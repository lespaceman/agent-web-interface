/**
 * HTTP Gateway
 *
 * Supports multiple concurrent AI agents via Streamable HTTP transport.
 * Each client connection gets its own McpServer instance with tools
 * closing over a dedicated SessionController.
 *
 * Architecture: per-session McpServer - each HTTP client connection gets
 * its own McpServer + transport pair. This avoids the problem that the
 * MCP SDK does not expose which transport triggered a tool call.
 *
 * @module gateway/http-gateway
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShape } from 'zod';
import { SessionRouter } from './session-router.js';
import { registerAllTools } from '../tools/tool-registration.js';
import type { ToolRegistrar } from '../server/tool-registrar.types.js';
import type { SessionController } from '../session/session-controller.js';
import { wrapToolHandler } from '../server/tool-result-handler.js';
import { getLogger } from '../shared/services/logging.service.js';
import { VERSION } from '../shared/version.js';

const logger = getLogger();

interface HttpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  controller: SessionController;
}

export interface HttpGatewayOptions {
  router: SessionRouter;
  ensureBrowser: () => Promise<void>;
  version?: string;
}

/**
 * Adapts McpServer.registerTool to the ToolRegistrar interface,
 * adding the same logging/error-handling/result-type wrapping that
 * BrowserAutomationServer provides for stdio.
 */
class HttpToolRegistrar implements ToolRegistrar {
  constructor(private readonly server: McpServer) {}

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
}

export class HttpGateway {
  private readonly sessions = new Map<string, HttpSession>();
  private readonly router: SessionRouter;
  private readonly ensureBrowser: () => Promise<void>;
  private readonly version: string;

  constructor(options: HttpGatewayOptions) {
    this.router = options.router;
    this.ensureBrowser = options.ensureBrowser;
    this.version = options.version ?? VERSION;

    // When the router evicts an idle session, clean up the gateway-owned
    // transport and McpServer so the sessions map does not leak entries.
    this.router.setOnSessionDestroyed((sessionId: string) => {
      void this.cleanupGatewaySession(sessionId);
    });
  }

  /**
   * Handle POST requests to the /mcp endpoint.
   *
   * Routing logic follows the MCP Streamable HTTP specification:
   * - Requests with a valid mcp-session-id are routed to the existing transport
   * - POST without a session ID that contains an initialize request creates a new session
   * - All other requests are rejected with 400
   */
  async handlePost(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      if (sessionId && this.sessions.has(sessionId)) {
        // Route to existing session transport
        const session = this.sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res, req.body);
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New connection: create transport + McpServer + SessionController
        await this.createNewSession(req, res);
      } else if (sessionId && !this.sessions.has(sessionId)) {
        // Unknown session ID
        res.status(404).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Session not found. The session may have expired or been closed.',
          },
          id: null,
        });
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
      }
    } catch (error) {
      logger.error('Error handling MCP POST request', error instanceof Error ? error : undefined);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  }

  /**
   * Handle GET requests to the /mcp endpoint (SSE streams).
   */
  async handleGet(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !this.sessions.has(sessionId)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: Invalid or missing session ID',
        },
        id: null,
      });
      return;
    }

    const session = this.sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  }

  /**
   * Handle DELETE requests to the /mcp endpoint (session termination).
   */
  async handleDelete(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !this.sessions.has(sessionId)) {
      res.status(404).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Session not found',
        },
        id: null,
      });
      return;
    }

    const session = this.sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  }

  private async createNewSession(req: Request, res: Response): Promise<void> {
    // Mutable references set during the onsessioninitialized callback.
    // The callback fires synchronously during handleRequest() when the
    // MCP initialize handshake completes, so these are populated before
    // any tool invocation can occur.
    let controller: SessionController | null = null;
    let sessionId: string | null = null;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: async (sid: string) => {
        sessionId = sid;
        // Ensure browser is launched and pool is initialized before creating
        // the session, since createSession() acquires a BrowserContext from the pool.
        await this.ensureBrowser();
        controller = await this.router.createSession(sid);
        this.sessions.set(sid, { server: mcpServer, transport, controller });
        logger.info('HTTP session initialized', { sessionId: sid });
      },
    });

    const mcpServer = new McpServer(
      {
        name: 'agent-web-interface',
        version: this.version,
      },
      {
        capabilities: {
          logging: {},
        },
      }
    );

    // Register all 22 tools with logging/error wrapping via HttpToolRegistrar.
    // The resolver lazily reads the mutable `controller` reference which is
    // guaranteed to be set by onsessioninitialized before any tool runs.
    const registrar = new HttpToolRegistrar(mcpServer);
    registerAllTools(
      registrar,
      () => {
        if (!controller) throw new Error('Session not initialized');
        return controller;
      },
      this.ensureBrowser
    );

    // Connect transport to server before handling the first request
    await mcpServer.connect(transport);

    // Clean up when transport closes
    transport.onclose = () => {
      if (sessionId) {
        void this.closeSession(sessionId);
      }
    };

    // Handle the initial request — onsessioninitialized fires during this call
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!sessionId) await this.teardownOrphanedSession(mcpServer, transport);
      throw err;
    }

    // If onsessioninitialized never fired (e.g., non-initialize request hit this path),
    // clean up the leaked server and transport.
    if (!sessionId) {
      await this.teardownOrphanedSession(mcpServer, transport);
    }
  }

  private async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Remove from the map first so the onSessionDestroyed callback
    // (fired by router.destroySession) is a harmless no-op.
    this.sessions.delete(sessionId);

    try {
      await session.server.close();
    } catch (err) {
      logger.error('Error closing HTTP session server', err instanceof Error ? err : undefined);
    }

    await this.router.destroySession(sessionId);
    logger.info('HTTP session closed', { sessionId });
  }

  /**
   * Clean up gateway-owned resources (McpServer + transport) for a session
   * that was already destroyed by the router (e.g., idle eviction).
   * Unlike closeSession(), this does NOT call router.destroySession().
   */
  private async cleanupGatewaySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);

    try {
      await session.transport.close?.();
    } catch {
      // Transport may already be closed
    }

    try {
      await session.server.close();
    } catch (err) {
      logger.error(
        'Error closing evicted HTTP session server',
        err instanceof Error ? err : undefined
      );
    }

    logger.info('Gateway session cleaned up after eviction', { sessionId });
  }

  private async teardownOrphanedSession(
    mcpServer: McpServer,
    transport: StreamableHTTPServerTransport
  ): Promise<void> {
    await mcpServer.close().catch(() => {
      /* intentionally swallowed */
    });
    await transport.close?.().catch(() => {
      /* intentionally swallowed */
    });
  }

  /** Get count of active HTTP sessions */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Shutdown all HTTP sessions */
  async shutdown(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.closeSession(id)));
  }
}
