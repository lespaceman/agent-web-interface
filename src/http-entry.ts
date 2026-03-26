#!/usr/bin/env node

/**
 * HTTP Entry Point
 *
 * Starts the MCP server with Streamable HTTP transport for multi-agent access.
 * Use `--transport http --port 3000` to enable.
 *
 * Each HTTP client connection gets its own McpServer + SessionController pair,
 * providing full session isolation for concurrent AI agents.
 *
 * @module http-entry
 */

import http from 'node:http';
import express from 'express';
import {
  getServerConfig,
  getSessionManager,
  ensureBrowserForTools,
  isSessionManagerInitialized,
} from './server/server-config.js';
import { SessionRouter } from './gateway/session-router.js';
import { BrowserPool } from './browser/browser-pool.js';
import { HttpGateway } from './gateway/http-gateway.js';
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

  const session = getSessionManager();
  const browserPool = new BrowserPool();

  // Ensure the browser is running and the pool is initialized.
  // Both the browser and pool are lazily started — the browser is
  // launched on demand, and the pool requires a running browser.
  const ensureBrowserAndPool = async () => {
    await ensureBrowserForTools();
    if (browserPool.state === 'idle') {
      browserPool.initialize(session);
    }
  };

  const router = new SessionRouter(session, {
    browserPool,
    ensureBrowser: ensureBrowserAndPool,
  });

  const gateway = new HttpGateway({
    router,
    ensureBrowser: ensureBrowserAndPool,
  });

  const app = express();

  // Parse JSON bodies for MCP protocol messages
  app.use(express.json());

  // Origin validation to prevent DNS rebinding attacks (MCP spec MUST requirement).
  // If Origin header is present, it must match the server's host.
  app.use('/mcp', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const allowedHosts = ['localhost', '127.0.0.1', '[::1]', host];
        if (!allowedHosts.includes(originUrl.hostname)) {
          res.status(403).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Forbidden: Origin not allowed' },
            id: null,
          });
          return;
        }
      } catch {
        res.status(403).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Forbidden: Invalid Origin header' },
          id: null,
        });
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
        res.status(405).json({ error: 'Method not allowed' });
      }
    } catch (err) {
      logger.error('MCP request error', err instanceof Error ? err : undefined);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
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
      // Shut down gateway sessions first (closes MCP servers + transports)
      await gateway.shutdown();
      await cleanupTempFiles();
      // Release browser contexts before shutting down the browser itself
      await browserPool.shutdown();
      if (isSessionManagerInitialized()) {
        await session.shutdown();
      }
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
