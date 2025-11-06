/**
 * Interaction Domain Zod Schemas
 *
 * Schemas for click, type, select, scroll, upload, form, and keyboard tools
 */

import { z } from 'zod';
import {
  ElementRefSchema,
  LocatorHintSchema,
  ElementRefOrLocatorHintSchema,
} from '../../shared/schemas/index.js';

// ===== TARGET RESOLUTION =====

export const TargetsResolveInputSchema = z.object({
  hint: LocatorHintSchema.describe('Locator hint to resolve'),
  frameId: z.string().optional().describe('Frame identifier'),
});

export const TargetsResolveOutputSchema = z.object({
  element: ElementRefSchema.describe('Resolved element reference'),
});

// ===== ACTIONS =====

export const ActClickInputSchema = z.object({
  target: ElementRefOrLocatorHintSchema.describe('Target element to click'),
  strategy: z.enum(['ax', 'dom', 'bbox']).optional().describe('Click strategy to use'),
  frameId: z.string().optional().describe('Frame identifier'),
  waitAfterMs: z.number().optional().describe('Milliseconds to wait after click'),
});

export const ActClickOutputSchema = z.object({
  success: z.boolean().describe('Whether click succeeded'),
  target: ElementRefSchema.optional().describe('Clicked element reference'),
  error: z.string().optional().describe('Error message if failed'),
});

export const ActTypeInputSchema = z.object({
  target: ElementRefOrLocatorHintSchema.describe('Target input element'),
  text: z.string().describe('Text to type'),
  submit: z.enum(['Enter', 'Tab']).nullable().optional().describe('Key to press after typing'),
  clearFirst: z.boolean().optional().default(false).describe('Clear existing text first'),
  pressEnterAfter: z.boolean().optional().default(false).describe('Press Enter after typing'),
  simulateTyping: z
    .boolean()
    .optional()
    .default(false)
    .describe('Simulate human typing with delays'),
  frameId: z.string().optional().describe('Frame identifier'),
});

export const ActTypeOutputSchema = z.object({
  success: z.boolean().describe('Whether typing succeeded'),
  target: ElementRefSchema.optional().describe('Target element reference'),
  error: z.string().optional().describe('Error message if failed'),
});

export const ActSelectInputSchema = z.object({
  target: ElementRefSchema.describe('Target select element'),
  value: z.string().optional().describe('Option value to select'),
  label: z.string().optional().describe('Option label to select'),
  index: z.number().optional().describe('Option index to select'),
});

export const ActSelectOutputSchema = z.object({
  success: z.boolean().describe('Whether selection succeeded'),
});

export const ActScrollIntoViewInputSchema = z.object({
  target: ElementRefOrLocatorHintSchema.describe('Target element to scroll into view'),
  center: z.boolean().optional().default(true).describe('Center element in viewport'),
  frameId: z.string().optional().describe('Frame identifier'),
});

export const ActScrollIntoViewOutputSchema = z.object({
  success: z.boolean().describe('Whether scroll succeeded'),
  target: ElementRefSchema.optional().describe('Target element reference'),
  error: z.string().optional().describe('Error message if failed'),
});

export const ActUploadInputSchema = z.object({
  target: ElementRefOrLocatorHintSchema.describe('Target file input element'),
  files: z.array(z.string()).describe('File paths to upload'),
  frameId: z.string().optional().describe('Frame identifier'),
});

export const ActUploadOutputSchema = z.object({
  success: z.boolean().describe('Whether upload succeeded'),
  target: ElementRefSchema.optional().describe('Target element reference'),
  filesUploaded: z.number().optional().describe('Number of files uploaded'),
  error: z.string().optional().describe('Error message if failed'),
});

// ===== FORMS =====

export const FormFieldSchema = z.object({
  element: ElementRefSchema.describe('Field element reference'),
  type: z.string().describe('Input type'),
  label: z.string().optional().describe('Field label'),
  name: z.string().optional().describe('Field name attribute'),
  placeholder: z.string().optional().describe('Field placeholder'),
  required: z.boolean().describe('Whether field is required'),
  value: z.string().optional().describe('Current field value'),
});

export const SubmitButtonSchema = z.object({
  element: ElementRefSchema.describe('Submit button element reference'),
  text: z.string().optional().describe('Button text'),
  type: z.string().describe('Button type'),
});

export const FormDetectInputSchema = z.object({
  scope: LocatorHintSchema.optional().describe('Scope to limit form detection'),
});

export const FormDetectOutputSchema = z.object({
  forms: z
    .array(
      z.object({
        element: ElementRefSchema.describe('Form element reference'),
        fields: z.array(FormFieldSchema).describe('Form fields'),
        submitButton: SubmitButtonSchema.optional().describe('Submit button if found'),
      })
    )
    .describe('Detected forms'),
});

export const FormFillInputSchema = z.object({
  fields: z.record(z.string()).describe('Field values keyed by field name or label'),
  scope: LocatorHintSchema.optional().describe('Scope to limit form detection'),
  submit: z.boolean().optional().default(false).describe('Submit form after filling'),
  frameId: z.string().optional().describe('Frame identifier'),
});

export const FormFillOutputSchema = z.object({
  success: z.boolean().describe('Whether form fill succeeded'),
  results: z
    .array(
      z.object({
        field: z.string().describe('Field name'),
        success: z.boolean().describe('Whether this field was filled successfully'),
        error: z.string().optional().describe('Error message if field fill failed'),
      })
    )
    .optional()
    .describe('Results for each field'),
  error: z.string().optional().describe('Error message if failed'),
});

// ===== KEYBOARD =====

export const KeyboardPressInputSchema = z.object({
  key: z.string().describe('Key to press (e.g., "Enter", "Escape", "a")'),
  code: z.string().optional().describe('Key code'),
  modifiers: z
    .array(z.enum(['Alt', 'Ctrl', 'Meta', 'Shift']))
    .optional()
    .describe('Modifier keys'),
  delayMs: z.number().optional().describe('Delay in milliseconds'),
});

export const KeyboardPressOutputSchema = z.object({
  success: z.boolean().describe('Whether key press succeeded'),
});

export const KeyboardTypeInputSchema = z.object({
  text: z.string().describe('Text to type'),
  delay: z.number().optional().default(0).describe('Delay between key presses in ms'),
});

export const KeyboardTypeOutputSchema = z.object({
  success: z.boolean().describe('Whether typing succeeded'),
});

// ===== KEYBOARD HOTKEYS =====

export const KeyboardHotkeyInputSchema = z.object({
  hotkey: z
    .enum([
      'copy',
      'paste',
      'cut',
      'selectAll',
      'undo',
      'redo',
      'save',
      'find',
      'refresh',
      'newTab',
      'closeTab',
    ])
    .describe('Common hotkey to execute'),
});

export const KeyboardHotkeyOutputSchema = z.object({
  success: z.boolean().describe('Whether hotkey execution succeeded'),
});
