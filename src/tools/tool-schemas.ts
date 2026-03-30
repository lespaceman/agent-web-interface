/**
 * MCP Tool Schemas
 *
 * Zod schemas for tool inputs and outputs.
 * Used for validation and type inference.
 */

import { z } from 'zod';

// ============================================================================
// Shared Node Details Schema
// ============================================================================

/** Full node details including location, layout, state, and attributes */
export const NodeDetailsSchema = z.object({
  /** Stable element ID for use with action tools */
  eid: z.string(),
  /** Semantic node type */
  kind: z.string(),
  /** Human-readable label */
  label: z.string(),
  /** Location information */
  where: z.object({
    region: z.string(),
    group_id: z.string().optional(),
    group_path: z.array(z.string()).optional(),
    heading_context: z.string().optional(),
  }),
  /** Layout information */
  layout: z.object({
    bbox: z.object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    }),
    display: z.string().optional(),
    screen_zone: z.string().optional(),
  }),
  /** Element state */
  state: z
    .object({
      visible: z.boolean().optional(),
      enabled: z.boolean().optional(),
      checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
      expanded: z.boolean().optional(),
      selected: z.boolean().optional(),
      pressed: z.boolean().optional(),
      focused: z.boolean().optional(),
      required: z.boolean().optional(),
      invalid: z.boolean().optional(),
      readonly: z.boolean().optional(),
    })
    .optional(),
  /** Locator strategies */
  find: z
    .object({
      primary: z.string(),
      alternates: z.array(z.string()).optional(),
    })
    .optional(),
  /** Additional attributes */
  attributes: z
    .object({
      input_type: z.string().optional(),
      placeholder: z.string().optional(),
      value: z.string().optional(),
      href: z.string().optional(),
      alt: z.string().optional(),
      src: z.string().optional(),
      heading_level: z.number().optional(),
      action: z.string().optional(),
      method: z.string().optional(),
      autocomplete: z.string().optional(),
      role: z.string().optional(),
      test_id: z.string().optional(),
    })
    .optional(),
});

export type NodeDetails = z.infer<typeof NodeDetailsSchema>;

// ============================================================================
// Tool Input/Output Schemas
// ============================================================================

// ============================================================================
// list_pages - List all open browser pages
// ============================================================================

export const ListPagesInputSchema = z.object({});

/** Returns XML result string */
export const ListPagesOutputSchema = z.string();

export type ListPagesInput = z.infer<typeof ListPagesInputSchema>;
export type ListPagesOutput = z.infer<typeof ListPagesOutputSchema>;

// ============================================================================
// close_page - Close a specific page
// ============================================================================

export const ClosePageInputSchema = z.object({
  /** Page ID to close */
  page_id: z.string(),
});

/** Returns XML result string */
export const ClosePageOutputSchema = z.string();

export type ClosePageInput = z.infer<typeof ClosePageInputSchema>;
export type ClosePageOutput = z.infer<typeof ClosePageOutputSchema>;

// ============================================================================
// navigate - Navigate to a URL
// ============================================================================

export const NavigateInputSchema = z.object({
  /** URL to navigate to */
  url: z.string().url(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

/** Returns XML state response string directly */
export const NavigateOutputSchema = z.string();

export type NavigateInput = z.infer<typeof NavigateInputSchema>;
export type NavigateOutput = z.infer<typeof NavigateOutputSchema>;

// ============================================================================
// go_back - Go back in browser history
// ============================================================================

export const GoBackInputSchema = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

/** Returns XML state response string directly */
export const GoBackOutputSchema = z.string();

export type GoBackInput = z.infer<typeof GoBackInputSchema>;
export type GoBackOutput = z.infer<typeof GoBackOutputSchema>;

// ============================================================================
// go_forward - Go forward in browser history
// ============================================================================

export const GoForwardInputSchema = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

/** Returns XML state response string directly */
export const GoForwardOutputSchema = z.string();

export type GoForwardInput = z.infer<typeof GoForwardInputSchema>;
export type GoForwardOutput = z.infer<typeof GoForwardOutputSchema>;

// ============================================================================
// reload - Reload the current page
// ============================================================================

export const ReloadInputSchema = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

/** Returns XML state response string directly */
export const ReloadOutputSchema = z.string();

export type ReloadInput = z.infer<typeof ReloadInputSchema>;
export type ReloadOutput = z.infer<typeof ReloadOutputSchema>;

// ============================================================================
// snapshot - Capture a fresh snapshot of the current page
// ============================================================================

export const CaptureSnapshotInputSchema = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

/** Returns XML state response string directly */
export const CaptureSnapshotOutputSchema = z.string();

export type CaptureSnapshotInput = z.infer<typeof CaptureSnapshotInputSchema>;
export type CaptureSnapshotOutput = z.infer<typeof CaptureSnapshotOutputSchema>;

// ============================================================================
// find - Find elements by semantic criteria
// ============================================================================

export const FindElementsInputSchema = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional().describe('The ID of the page to search within.'),

  /** Filter by element type. */
  kind: z
    .enum([
      'button',
      'link',
      'radio',
      'checkbox',
      'textbox',
      'combobox',
      'image',
      'heading',
      'canvas',
      'alert',
    ])
    .optional()
    .describe(
      "Filter by element type: 'button' for clickable buttons, 'link' for hyperlinks, 'textbox' for input fields, 'checkbox'/'radio' for toggles, 'combobox' for dropdowns, 'heading' for section titles, 'image' for images, 'canvas' for canvas elements, 'alert' for notifications/toasts/alerts/status messages."
    ),
  /** Search text to match against element labels. */
  label: z
    .string()
    .optional()
    .describe(
      'Search text to match against element labels - uses case-insensitive substring matching. Example: label "Sign" matches "Sign In", "Sign Up", "Signature".'
    ),
  /** Restrict search to a specific area. */
  region: z
    .enum(['main', 'nav', 'header', 'footer'])
    .optional()
    .describe('Restrict search to a specific area.'),
  /** Maximum number of results (default: 10) */
  limit: z.number().int().min(1).max(100).default(10).describe('Number of results to return.'),
  /** Include readable content with semantic IDs in results. */
  include_readable: z
    .boolean()
    .default(true)
    .optional()
    .describe(
      'When true (default), text content (paragraphs, headings) gets semantic IDs (rd-*) for reference. Set to true when you need to read page content. Use the `kind` parameter to filter to specific element types.'
    ),
});

/** Returns XML result string */
export const FindElementsOutputSchema = z.string();

export type FindElementsInput = z.infer<typeof FindElementsInputSchema>;
export type FindElementsOutput = z.infer<typeof FindElementsOutputSchema>;

// ============================================================================
// get_element_details - Get full details for a specific element
// ============================================================================

export const GetNodeDetailsInputSchema = z.object({
  /** Stable element ID (eid) to get details for */
  eid: z.string(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

/** Returns XML result string */
export const GetNodeDetailsOutputSchema = z.string();

export type GetNodeDetailsInput = z.infer<typeof GetNodeDetailsInputSchema>;
export type GetNodeDetailsOutput = z.infer<typeof GetNodeDetailsOutputSchema>;

// ============================================================================
// scroll_element_into_view - Scroll an element into view
// ============================================================================

const ScrollElementIntoViewInputSchemaBase = z.object({
  /** Stable element ID from find or snapshot */
  eid: z
    .string()
    .describe('Element ID of the off-screen element from find results or the page snapshot.'),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});
export const ScrollElementIntoViewInputSchema = ScrollElementIntoViewInputSchemaBase;
export { ScrollElementIntoViewInputSchemaBase };

/** Returns XML state response string directly */
export const ScrollElementIntoViewOutputSchema = z.string();

export type ScrollElementIntoViewInput = z.infer<typeof ScrollElementIntoViewInputSchema>;
export type ScrollElementIntoViewOutput = z.infer<typeof ScrollElementIntoViewOutputSchema>;

// ============================================================================
// scroll_page - Scroll the page up or down
// ============================================================================

export const ScrollPageInputSchema = z.object({
  /** Scroll direction */
  direction: z.enum(['up', 'down']),
  /** Scroll amount in pixels (default: 500) */
  amount: z.number().default(500),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

/** Returns XML state response string directly */
export const ScrollPageOutputSchema = z.string();

export type ScrollPageInput = z.infer<typeof ScrollPageInputSchema>;
export type ScrollPageOutput = z.infer<typeof ScrollPageOutputSchema>;

// ============================================================================
// Simplified mutation tools WITHOUT agent_version
// ============================================================================

/** Supported keyboard keys */
const SupportedKeys = [
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
] as const;

// click - Click an element or coordinates (no agent_version)
// Raw schema for .shape access (tool registration)
const ClickInputSchemaBase = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional().describe('The ID of the page containing the element.'),
  /** Stable element ID from find or snapshot */
  eid: z
    .string()
    .optional()
    .describe(
      'Element ID from find results or the page snapshot. Every interactive element has a unique eid.'
    ),
  /** X coordinate. If eid is also provided, relative to element top-left. Otherwise absolute viewport coordinate. */
  x: z
    .number()
    .optional()
    .describe(
      'X coordinate for the click. When used with eid, relative to the element top-left corner. When used without eid, absolute viewport coordinate.'
    ),
  /** Y coordinate. If eid is also provided, relative to element top-left. Otherwise absolute viewport coordinate. */
  y: z
    .number()
    .optional()
    .describe(
      'Y coordinate for the click. When used with eid, relative to the element top-left corner. When used without eid, absolute viewport coordinate.'
    ),
  /** Modifier keys to hold during the click */
  modifiers: z
    .array(z.enum(['Control', 'Shift', 'Alt', 'Meta']))
    .optional()
    .describe(
      'Modifier keys to hold during the click (e.g., Shift for multi-select, Control for ctrl-click).'
    ),
});
export const ClickInputSchema = ClickInputSchemaBase;
// Re-export base for .shape access
export { ClickInputSchemaBase };

/** Returns XML state response string directly */
export const ClickOutputSchema = z.string();

export type ClickInput = z.infer<typeof ClickInputSchema>;
export type ClickOutput = z.infer<typeof ClickOutputSchema>;

// type - Type text into an element (eid required, no agent_version)
const TypeInputSchemaBase = z.object({
  /** Text to type */
  text: z.string().describe('The text to type into the element.'),
  /** Stable element ID from find or snapshot */
  eid: z.string().describe('Element ID of the input field from find results or the page snapshot.'),
  /** Clear existing text before typing (default: false) */
  clear: z
    .boolean()
    .default(false)
    .describe(
      'If true, clear the field before typing (replaces content). If false (default), append to existing text.'
    ),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});
export const TypeInputSchema = TypeInputSchemaBase;
export { TypeInputSchemaBase };

/** Returns XML state response string directly */
export const TypeOutputSchema = z.string();

export type TypeInput = z.infer<typeof TypeInputSchema>;
export type TypeOutput = z.infer<typeof TypeOutputSchema>;

// press - Press a keyboard key (no agent_version)
export const PressInputSchema = z.object({
  /** Key to press */
  key: z.enum(SupportedKeys),
  /** Modifier keys to hold (Control, Shift, Alt, Meta) */
  modifiers: z.array(z.enum(['Control', 'Shift', 'Alt', 'Meta'])).optional(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

/** Returns XML state response string directly */
export const PressOutputSchema = z.string();

export type PressInput = z.infer<typeof PressInputSchema>;
export type PressOutput = z.infer<typeof PressOutputSchema>;

// select - Select a dropdown option (no agent_version)
const SelectInputSchemaBase = z.object({
  /** Stable element ID from find or snapshot */
  eid: z.string().describe('Element ID of the dropdown from find results or the page snapshot.'),
  /** Option value or visible text to select */
  value: z
    .string()
    .describe(
      'The option to select - can be either the value attribute or the visible text of the option.'
    ),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});
export const SelectInputSchema = SelectInputSchemaBase;
export { SelectInputSchemaBase };

/** Returns XML state response string directly */
export const SelectOutputSchema = z.string();

export type SelectInput = z.infer<typeof SelectInputSchema>;
export type SelectOutput = z.infer<typeof SelectOutputSchema>;

// hover - Hover over an element (no agent_version)
const HoverInputSchemaBase = z.object({
  /** Stable element ID from find or snapshot */
  eid: z.string().describe('Element ID from find results or the page snapshot.'),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});
export const HoverInputSchema = HoverInputSchemaBase;
export { HoverInputSchemaBase };

/** Returns XML state response string directly */
export const HoverOutputSchema = z.string();

export type HoverInput = z.infer<typeof HoverInputSchema>;
export type HoverOutput = z.infer<typeof HoverOutputSchema>;

// ============================================================================
// take_screenshot - Capture page or element screenshot
// ============================================================================

// Base schema without refinement (for .shape access in tool registration)
const TakeScreenshotInputSchemaBase = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional().describe('The ID of the page to screenshot.'),

  /** Element ID to capture (requires prior snapshot). Cannot combine with fullPage. */
  eid: z
    .string()
    .optional()
    .describe(
      'Element ID to screenshot. Requires a prior snapshot. Cannot be combined with fullPage.'
    ),
  /** Capture full page beyond viewport. Cannot combine with eid. */
  fullPage: z
    .boolean()
    .optional()
    .default(false)
    .describe('Capture full page height beyond the viewport. Cannot be combined with eid.'),
  /** Image format (default: png) */
  format: z
    .enum(['png', 'jpeg'])
    .optional()
    .default('png')
    .describe("Image format: 'png' (lossless, default) or 'jpeg' (lossy with quality control)."),
  /** JPEG quality 0-100 (ignored for PNG) */
  quality: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe('JPEG quality 0-100. Only applies when format is jpeg.'),
});

export const TakeScreenshotInputSchema = TakeScreenshotInputSchemaBase;
export { TakeScreenshotInputSchemaBase };

export type TakeScreenshotInput = z.infer<typeof TakeScreenshotInputSchema>;

/** Discriminated union output: inline image or file path */
export const TakeScreenshotOutputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('image'),
    data: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
  }),
  z.object({
    type: z.literal('file'),
    path: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
  }),
]);

export type TakeScreenshotOutput = z.infer<typeof TakeScreenshotOutputSchema>;

// ============================================================================
// drag - Drag from one point to another
// ============================================================================

const DragInputSchemaBase = z.object({
  /** Source X coordinate */
  source_x: z.number().describe('X coordinate of the drag start point.'),
  /** Source Y coordinate */
  source_y: z.number().describe('Y coordinate of the drag start point.'),
  /** Target X coordinate */
  target_x: z.number().describe('X coordinate of the drag end point.'),
  /** Target Y coordinate */
  target_y: z.number().describe('Y coordinate of the drag end point.'),
  /** Optional element ID. When provided, all coordinates are relative to element top-left. */
  eid: z
    .string()
    .optional()
    .describe(
      'Optional element ID. When provided, coordinates are relative to the element top-left corner.'
    ),
  /** Modifier keys to hold during the drag */
  modifiers: z
    .array(z.enum(['Control', 'Shift', 'Alt', 'Meta']))
    .optional()
    .describe(
      'Modifier keys to hold during the drag (e.g., Shift for constrained rotation, Control for copy-drag).'
    ),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional().describe('The ID of the page.'),
});
export const DragInputSchema = DragInputSchemaBase;
export { DragInputSchemaBase };

/** Returns XML state response string directly */
export const DragOutputSchema = z.string();

export type DragInput = z.infer<typeof DragInputSchema>;
export type DragOutput = z.infer<typeof DragOutputSchema>;

// ============================================================================
// wheel - Dispatch a mouse wheel event
// ============================================================================

const WheelInputSchemaBase = z.object({
  /** X coordinate where wheel event is dispatched */
  x: z.number().describe('X coordinate where the wheel event is dispatched.'),
  /** Y coordinate where wheel event is dispatched */
  y: z.number().describe('Y coordinate where the wheel event is dispatched.'),
  /** Horizontal scroll delta (positive = scroll right) */
  deltaX: z
    .number()
    .default(0)
    .describe('Horizontal scroll delta in pixels. Positive scrolls right.'),
  /** Vertical scroll delta (positive = scroll down/zoom out) */
  deltaY: z
    .number()
    .describe(
      'Vertical scroll delta in pixels. Positive scrolls down, negative scrolls up. For zoom: negative typically zooms in, positive zooms out.'
    ),
  /** Optional element ID. When provided, x/y are relative to element top-left. */
  eid: z
    .string()
    .optional()
    .describe(
      'Optional element ID. When provided, x/y coordinates are relative to the element top-left corner.'
    ),
  /** Modifier keys (e.g., Control for ctrl+scroll zoom) */
  modifiers: z
    .array(z.enum(['Control', 'Shift', 'Alt', 'Meta']))
    .optional()
    .describe('Modifier keys to hold during the wheel event (e.g., Control for zoom).'),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional().describe('The ID of the page.'),
});
export const WheelInputSchema = WheelInputSchemaBase;
export { WheelInputSchemaBase };

/** Returns XML state response string directly */
export const WheelOutputSchema = z.string();

export type WheelInput = z.infer<typeof WheelInputSchema>;
export type WheelOutput = z.infer<typeof WheelOutputSchema>;

// ============================================================================
// inspect_canvas - Inspect canvas element for objects and coordinates
// ============================================================================

const InspectCanvasInputSchemaBase = z.object({
  /** Stable element ID of the canvas element */
  eid: z.string().describe('Element ID of the canvas element from find results.'),
  /** Grid line spacing in pixels (default: 50) */
  grid_spacing: z
    .number()
    .int()
    .min(10)
    .max(500)
    .default(50)
    .optional()
    .describe(
      'Grid line spacing in pixels (default: 50). Smaller values give finer coordinate resolution.'
    ),
  /** Image format (default: png) */
  format: z
    .enum(['png', 'jpeg'])
    .optional()
    .default('png')
    .describe("Image format: 'png' (lossless, default) or 'jpeg' (lossy with quality control)."),
  /** JPEG quality 0-100 (ignored for PNG) */
  quality: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe('JPEG quality 0-100. Only applies when format is jpeg.'),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z
    .string()
    .optional()
    .describe('Page ID. If omitted, operates on the most recently used page.'),
});
export const InspectCanvasInputSchema = InspectCanvasInputSchemaBase;
export { InspectCanvasInputSchemaBase };

export type InspectCanvasInput = z.infer<typeof InspectCanvasInputSchema>;

// ============================================================================
// read_page - Extract clean readable content using Mozilla Readability
// ============================================================================

export const ReadPageInputSchema = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z
    .string()
    .optional()
    .describe('Page ID. If omitted, operates on the most recently used page.'),
});

/** Returns XML result string */
export const ReadPageOutputSchema = z.string();

export type ReadPageInput = z.infer<typeof ReadPageInputSchema>;
export type ReadPageOutput = z.infer<typeof ReadPageOutputSchema>;

// ============================================================================
// list_network_calls - List network requests for a page
// ============================================================================

export const ListNetworkCallsInputSchema = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z
    .string()
    .optional()
    .describe('Page ID. If omitted, operates on the most recently used page.'),
  /** Filter by resource type */
  resource_type: z
    .string()
    .optional()
    .describe(
      'Filter by resource type: xhr, fetch, document, script, stylesheet, image, font, media, other.'
    ),
  /** Filter by HTTP method */
  method: z
    .string()
    .optional()
    .describe('Filter by HTTP method: GET, POST, PUT, DELETE, PATCH, etc.'),
  /** Minimum status code (inclusive) */
  status_min: z
    .number()
    .int()
    .optional()
    .describe('Minimum HTTP status code (inclusive). Use 400 to see only errors.'),
  /** Maximum status code (inclusive) */
  status_max: z
    .number()
    .int()
    .optional()
    .describe('Maximum HTTP status code (inclusive). Use with status_min for ranges like 200-299.'),
  /** Only show failed requests (network errors, aborted) */
  failed_only: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, only show requests that failed due to network errors.'),
  /** URL substring filter */
  url_pattern: z.string().optional().describe('Filter URLs containing this substring.'),
  /** Pagination offset (default: 0) */
  offset: z.number().int().min(0).default(0).describe('Pagination offset (default: 0).'),
  /** Number of results to return (default: 25, max: 100) */
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Number of results to return (default: 25, max: 100).'),
});

export const ListNetworkCallsOutputSchema = z.string();

export type ListNetworkCallsInput = z.infer<typeof ListNetworkCallsInputSchema>;
export type ListNetworkCallsOutput = z.infer<typeof ListNetworkCallsOutputSchema>;

// ============================================================================
// search_network_calls - Search network calls by URL pattern
// ============================================================================

export const SearchNetworkCallsInputSchema = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z
    .string()
    .optional()
    .describe('Page ID. If omitted, operates on the most recently used page.'),
  /** URL pattern to search for (substring or regex) */
  url_pattern: z
    .string()
    .describe(
      'URL pattern to search for. Substring match by default; set url_regex=true for regex.'
    ),
  /** Treat url_pattern as regex (default: false) */
  url_regex: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, url_pattern is treated as a regular expression.'),
  /** Filter by resource type */
  resource_type: z.string().optional().describe('Filter by resource type.'),
  /** Filter by HTTP method */
  method: z.string().optional().describe('Filter by HTTP method.'),
  /** Minimum status code (inclusive) */
  status_min: z.number().int().optional().describe('Minimum HTTP status code (inclusive).'),
  /** Maximum status code (inclusive) */
  status_max: z.number().int().optional().describe('Maximum HTTP status code (inclusive).'),
  /** Include request/response headers in results */
  include_headers: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, include request and response headers in results.'),
  /** Include request body in results */
  include_body: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, include POST body in results.'),
  /** Number of results to return (default: 25, max: 100) */
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Number of results to return (default: 25, max: 100).'),
});

export const SearchNetworkCallsOutputSchema = z.string();

export type SearchNetworkCallsInput = z.infer<typeof SearchNetworkCallsInputSchema>;
export type SearchNetworkCallsOutput = z.infer<typeof SearchNetworkCallsOutputSchema>;
