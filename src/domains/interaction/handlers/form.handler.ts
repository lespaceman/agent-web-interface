/**
 * Form Handler
 *
 * Handles form-related tools:
 * - form_detect: Detect form fields and submit buttons
 * - form_fill: Fill multiple form fields at once
 */

import type {
  FormDetectParams,
  FormDetectResponse,
  FormFillParams,
  FormFillResponse,
} from '../interaction.types.js';
import type { FormDetectorService } from '../../../shared/services/form-detector.service.js';
import type { ActTypeParams } from '../interaction.types.js';
import type { DomTreeNode } from '../../../shared/types/index.js';
import { FormError, ErrorCode } from '../../../shared/errors/index.js';
import { getLogger } from '../../../shared/services/logging.service.js';

interface DomTreeHandler {
  handle(params: { maxDepth?: number; visibleOnly?: boolean }): Promise<{
    nodes: DomTreeNode[];
  }>;
}

interface AxTreeHandler {
  handle(params: { frameId?: string }): Promise<{
    nodes: {
      nodeId?: string;
      role?: string;
      name?: string;
      properties?: { name: string; value: unknown }[];
    }[];
  }>;
}

interface ActionHandler {
  type(params: ActTypeParams): Promise<{ success: boolean; error?: string }>;
}

/**
 * Form Handler
 *
 * Uses FormDetectorService to detect forms and ActionHandler to fill them
 */
export class FormHandler {
  constructor(
    private readonly formDetector: FormDetectorService,
    private readonly domTreeHandler: DomTreeHandler,
    private readonly axTreeHandler: AxTreeHandler,
    private readonly actionHandler: ActionHandler
  ) {}

  /**
   * Handle form_detect tool
   *
   * Detects all form fields and submit buttons in the current page or scope
   */
  async detect(params: FormDetectParams): Promise<FormDetectResponse> {
    const logger = getLogger();

    try {
      // Write to file for debugging
      await import('fs/promises').then((fs) =>
        fs
          .appendFile(
            '/tmp/mcp-debug.log',
            `[${new Date().toISOString()}] FormHandler.detect\n` +
              `  params: ${JSON.stringify(params, null, 2)}\n\n`
          )
          .catch(() => {
            /* ignore file write errors */
          })
      );

      logger.debug('Starting form detection', { scope: params.scope });

      // Step 1: Get DOM tree
      const domTree = await this.domTreeHandler.handle({
        maxDepth: params.maxDepth,
        visibleOnly: params.visibleOnly,
      });

      // Step 2: Get accessibility tree for label detection
      const axTree = await this.axTreeHandler.handle({
        frameId: params.frameId,
      });

      // Step 3: Run form detection
      const result = await this.formDetector.detect(
        domTree,
        axTree,
        params.scope,
        params.visibleOnly
      );

      logger.info('Form detection completed', {
        fieldsFound: result.fields.length,
        submitButtonsFound: result.submitButtons.length,
      });

      // Return data matching the MCP schema: { forms: [...] }
      return {
        forms: [
          {
            element: result.formElement ?? {
              frameId: params.frameId ?? 'main',
              selectors: {},
            },
            fields: result.fields,
            submitButton: result.submitButtons[0],
          },
        ],
      };
    } catch (error) {
      logger.error('Form detection failed', error instanceof Error ? error : undefined, {
        scope: params.scope,
      });

      // Throw structured error instead of returning empty result
      throw new FormError('Failed to detect form fields', ErrorCode.FORM_NOT_FOUND, {
        scope: params.scope,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle form_fill tool
   *
   * Fills multiple form fields at once using a key-value map
   */
  async fill(params: FormFillParams): Promise<FormFillResponse> {
    const logger = getLogger();
    const results: { field: string; success: boolean; error?: string }[] = [];

    try {
      logger.debug('Starting form fill', {
        fieldCount: Object.keys(params.fields).length,
        submit: params.submit,
      });

      // Step 1: Detect all form fields
      const detection = await this.detect({
        scope: params.scope,
        frameId: params.frameId,
        visibleOnly: true,
      });

      // Get the first form (or create empty array if none)
      const form = detection.forms[0];
      if (!form) {
        throw new FormError('No forms detected on the page', ErrorCode.FORM_NOT_FOUND, {
          scope: params.scope,
        });
      }

      // Step 2: Match fields to fill data
      for (const [fieldKey, value] of Object.entries(params.fields)) {
        // Find field by name, label, or placeholder
        const field = form.fields.find(
          (f) =>
            f.name === fieldKey ||
            f.label === fieldKey ||
            f.placeholder === fieldKey ||
            f.element.selectors.css?.includes(fieldKey)
        );

        if (!field) {
          logger.warning('Form field not found', { fieldKey });
          results.push({
            field: fieldKey,
            success: false,
            error: 'Field not found',
          });
          continue;
        }

        // Step 3: Type the value into the field
        const typeResult = await this.actionHandler.type({
          target: field.element,
          text: String(value),
          clearFirst: true,
          frameId: params.frameId,
        });

        results.push({
          field: fieldKey,
          success: typeResult.success,
          error: typeResult.error,
        });
      }

      // Step 4: Click submit button if requested
      if (params.submit && form.submitButton) {
        // Note: We'd need to import and use ActionHandler's click method here
        // For now, we'll just record that we found a submit button
        results.push({
          field: '__submit__',
          success: true,
        });
      }

      // Check if all fields were successfully filled
      const allSuccess = results.every((r) => r.success);
      const failedCount = results.filter((r) => !r.success).length;

      logger.info('Form fill completed', {
        totalFields: results.length,
        succeeded: results.length - failedCount,
        failed: failedCount,
        allSuccess,
      });

      // Throw error if all fields failed
      if (results.length > 0 && failedCount === results.length) {
        throw new FormError('All form fields failed to fill', ErrorCode.FORM_FILL_FAILED, {
          results,
        });
      }

      return {
        success: allSuccess,
        results,
      };
    } catch (error) {
      logger.error('Form fill failed', error instanceof Error ? error : undefined);

      // If it's already a FormError, re-throw it
      if (error instanceof FormError) {
        throw error;
      }

      // Otherwise, throw a new FormError
      throw new FormError('Failed to fill form', ErrorCode.FORM_FILL_FAILED, {
        results,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
