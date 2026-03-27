/**
 * Tool Error Classes
 *
 * Standardized errors for browser tools with consistent formatting.
 * All errors follow the pattern: `${context}: ${identifier}` or `${message}. ${instruction}`
 */

class ToolError extends Error {
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
 * Thrown when a snapshot is required but not available.
 */
export class SnapshotRequiredError extends ToolError {
  constructor(pageId: string) {
    super(`No snapshot for page ${pageId}. Capture a snapshot first.`, 'SNAPSHOT_REQUIRED', {
      pageId,
    });
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
