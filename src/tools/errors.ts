/**
 * Tool Error Classes
 *
 * Standardized errors for browser tools with consistent formatting.
 * All errors follow the pattern: `${context}: ${identifier}` or `${message}. ${instruction}`
 */

/**
 * Base error class for all tool errors.
 */
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

/**
 * Thrown when tools are used before initialization.
 */
export class ToolsNotInitializedError extends ToolError {
  constructor() {
    super('Tools not initialized. Call initializeTools() first.', 'TOOLS_NOT_INITIALIZED');
  }
}

/**
 * Thrown when a page is not found by ID.
 */
export class PageNotFoundError extends ToolError {
  constructor(pageId: string) {
    super(`Page not found: ${pageId}`, 'PAGE_NOT_FOUND', { pageId });
  }
}

/**
 * Thrown when no page is available for operations.
 */
export class NoPageAvailableError extends ToolError {
  constructor() {
    super('No page available. Use launch_browser first.', 'NO_PAGE_AVAILABLE');
  }
}

/**
 * Thrown when a snapshot is required but not available.
 */
export class SnapshotRequiredError extends ToolError {
  constructor(pageId: string) {
    super(
      `No snapshot for page ${pageId}. Capture a snapshot first.`,
      'SNAPSHOT_REQUIRED',
      { pageId }
    );
  }
}

/**
 * Thrown when an element is not found by eid.
 */
export class ElementNotFoundError extends ToolError {
  constructor(eid: string) {
    super(`Element not found: ${eid}`, 'ELEMENT_NOT_FOUND', { eid });
  }
}

/**
 * Thrown when an element reference is stale.
 */
export class StaleElementError extends ToolError {
  constructor(eid: string) {
    super(`Element has stale reference: ${eid}`, 'STALE_ELEMENT', { eid });
  }
}

/**
 * Thrown when a node is not found in snapshot.
 */
export class NodeNotFoundError extends ToolError {
  constructor(nodeId: string) {
    super(`Node not found in snapshot: ${nodeId}`, 'NODE_NOT_FOUND', { nodeId });
  }
}

/**
 * Thrown when eid is required but not provided.
 */
export class EidRequiredError extends ToolError {
  constructor() {
    super('Element ID (eid) is required.', 'EID_REQUIRED');
  }
}
