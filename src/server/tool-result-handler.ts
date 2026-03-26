/**
 * Tool Result Handler
 *
 * Shared result-wrapping logic for converting tool handler return values
 * into MCP-compatible content arrays. Used by both BrowserAutomationServer
 * (stdio) and HttpToolRegistrar (HTTP) to avoid duplication.
 *
 * @module server/tool-result-handler
 */

import { isCompositeResult, isImageResult, isFileResult } from '../tools/tool-result.types.js';
import { getLogger } from '../shared/services/logging.service.js';

/** MCP text content */
interface TextContent {
  readonly type: 'text';
  readonly text: string;
}

/** MCP image content */
interface ImageContent {
  readonly type: 'image';
  readonly data: string;
  readonly mimeType: string;
}

/** Union of MCP content types produced by this module */
export type Content = TextContent | ImageContent;

/** Formatted tool result ready for MCP response */
export interface FormattedToolResult {
  [key: string]: unknown;
  content: Content[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Format a tool handler result into an MCP-compatible content array.
 *
 * Handles CompositeResult, ImageResult, FileResult, structured output,
 * plain strings, and arbitrary objects (JSON-stringified).
 *
 * @param result - The raw return value from a tool handler
 * @param hasOutputSchema - Whether the tool definition has an outputSchema
 * @returns MCP-compatible content array with optional structuredContent
 */
export function formatToolResult(result: unknown, hasOutputSchema = false): FormattedToolResult {
  // Composite result - return as multi-content (text + image)
  if (isCompositeResult(result)) {
    if (isImageResult(result.image)) {
      return {
        content: [
          { type: 'text' as const, text: result.text },
          {
            type: 'image' as const,
            data: result.image.data,
            mimeType: result.image.mimeType,
          },
        ],
      };
    } else {
      // FileResult fallback - return text + file path
      const sizeMB = (result.image.sizeBytes / 1024 / 1024).toFixed(2);
      return {
        content: [
          { type: 'text' as const, text: result.text },
          {
            type: 'text' as const,
            text: `Screenshot saved to: ${result.image.path} (${sizeMB} MB, ${result.image.mimeType})`,
          },
        ],
      };
    }
  }

  // Image result - return as MCP ImageContent (inline base64)
  if (isImageResult(result)) {
    return {
      content: [
        {
          type: 'image' as const,
          data: result.data,
          mimeType: result.mimeType,
        },
      ],
    };
  }

  // File result - return file path as text (for large screenshots)
  if (isFileResult(result)) {
    const sizeMB = (result.sizeBytes / 1024 / 1024).toFixed(2);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Screenshot saved to: ${result.path} (${sizeMB} MB, ${result.mimeType})`,
        },
      ],
    };
  }

  // When outputSchema is defined, return structuredContent for MCP validation
  if (hasOutputSchema) {
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
}

/**
 * Format an error into an MCP-compatible error response.
 *
 * @param error - The caught error
 * @returns MCP-compatible error content
 */
export function formatToolError(error: unknown): FormattedToolResult {
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

/**
 * Wrap a tool handler with logging, timing, and MCP result formatting.
 *
 * Shared by both BrowserAutomationServer (stdio) and HttpToolRegistrar (HTTP)
 * to avoid duplicating the try/catch/timing/logging boilerplate.
 *
 * @param name - Tool name used in log messages
 * @param handler - The raw tool handler function
 * @param hasOutputSchema - Whether the tool definition has an outputSchema
 * @returns A wrapped handler that returns a FormattedToolResult
 */
export function wrapToolHandler<T>(
  name: string,
  handler: (input: T) => Promise<unknown>,
  hasOutputSchema: boolean
): (input: T) => Promise<FormattedToolResult> {
  const logger = getLogger();
  return async (input: T) => {
    const startTime = Date.now();
    logger.debug(`Executing tool: ${name}`);
    try {
      const result = await handler(input);
      const executionTime = Date.now() - startTime;
      logger.debug(`Tool ${name} completed in ${executionTime}ms`);
      return formatToolResult(result, hasOutputSchema);
    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error(
        `Tool ${name} failed after ${executionTime}ms`,
        error instanceof Error ? error : undefined
      );
      return formatToolError(error);
    }
  };
}
