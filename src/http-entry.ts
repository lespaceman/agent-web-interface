#!/usr/bin/env node

/**
 * HTTP Entry Point
 *
 * Starts the MCP server with Streamable HTTP transport for multi-agent access.
 * Use `--transport http --port 3000` to enable.
 *
 * Each HTTP client connection gets its own McpServer + SessionController pair,
 * providing full session isolation for concurrent AI agents. Each session owns
 * its own browser instance, configured independently via navigate tool params.
 *
 * @module http-entry
 */

import http from 'node:http';
import express from 'express';
import { getServerConfig } from './server/server-config.js';
import { SessionRouter } from './gateway/session-router.js';
import { HttpGateway } from './gateway/http-gateway.js';
import { sendJsonRpcError } from './gateway/json-rpc-errors.js';
import { getLogger } from './shared/services/logging.service.js';
import { cleanupTempFiles } from './lib/temp-file.js';

const logger = getLogger();

/**
 * HTTP mode main entry point.
 *
 * Called from index.ts when `--transport http` is passed.
 */
export async function main(): Promise<void> {
  const config = getServerConfig();
  const port = config.port;
  const host = process.env.HTTP_HOST ?? '127.0.0.1';

  const router = new SessionRouter();

  const gateway = new HttpGateway({ router });

  const app = express();

  // Allowed origins for DNS rebinding protection (MCP spec MUST requirement).
  const allowedOriginHosts = new Set(['localhost', '127.0.0.1', '[::1]', host]);

  app.use('/mcp', express.json(), (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (!allowedOriginHosts.has(originUrl.hostname)) {
          sendJsonRpcError(res, 403, -32000, 'Forbidden: Origin not allowed');
          return;
        }
      } catch {
        sendJsonRpcError(res, 403, -32000, 'Forbidden: Invalid Origin header');
        return;
      }
    }
    next();
  });

  // MCP endpoint
  app.all('/mcp', async (req, res) => {
    try {
      if (req.method === 'POST') {
        await gateway.handlePost(req, res);
      } else if (req.method === 'GET') {
        await gateway.handleGet(req, res);
      } else if (req.method === 'DELETE') {
        await gateway.handleDelete(req, res);
      } else {
        sendJsonRpcError(res, 405, -32000, 'Method not allowed');
      }
    } catch (err) {
      logger.error('MCP request error', err instanceof Error ? err : undefined);
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, 'Internal server error');
      }
    }
  });

  // Health endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', sessions: gateway.sessionCount });
  });

  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => {
      logger.info(`HTTP MCP server listening on ${host}:${port}`);
      console.error(`HTTP MCP server listening on http://${host}:${port}/mcp`);
      resolve();
    });
  });

  const shutdown = async (signal: string) => {
    console.error(`Shutting down... (${signal})`);

    // Hard deadline — if graceful shutdown hangs, force exit
    const deadline = setTimeout(() => {
      console.error('Graceful shutdown timed out after 10s, forcing exit');
      process.exit(1);
    }, 10_000);
    deadline.unref();

    try {
      // Shut down gateway sessions first (closes MCP servers + transports + browsers)
      await gateway.shutdown();
      await cleanupTempFiles();
      server.close();
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
