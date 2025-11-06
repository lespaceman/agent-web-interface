/**
 * Error Response Utilities
 *
 * Utilities for creating structured error responses for MCP tools
 */

import { McpError, ErrorCode, ErrorSeverity } from './index.js';

/**
 * MCP Tool Response type
 */
export interface McpToolResponse {
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Create a structured error response for MCP tools
 *
 * @param error - Error to convert to structured response
 * @param includeStack - Whether to include stack trace (default: process.env.NODE_ENV !== 'production')
 * @returns Structured MCP tool response with isError flag
 */
export function createErrorResponse(
  error: unknown,
  includeStack: boolean = process.env.NODE_ENV !== 'production'
): McpToolResponse {
  // Convert to McpError if not already
  let mcpError: McpError;
  if (error instanceof McpError) {
    mcpError = error;
  } else if (error instanceof Error) {
    mcpError = McpError.fromError(error);
  } else {
    mcpError = new McpError(String(error), ErrorCode.UNKNOWN_ERROR);
  }

  // Get structured error data
  const structured = mcpError.toStructured();

  // Remove stack if not needed
  if (!includeStack) {
    delete structured.stack;
  }

  // Format error message for text content
  const textParts: string[] = [
    `Error: ${structured.error}`,
    `Code: ${structured.code}`,
    `Severity: ${structured.severity}`,
  ];

  if (structured.details && Object.keys(structured.details).length > 0) {
    textParts.push(`Details: ${JSON.stringify(structured.details, null, 2)}`);
  }

  if (includeStack && structured.stack) {
    textParts.push(`\nStack trace:\n${structured.stack}`);
  }

  return {
    content: [
      {
        type: 'text',
        text: textParts.join('\n'),
      },
    ],
    structuredContent: structured,
    isError: true,
  };
}

/**
 * Wrap a handler function with error handling
 *
 * Automatically converts thrown errors to structured MCP error responses
 *
 * @param handler - Async handler function to wrap
 * @returns Wrapped handler that returns McpToolResponse
 */
export function withErrorHandling<TInput, TOutput>(
  handler: (input: TInput) => Promise<TOutput>
): (input: TInput) => Promise<McpToolResponse> {
  return async (input: TInput): Promise<McpToolResponse> => {
    try {
      const output = await handler(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as Record<string, unknown>,
      };
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

/**
 * Create a success response with structured output
 *
 * @param output - Output data to return
 * @returns Structured MCP tool response
 */
export function createSuccessResponse(output: unknown): McpToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
    structuredContent: output as Record<string, unknown>,
    isError: false,
  };
}

/**
 * Helper to safely execute a function and return either success or error response
 *
 * @param fn - Function to execute
 * @returns McpToolResponse (success or error)
 */
export async function safeExecute<T>(fn: () => Promise<T>): Promise<McpToolResponse> {
  try {
    const result = await fn();
    return createSuccessResponse(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}

/**
 * Create a partial error response (some operations succeeded, some failed)
 *
 * @param results - Array of results with success/error information
 * @param message - Overall message
 * @returns Structured MCP tool response
 */
export function createPartialErrorResponse(
  results: { success: boolean; error?: string; [key: string]: unknown }[],
  message: string
): McpToolResponse {
  const hasErrors = results.some((r) => !r.success);
  const allFailed = results.every((r) => !r.success);

  const severity = allFailed
    ? ErrorSeverity.ERROR
    : hasErrors
      ? ErrorSeverity.WARNING
      : ErrorSeverity.INFO;

  const output = {
    message,
    results,
    summary: {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    },
    severity,
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
    structuredContent: output,
    isError: allFailed,
  };
}
