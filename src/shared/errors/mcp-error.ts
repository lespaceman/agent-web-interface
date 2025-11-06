/**
 * MCP Error Types
 *
 * Structured error types for MCP tool responses with proper error handling
 */

import { ErrorCode, ErrorSeverity } from './error-codes.js';

/**
 * Base MCP Error class
 *
 * Extends Error with additional metadata for structured error responses
 */
export class McpError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    public readonly severity: ErrorSeverity = ErrorSeverity.ERROR,
    public readonly details?: Record<string, unknown>,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'McpError';

    // Maintain proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, McpError);
    }
  }

  /**
   * Convert to structured error object for MCP responses
   */
  toStructured(): {
    error: string;
    code: ErrorCode;
    severity: ErrorSeverity;
    details?: Record<string, unknown>;
    stack?: string;
  } {
    return {
      error: this.message,
      code: this.code,
      severity: this.severity,
      details: this.details,
      stack: this.stack,
    };
  }

  /**
   * Create from standard Error
   */
  static fromError(
    error: Error,
    code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    severity: ErrorSeverity = ErrorSeverity.ERROR
  ): McpError {
    return new McpError(error.message, code, severity, undefined, error);
  }
}

/**
 * Domain-specific error classes
 */

export class BrowserError extends McpError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.BROWSER_NOT_CONNECTED,
    details?: Record<string, unknown>
  ) {
    super(message, code, ErrorSeverity.ERROR, details);
    this.name = 'BrowserError';
  }
}

export class ElementError extends McpError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.ELEMENT_NOT_FOUND,
    details?: Record<string, unknown>
  ) {
    super(message, code, ErrorSeverity.WARNING, details);
    this.name = 'ElementError';
  }
}

export class NavigationError extends McpError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.NAVIGATION_FAILED,
    details?: Record<string, unknown>
  ) {
    super(message, code, ErrorSeverity.ERROR, details);
    this.name = 'NavigationError';
  }
}

export class InteractionError extends McpError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.CLICK_FAILED,
    details?: Record<string, unknown>
  ) {
    super(message, code, ErrorSeverity.WARNING, details);
    this.name = 'InteractionError';
  }
}

export class FormError extends McpError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.FORM_NOT_FOUND,
    details?: Record<string, unknown>
  ) {
    super(message, code, ErrorSeverity.WARNING, details);
    this.name = 'FormError';
  }
}

export class SessionError extends McpError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.SESSION_NOT_FOUND,
    details?: Record<string, unknown>
  ) {
    super(message, code, ErrorSeverity.ERROR, details);
    this.name = 'SessionError';
  }
}

export class TimeoutError extends McpError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.TIMEOUT,
    details?: Record<string, unknown>
  ) {
    super(message, code, ErrorSeverity.WARNING, details);
    this.name = 'TimeoutError';
  }
}
