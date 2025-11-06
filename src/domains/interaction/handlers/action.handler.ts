/**
 * Action Handler
 *
 * Handles all browser interaction actions:
 * - act_click: Click elements using multiple strategies
 * - act_type: Type text into input fields
 * - act_scroll_into_view: Scroll elements into viewport
 * - act_upload: Upload files to file inputs
 */

import type {
  ActClickParams,
  ActClickResponse,
  ActTypeParams,
  ActTypeResponse,
  ActScrollIntoViewParams,
  ActScrollIntoViewResponse,
  ActUploadParams,
  ActUploadResponse,
  TargetsResolveParams,
  TargetsResolveResponse,
} from '../interaction.types.js';
import type { ElementRef, LocatorHint } from '../../../shared/types/index.js';
import type {
  ClickStrategy,
  AccessibilityClickStrategy,
  DomClickStrategy,
  BBoxClickStrategy,
} from '../strategies/index.js';

interface CdpBridge {
  executeDevToolsMethod<T>(method: string, params?: unknown): Promise<T>;
}

interface ElementResolver {
  resolve(hint: ElementRef | LocatorHint, frameId?: string): Promise<ElementRef>;
}

/**
 * Action Handler
 *
 * Orchestrates browser interactions using multiple strategies
 */
export class ActionHandler {
  private clickStrategies: ClickStrategy[];

  constructor(
    private readonly cdpBridge: CdpBridge,
    private readonly elementResolver: ElementResolver,
    accessibilityStrategy: AccessibilityClickStrategy,
    domStrategy: DomClickStrategy,
    bboxStrategy: BBoxClickStrategy
  ) {
    // Order matters: try more reliable strategies first
    this.clickStrategies = [domStrategy, accessibilityStrategy, bboxStrategy];
  }

  /**
   * Handle act_click tool
   *
   * Clicks an element using the most appropriate strategy
   */
  async click(params: ActClickParams): Promise<ActClickResponse> {
    try {
      // Workaround: MCP SDK sometimes serializes object params as JSON strings
      const normalizedParams = this.deserializeParams(params);

      // Step 1: Resolve the target element
      const target = await this.elementResolver.resolve(
        normalizedParams.target,
        normalizedParams.frameId
      );

      // Step 2: Find a suitable click strategy
      const strategy = this.clickStrategies.find((s) => s.canHandle(target));

      if (!strategy) {
        return {
          success: false,
          error: 'No suitable click strategy found for target',
          target,
        };
      }

      // Step 3: Execute the click
      await strategy.click(target);

      // Step 4: Wait if requested
      if (normalizedParams.waitAfterMs) {
        await this.sleep(normalizedParams.waitAfterMs);
      }

      return {
        success: true,
        target,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle act_type tool
   *
   * Types text into an input field
   */
  async type(params: ActTypeParams): Promise<ActTypeResponse> {
    try {
      // Workaround: MCP SDK sometimes serializes object params as JSON strings
      const normalizedParams = this.deserializeParams(params);

      // Step 1: Resolve the target element
      const target = await this.elementResolver.resolve(
        normalizedParams.target,
        normalizedParams.frameId
      );

      // Step 2: Focus the element first
      if (target.nodeId) {
        await this.cdpBridge.executeDevToolsMethod('DOM.focus', {
          nodeId: target.nodeId,
        });
      } else if (target.selectors.css) {
        // Focus using JavaScript
        await this.cdpBridge.executeDevToolsMethod('Runtime.evaluate', {
          expression: `document.querySelector(${JSON.stringify(target.selectors.css)})?.focus()`,
        });
      }

      // Step 3: Clear existing text if requested
      if (normalizedParams.clearFirst) {
        // Select all text
        await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'a',
          code: 'KeyA',
          modifiers: 2, // Ctrl/Cmd modifier
        });
        await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'a',
          code: 'KeyA',
          modifiers: 2,
        });

        // Delete selected text
        await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Backspace',
          code: 'Backspace',
        });
        await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Backspace',
          code: 'Backspace',
        });
      }

      // Step 4: Type the text
      if (normalizedParams.simulateTyping) {
        // Simulate human typing with delays between characters
        for (const char of normalizedParams.text) {
          await this.cdpBridge.executeDevToolsMethod('Input.insertText', {
            text: char,
          });
          // Random delay between 50-150ms
          await this.sleep(50 + Math.random() * 100);
        }
      } else {
        // Insert all text at once
        await this.cdpBridge.executeDevToolsMethod('Input.insertText', {
          text: normalizedParams.text,
        });
      }

      // Step 5: Press Enter if requested
      if (normalizedParams.pressEnterAfter) {
        await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Enter',
          code: 'Enter',
        });
        await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Enter',
          code: 'Enter',
        });
      }

      return {
        success: true,
        target,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle act_scroll_into_view tool
   *
   * Scrolls an element into the viewport
   */
  async scrollIntoView(params: ActScrollIntoViewParams): Promise<ActScrollIntoViewResponse> {
    try {
      // Workaround: MCP SDK sometimes serializes object params as JSON strings
      const normalizedParams = this.deserializeParams(params);

      // Step 1: Resolve the target element
      const target = await this.elementResolver.resolve(
        normalizedParams.target,
        normalizedParams.frameId
      );

      // Step 2: Scroll into view
      if (target.nodeId) {
        // Use CDP's scrollIntoViewIfNeeded
        await this.cdpBridge.executeDevToolsMethod('DOM.scrollIntoViewIfNeeded', {
          nodeId: target.nodeId,
        });
      } else if (target.selectors.css) {
        // Fallback to JavaScript
        await this.cdpBridge.executeDevToolsMethod('Runtime.evaluate', {
          expression: `
            (function() {
              const el = document.querySelector(${JSON.stringify(target.selectors.css)});
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return true;
              }
              return false;
            })()
          `,
          returnByValue: true,
        });
      } else {
        throw new Error('Cannot scroll into view: no nodeId or CSS selector');
      }

      // Step 3: Wait for scroll animation
      await this.sleep(300);

      return {
        success: true,
        target,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle act_upload tool
   *
   * Uploads files to a file input element
   */
  async upload(params: ActUploadParams): Promise<ActUploadResponse> {
    try {
      // Workaround: MCP SDK sometimes serializes object params as JSON strings
      const normalizedParams = this.deserializeParams(params);

      // Step 1: Validate file paths
      if (!normalizedParams.files || normalizedParams.files.length === 0) {
        throw new Error('No files provided for upload');
      }

      // Step 2: Resolve the target element
      const target = await this.elementResolver.resolve(
        normalizedParams.target,
        normalizedParams.frameId
      );

      // Step 3: Verify it's a file input
      if (target.nodeId) {
        const nodeInfo = await this.cdpBridge.executeDevToolsMethod<{
          node: { nodeName: string; attributes?: string[] };
        }>('DOM.describeNode', {
          nodeId: target.nodeId,
        });

        if (nodeInfo.node.nodeName.toLowerCase() !== 'input') {
          throw new Error('Target element is not an input element');
        }

        // Check if it's type="file"
        const attributes = nodeInfo.node.attributes ?? [];
        const typeIndex = attributes.indexOf('type');
        if (typeIndex === -1 || attributes[typeIndex + 1] !== 'file') {
          throw new Error('Target input is not a file input (type="file")');
        }
      }

      // Step 4: Set file input files
      if (!target.nodeId) {
        throw new Error('Cannot upload files: no nodeId available');
      }

      await this.cdpBridge.executeDevToolsMethod('DOM.setFileInputFiles', {
        nodeId: target.nodeId,
        files: normalizedParams.files,
      });

      return {
        success: true,
        target,
        filesUploaded: normalizedParams.files.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Resolve a locator hint to an ElementRef
   *
   * This is useful for debugging and testing element resolution
   */
  async resolve(params: TargetsResolveParams): Promise<TargetsResolveResponse> {
    // Debug logging
    console.error('[ActionHandler.resolve] Raw params:', JSON.stringify(params, null, 2));
    console.error('[ActionHandler.resolve] Hint value:', JSON.stringify(params.hint, null, 2));

    const element = await this.elementResolver.resolve(params.hint, params.frameId);
    return { element };
  }

  /**
   * Sleep for a specified number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Deserialize parameters that may have been serialized as JSON strings
   *
   * MCP SDK workaround: Sometimes object parameters are passed as JSON strings
   * instead of native objects. This method handles both cases.
   */
  private deserializeParams<T>(params: T): T {
    if (params === null || typeof params !== 'object') {
      return params;
    }

    const result: Record<string, unknown> = { ...(params as Record<string, unknown>) };

    // Check each parameter that should be an object
    for (const key of Object.keys(result)) {
      const value = result[key];

      // If it's a string that looks like JSON, try to parse it
      if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
        try {
          const parsedValue: unknown = JSON.parse(value) as unknown;
          result[key] = parsedValue;
        } catch {
          // If parsing fails, keep the original string value
          // This is intentional - some strings legitimately start with { or [
        }
      }
    }

    return result as T;
  }
}
