/**
 * CEF Bridge Interface
 *
 * This module connects to CEF's native Chrome DevTools Protocol server
 * using the chrome-remote-interface library.
 */

import { EventEmitter } from 'events';
import CDP from 'chrome-remote-interface';
import type { Client } from 'chrome-remote-interface';
import type {
  BBox,
  NetworkEvent,
  SafetySetPolicyParams as SafetyPolicy,
} from './browser-automation-mcp-types.js';

/**
 * CEFBridge connects to CEF's Chrome DevTools Protocol server
 * and provides methods to execute CDP commands.
 */
export class CEFBridge extends EventEmitter {
  private cdpClient?: Client;
  private readonly host: string;
  private readonly port: number;
  private safetyPolicy?: SafetyPolicy;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectDelay = 2000; // milliseconds
  private isConnecting = false;
  private isClosing = false;

  constructor() {
    super();
    this.host = process.env.CEF_BRIDGE_HOST ?? '127.0.0.1';
    this.port = Number(process.env.CEF_BRIDGE_PORT ?? '9223');

    this.connect().catch((error) => {
      console.error('[CEF Bridge] Failed to initialize:', error);
      this.scheduleReconnect();
    });
  }

  /**
   * Connect to the CEF CDP server
   */
  private async connect(): Promise<void> {
    if (this.isConnecting || this.isClosing) {
      return;
    }

    this.isConnecting = true;

    try {
      console.error(`[CEF Bridge] Connecting to CDP at ${this.host}:${this.port}`);

      // Connect to CDP
      this.cdpClient = await CDP({
        host: this.host,
        port: this.port,
      });

      console.error('[CEF Bridge] Connected successfully');
      this.reconnectAttempts = 0;

      // Enable domains we need
      await this.enableDomains();

      // Set up CDP event handlers
      this.setupEventHandlers();

      this.emit('connected');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[CEF Bridge] Connection failed: ${message}`);
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Enable required CDP domains
   */
  private async enableDomains(): Promise<void> {
    if (!this.cdpClient) {
      return;
    }

    try {
      // Enable Page domain for navigation events
      if (this.cdpClient.Page?.enable) {
        await this.cdpClient.Page.enable();
      }

      // DOM domain is enabled on-demand
      // Network domain is enabled on-demand

      console.error('[CEF Bridge] CDP domains enabled');
    } catch (error) {
      console.error('[CEF Bridge] Failed to enable domains:', error);
    }
  }

  /**
   * Set up CDP event handlers
   */
  private setupEventHandlers(): void {
    if (!this.cdpClient) {
      return;
    }

    // Handle CDP events and forward them
    const eventHandler = (method: string) => (params: object) => {
      this.emit('cdp-event', method, params as Record<string, unknown>);
    };

    // Network events
    if (this.cdpClient.Network) {
      this.cdpClient.on('Network.requestWillBeSent', eventHandler('Network.requestWillBeSent'));
      this.cdpClient.on('Network.responseReceived', eventHandler('Network.responseReceived'));
      this.cdpClient.on('Network.loadingFinished', eventHandler('Network.loadingFinished'));
      this.cdpClient.on('Network.loadingFailed', eventHandler('Network.loadingFailed'));
    }

    // Page events
    if (this.cdpClient.Page) {
      this.cdpClient.on('Page.loadEventFired', eventHandler('Page.loadEventFired'));
      this.cdpClient.on('Page.frameNavigated', eventHandler('Page.frameNavigated'));
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.isClosing || this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[CEF Bridge] Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      this.emit('disconnected');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;

    console.error(
      `[CEF Bridge] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[CEF Bridge] Reconnection failed:', error);
        this.scheduleReconnect();
      });
    }, delay);
  }

  /**
   * Execute a Chrome DevTools Protocol method
   *
   * @param method CDP method name (e.g., 'DOM.getDocument', 'Page.navigate')
   * @param params Parameters for the CDP method
   * @returns Promise resolving to CDP response
   */
  async executeDevToolsMethod<
    TResult = unknown,
    TParams extends Record<string, unknown> = Record<string, unknown>,
  >(method: string, params: TParams): Promise<TResult> {
    if (!this.cdpClient) {
      throw new Error('[CEF Bridge] Not connected to CDP server');
    }

    try {
      // Parse domain and method name
      const [domain, methodName] = method.split('.');
      if (!domain || !methodName) {
        throw new Error(`[CEF Bridge] Invalid CDP method: ${method}`);
      }

      console.error(`[CEF Bridge] Executing ${method}`, params);

      // Access the domain on the CDP client (using type assertion)
      const client = this.cdpClient as unknown as Record<string, Record<string, unknown>>;
      const domainObj = client[domain];
      if (!domainObj || typeof domainObj !== 'object') {
        throw new Error(`[CEF Bridge] CDP domain not available: ${domain}`);
      }

      // Access the method on the domain
      const methodFunc = domainObj[methodName];
      if (typeof methodFunc !== 'function') {
        throw new Error(`[CEF Bridge] CDP method not available: ${method}`);
      }

      // Execute the CDP method
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const result = await methodFunc(params);
      return result as TResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[CEF Bridge] Error executing ${method}:`, message);
      throw new Error(`[CEF Bridge] ${method} failed: ${message}`);
    }
  }

  /**
   * Capture a screenshot of the current page or a specific region
   *
   * @param region Optional region to capture
   * @returns Promise resolving to screenshot path or base64 data
   */
  async captureScreenshot(region?: BBox): Promise<string> {
    const response = await this.executeDevToolsMethod<{ data?: string }>('Page.captureScreenshot', {
      format: 'png',
      clip: region
        ? {
            x: region.x,
            y: region.y,
            width: region.w,
            height: region.h,
            scale: 1,
          }
        : undefined,
    });

    const base64Data = typeof response.data === 'string' ? response.data : '';
    const timestamp = Date.now();
    const path = `/tmp/screenshots/screenshot-${timestamp}.png`;

    // TODO: Save the base64 data to file
    // await this.saveFile(path, Buffer.from(base64Data, 'base64'));

    return base64Data.length > 0 ? path : '';
  }

  /**
   * Save a file to the file system
   *
   * @param path File path
   * @param data File data
   */
  async saveFile(path: string, data: Buffer): Promise<void> {
    // Use Node.js fs module for file operations
    const fs = await import('fs/promises');
    await fs.writeFile(path, data);
    console.error(`[CEF Bridge] Saved file to ${path}`);
  }

  /**
   * Read a file from the file system
   *
   * @param path File path
   * @returns Promise resolving to file data
   */
  async readFile(path: string): Promise<Buffer> {
    // Use Node.js fs module for file operations
    const fs = await import('fs/promises');
    const data = await fs.readFile(path);
    console.error(`[CEF Bridge] Read file from ${path}`);
    return data;
  }

  /**
   * Set safety policy for browser operations
   *
   * @param policy Safety policy configuration
   */
  setSafetyPolicy(policy: SafetyPolicy): void {
    this.safetyPolicy = policy;
    console.error('[CEF Bridge] Safety policy updated:', policy);
  }

  /**
   * Get current safety policy
   */
  getSafetyPolicy(): SafetyPolicy | undefined {
    return this.safetyPolicy;
  }

  /**
   * Observe network events matching patterns
   *
   * @param patterns URL patterns to observe
   * @returns Async iterable of network events
   */
  async *observeNetworkEvents(patterns?: string[]): AsyncIterable<NetworkEvent> {
    await this.executeDevToolsMethod('Network.enable', {});

    const eventQueue: NetworkEvent[] = [];
    let resume: (() => void) | null = null;

    const handler = (method: string, params: Record<string, unknown>) => {
      if (!method.startsWith('Network.')) {
        return;
      }

      const event = this.toNetworkEvent(method, params);
      if (!event) {
        return;
      }

      if (!patterns || patterns.some((pattern) => this.matchPattern(event.url, pattern))) {
        eventQueue.push(event);
        if (resume) {
          resume();
          resume = null;
        }
      }
    };

    this.on('cdp-event', handler);

    try {
      while (true) {
        if (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        } else {
          await new Promise<void>((resolve) => {
            resume = resolve;
          });
        }
      }
    } finally {
      this.off('cdp-event', handler);
    }
  }

  private toNetworkEvent(method: string, params: Record<string, unknown>): NetworkEvent | null {
    const requestId = typeof params.requestId === 'string' ? params.requestId : undefined;
    if (!requestId) {
      return null;
    }

    const request = this.ensureRecord(params.request);
    const response = this.ensureRecord(params.response);

    const urlCandidate =
      typeof response.url === 'string'
        ? response.url
        : typeof request.url === 'string'
          ? request.url
          : undefined;
    if (!urlCandidate) {
      return null;
    }

    const methodCandidate =
      typeof request.method === 'string' ? request.method : method.replace('Network.', '');
    const statusCandidate =
      typeof params.status === 'number'
        ? params.status
        : typeof response.status === 'number'
          ? response.status
          : undefined;

    return {
      requestId,
      url: urlCandidate,
      method: methodCandidate,
      status: statusCandidate,
      headers: this.extractHeaders(response.headers ?? request.headers),
    };
  }

  private extractHeaders(value: unknown): Record<string, string> | undefined {
    const record = this.ensureRecord(value);
    const entries = Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    );

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  /**
   * Check if URL matches pattern
   */
  private matchPattern(url: string, pattern: string): boolean {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return regex.test(url);
  }

  private ensureRecord(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  /**
   * Close connection to CDP server
   */
  async close(): Promise<void> {
    this.isClosing = true;

    if (this.cdpClient) {
      try {
        await this.cdpClient.close();
        console.error('[CEF Bridge] Connection closed');
      } catch (error) {
        console.error('[CEF Bridge] Error closing connection:', error);
      } finally {
        this.cdpClient = undefined;
      }
    }

    this.emit('closed');
  }
}
