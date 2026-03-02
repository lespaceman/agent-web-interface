/**
 * Tool Result Types
 *
 * Discriminated union for tool results that go beyond plain text.
 * Enables the MCP server to return different content types (text, image, file)
 * while keeping tool handlers decoupled from MCP protocol details.
 */

/**
 * Image result - returned inline as MCP ImageContent (base64).
 * Used when image data is small enough to embed directly (<2MB).
 */
export interface ImageResult {
  readonly type: 'image';
  /** Base64-encoded image data */
  readonly data: string;
  /** MIME type (e.g., 'image/png', 'image/jpeg') */
  readonly mimeType: string;
  /** Size in bytes */
  readonly sizeBytes: number;
}

/**
 * File result - returned as a text message with file path.
 * Used when image data is too large for inline embedding (>=2MB).
 */
export interface FileResult {
  readonly type: 'file';
  /** Absolute path to the saved file */
  readonly path: string;
  /** MIME type of the saved file */
  readonly mimeType: string;
  /** Size in bytes */
  readonly sizeBytes: number;
}

/**
 * Composite result - returned as multi-content (text + image).
 * Used when a tool needs to return both structured data and a screenshot.
 */
export interface CompositeResult {
  readonly type: 'composite';
  /** JSON-encoded structured data (e.g., canvas metadata) */
  readonly text: string;
  /** Annotated screenshot */
  readonly image: ImageResult | FileResult;
}

/**
 * Discriminated union of all non-text tool result types.
 */
export type ToolResult = ImageResult | FileResult | CompositeResult;

/**
 * Type guard for ImageResult.
 */
export function isImageResult(result: unknown): result is ImageResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    'type' in result &&
    (result as Record<string, unknown>).type === 'image' &&
    'data' in result &&
    'mimeType' in result
  );
}

/**
 * Type guard for CompositeResult.
 */
export function isCompositeResult(result: unknown): result is CompositeResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    'type' in result &&
    (result as Record<string, unknown>).type === 'composite' &&
    'text' in result &&
    'image' in result
  );
}

/**
 * Type guard for FileResult.
 */
export function isFileResult(result: unknown): result is FileResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    'type' in result &&
    (result as Record<string, unknown>).type === 'file' &&
    'path' in result &&
    'mimeType' in result
  );
}
