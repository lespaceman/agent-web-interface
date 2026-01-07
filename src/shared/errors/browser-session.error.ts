/**
 * Browser Session Error
 *
 * Standardized error classification for browser session operations.
 * Provides error codes for programmatic handling and detailed messages for debugging.
 */

/**
 * Error codes for browser session operations
 */
export type BrowserErrorCode =
  | 'NOT_CONNECTED'
  | 'ALREADY_CONNECTED'
  | 'CONNECTION_FAILED'
  | 'CONNECTION_TIMEOUT'
  | 'INVALID_URL'
  | 'PAGE_NOT_FOUND'
  | 'PAGE_CLOSED'
  | 'CDP_ERROR'
  | 'CDP_TIMEOUT'
  | 'CDP_SESSION_CLOSED'
  | 'BROWSER_DISCONNECTED'
  | 'INVALID_STATE'
  | 'OPERATION_FAILED';

/**
 * Standardized error for browser session operations.
 *
 * @example
 * ```typescript
 * throw new BrowserSessionError(
 *   'Browser disconnected unexpectedly',
 *   'BROWSER_DISCONNECTED',
 *   originalError
 * );
 *
 * // Catching and handling by code
 * try {
 *   await session.connect();
 * } catch (error) {
 *   if (error instanceof BrowserSessionError) {
 *     switch (error.code) {
 *       case 'CONNECTION_TIMEOUT':
 *         console.log('Connection timed out, retrying...');
 *         break;
 *       case 'INVALID_URL':
 *         console.log('Invalid endpoint URL');
 *         break;
 *     }
 *   }
 * }
 * ```
 */
export class BrowserSessionError extends Error {
  /**
   * Error code for programmatic handling
   */
  readonly code: BrowserErrorCode;

  /**
   * Original error that caused this error (if any)
   */
  readonly cause?: Error;

  /**
   * Additional context for debugging
   */
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: BrowserErrorCode,
    cause?: Error,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'BrowserSessionError';
    this.code = code;
    this.cause = cause;
    this.context = context;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BrowserSessionError);
    }
  }

  /**
   * Create a JSON-serializable representation of the error
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      cause: this.cause
        ? {
            name: this.cause.name,
            message: this.cause.message,
          }
        : undefined,
      stack: this.stack,
    };
  }

  /**
   * Type guard to check if an error is a BrowserSessionError
   */
  static isBrowserSessionError(error: unknown): error is BrowserSessionError {
    return error instanceof BrowserSessionError;
  }

  /**
   * Create error for not connected state
   */
  static notConnected(context?: Record<string, unknown>): BrowserSessionError {
    return new BrowserSessionError('Browser not connected', 'NOT_CONNECTED', undefined, context);
  }

  /**
   * Create error for already connected state
   */
  static alreadyConnected(context?: Record<string, unknown>): BrowserSessionError {
    return new BrowserSessionError(
      'Browser already connected or connection in progress',
      'ALREADY_CONNECTED',
      undefined,
      context
    );
  }

  /**
   * Create error for connection failure
   */
  static connectionFailed(cause: Error, context?: Record<string, unknown>): BrowserSessionError {
    return new BrowserSessionError(
      `Failed to connect to browser: ${cause.message}`,
      'CONNECTION_FAILED',
      cause,
      context
    );
  }

  /**
   * Create error for connection timeout
   */
  static connectionTimeout(
    endpointUrl: string,
    timeoutMs: number,
    context?: Record<string, unknown>
  ): BrowserSessionError {
    return new BrowserSessionError(
      `Connection timeout after ${timeoutMs}ms: ${endpointUrl}`,
      'CONNECTION_TIMEOUT',
      undefined,
      { endpointUrl, timeoutMs, ...context }
    );
  }

  /**
   * Create error for invalid URL
   */
  static invalidUrl(url: string, context?: Record<string, unknown>): BrowserSessionError {
    return new BrowserSessionError(`Invalid endpoint URL: ${url}`, 'INVALID_URL', undefined, {
      url,
      ...context,
    });
  }

  /**
   * Create error for page not found
   */
  static pageNotFound(pageId: string, context?: Record<string, unknown>): BrowserSessionError {
    return new BrowserSessionError(`Page not found: ${pageId}`, 'PAGE_NOT_FOUND', undefined, {
      pageId,
      ...context,
    });
  }

  /**
   * Create error for CDP operation failure
   */
  static cdpError(
    method: string,
    cause: Error,
    context?: Record<string, unknown>
  ): BrowserSessionError {
    return new BrowserSessionError(`CDP command failed: ${method}`, 'CDP_ERROR', cause, {
      method,
      ...context,
    });
  }

  /**
   * Create error for CDP timeout
   */
  static cdpTimeout(
    method: string,
    timeoutMs: number,
    context?: Record<string, unknown>
  ): BrowserSessionError {
    return new BrowserSessionError(
      `CDP command timed out after ${timeoutMs}ms: ${method}`,
      'CDP_TIMEOUT',
      undefined,
      { method, timeoutMs, ...context }
    );
  }

  /**
   * Create error for browser disconnect
   */
  static browserDisconnected(context?: Record<string, unknown>): BrowserSessionError {
    return new BrowserSessionError(
      'Browser disconnected unexpectedly',
      'BROWSER_DISCONNECTED',
      undefined,
      context
    );
  }

  /**
   * Create error for invalid state transition
   */
  static invalidState(
    currentState: string,
    attemptedOperation: string,
    context?: Record<string, unknown>
  ): BrowserSessionError {
    return new BrowserSessionError(
      `Invalid operation "${attemptedOperation}" in state "${currentState}"`,
      'INVALID_STATE',
      undefined,
      { currentState, attemptedOperation, ...context }
    );
  }
}
