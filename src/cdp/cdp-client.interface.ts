/**
 * CDP Client Interface
 *
 * Generic interface for Chrome DevTools Protocol communication.
 * Enables dependency injection and testability by abstracting
 * the underlying CDP transport (Playwright, chrome-remote-interface, etc.).
 */

import type { Protocol } from 'devtools-protocol';

/**
 * Handler function for CDP events
 */
export type CdpEventHandler<T = Record<string, unknown>> = (params: T) => void;

/**
 * Common CDP method signatures for type-safe usage.
 * Extend this map to add more typed methods.
 */
export interface CdpMethodMap {
  // DOM methods
  'DOM.getDocument': {
    params: Protocol.DOM.GetDocumentRequest;
    result: Protocol.DOM.GetDocumentResponse;
  };
  'DOM.describeNode': {
    params: Protocol.DOM.DescribeNodeRequest;
    result: Protocol.DOM.DescribeNodeResponse;
  };
  'DOM.querySelector': {
    params: Protocol.DOM.QuerySelectorRequest;
    result: Protocol.DOM.QuerySelectorResponse;
  };
  'DOM.querySelectorAll': {
    params: Protocol.DOM.QuerySelectorAllRequest;
    result: Protocol.DOM.QuerySelectorAllResponse;
  };
  'DOM.getBoxModel': {
    params: Protocol.DOM.GetBoxModelRequest;
    result: Protocol.DOM.GetBoxModelResponse;
  };
  'DOM.getOuterHTML': {
    params: Protocol.DOM.GetOuterHTMLRequest;
    result: Protocol.DOM.GetOuterHTMLResponse;
  };
  'DOM.scrollIntoViewIfNeeded': {
    params: Protocol.DOM.ScrollIntoViewIfNeededRequest;
    result: void;
  };
  'DOM.resolveNode': {
    params: Protocol.DOM.ResolveNodeRequest;
    result: Protocol.DOM.ResolveNodeResponse;
  };

  // Page methods
  'Page.navigate': {
    params: Protocol.Page.NavigateRequest;
    result: Protocol.Page.NavigateResponse;
  };
  'Page.captureScreenshot': {
    params: Protocol.Page.CaptureScreenshotRequest;
    result: Protocol.Page.CaptureScreenshotResponse;
  };
  'Page.getLayoutMetrics': {
    params: undefined;
    result: Protocol.Page.GetLayoutMetricsResponse;
  };
  'Page.enable': {
    params: undefined;
    result: void;
  };
  'Page.getFrameTree': {
    params: undefined;
    result: Protocol.Page.GetFrameTreeResponse;
  };

  // CSS methods
  'CSS.getComputedStyleForNode': {
    params: Protocol.CSS.GetComputedStyleForNodeRequest;
    result: Protocol.CSS.GetComputedStyleForNodeResponse;
  };

  // Accessibility methods
  'Accessibility.getFullAXTree': {
    params: Protocol.Accessibility.GetFullAXTreeRequest;
    result: Protocol.Accessibility.GetFullAXTreeResponse;
  };

  // Runtime methods
  'Runtime.evaluate': {
    params: Protocol.Runtime.EvaluateRequest;
    result: Protocol.Runtime.EvaluateResponse;
  };
  'Runtime.callFunctionOn': {
    params: Protocol.Runtime.CallFunctionOnRequest;
    result: Protocol.Runtime.CallFunctionOnResponse;
  };

  // Input methods
  'Input.dispatchMouseEvent': {
    params: Protocol.Input.DispatchMouseEventRequest;
    result: void;
  };
  'Input.dispatchKeyEvent': {
    params: Protocol.Input.DispatchKeyEventRequest;
    result: void;
  };
  'Input.insertText': {
    params: Protocol.Input.InsertTextRequest;
    result: void;
  };
}

/**
 * Common CDP event signatures for type-safe event handling.
 */
export interface CdpEventMap {
  'Page.loadEventFired': Protocol.Page.LoadEventFiredEvent;
  'Page.domContentEventFired': Protocol.Page.DomContentEventFiredEvent;
  'Page.frameNavigated': Protocol.Page.FrameNavigatedEvent;
  'Page.frameDetached': Protocol.Page.FrameDetachedEvent;
  'DOM.documentUpdated': undefined;
  'DOM.childNodeInserted': Protocol.DOM.ChildNodeInsertedEvent;
  'DOM.childNodeRemoved': Protocol.DOM.ChildNodeRemovedEvent;
  'Network.requestWillBeSent': Protocol.Network.RequestWillBeSentEvent;
  'Network.responseReceived': Protocol.Network.ResponseReceivedEvent;
}

/**
 * Generic interface for CDP communication.
 * Allows dependency injection of different CDP implementations.
 */
export interface CdpClient {
  /**
   * Send a CDP command and wait for response.
   *
   * @param method - CDP method name (e.g., 'DOM.getDocument', 'Page.navigate')
   * @param params - Optional parameters for the CDP method
   * @returns Promise resolving to the CDP response
   * @throws Error if session is closed or CDP command fails
   *
   * @example
   * ```typescript
   * // Type-safe usage with mapped methods
   * const doc = await cdp.send('DOM.getDocument', { depth: -1 });
   *
   * // Generic usage with explicit type
   * const result = await cdp.send<CustomResponse>('Custom.method', { param: 'value' });
   * ```
   */
  send<M extends keyof CdpMethodMap>(
    method: M,
    params?: CdpMethodMap[M]['params']
  ): Promise<CdpMethodMap[M]['result']>;
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;

  /**
   * Subscribe to CDP events.
   *
   * @param event - CDP event name (e.g., 'Page.loadEventFired', 'DOM.documentUpdated')
   * @param handler - Callback function invoked when event fires
   *
   * @example
   * ```typescript
   * cdp.on('Page.loadEventFired', (params) => {
   *   console.log('Page loaded:', params);
   * });
   * ```
   */
  on(event: string, handler: CdpEventHandler): void;

  /**
   * Unsubscribe from CDP events.
   *
   * @param event - CDP event name
   * @param handler - The same handler function passed to `on()`
   */
  off(event: string, handler: CdpEventHandler): void;

  /**
   * Subscribe to a CDP event once (auto-unsubscribes after first fire).
   *
   * @param event - CDP event name
   * @param handler - Callback function invoked once when event fires
   *
   * @example
   * ```typescript
   * cdp.once('Page.loadEventFired', (params) => {
   *   console.log('Page loaded (one-time):', params);
   * });
   * ```
   */
  once(event: string, handler: CdpEventHandler): void;

  /**
   * Close/detach the CDP session.
   * After calling close(), all subsequent send() calls will throw.
   */
  close(): Promise<void>;

  /**
   * Check if session is still active.
   *
   * @returns true if the session is connected and usable
   */
  isActive(): boolean;
}

/**
 * Options for creating a CDP client
 */
export interface CdpClientOptions {
  /** Timeout for CDP commands in milliseconds (default: 30000) */
  timeout?: number;
  /** List of CDP domains that don't require explicit .enable() calls */
  domainsWithoutEnable?: string[];
}
