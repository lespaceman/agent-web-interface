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
  /** Unique node identifier */
  node_id: z.string(),
  /** CDP backend node ID - stable within session */
  backend_node_id: z.number(),
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
      checked: z.boolean().optional(),
      expanded: z.boolean().optional(),
      selected: z.boolean().optional(),
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
// Page Summary Schema (JSON page state)
// ============================================================================

/**
 * Page Summary Schema
 *
 * Returns comprehensive page state with ALL interactive elements.
 * Elements are grouped by region for better organization.
 *
 * Element state abbreviations:
 * - vis: visible (always present) - whether element is visible on page
 * - ena: enabled (always present) - whether element is interactive
 * - chk: checked (optional) - for checkboxes/radio buttons
 * - sel: selected (optional) - for select options
 * - exp: expanded (optional) - for accordion/disclosure widgets
 * - foc: focused (optional) - element currently has focus
 * - req: required (optional) - form field is required
 * - inv: invalid (optional) - form field has validation error
 * - rdo: readonly (optional) - input field is readonly
 *
 * Element attributes:
 * - val: value - current input value (passwords redacted)
 * - type: input type (text, email, password, etc.)
 * - href: link URL
 * - placeholder: input placeholder text
 *
 * Regions:
 * - header: Top navigation, logo, global actions
 * - nav: Main navigation menu
 * - main: Primary content (usually largest)
 * - footer: Bottom links, copyright
 * - aside: Sidebar content (optional)
 * - dialog: Modal/dialog content (optional)
 * - unknown: Unclassified elements (optional)
 */
const ElementInfoSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  vis: z.boolean(),
  ena: z.boolean(),
  chk: z.boolean().optional(),
  sel: z.boolean().optional(),
  exp: z.boolean().optional(),
  foc: z.boolean().optional(),
  req: z.boolean().optional(),
  inv: z.boolean().optional(),
  rdo: z.boolean().optional(),
  val: z.string().optional(),
  placeholder: z.string().optional(),
  href: z.string().optional(),
  type: z.string().optional(),
});

export const PageSummarySchema = z.object({
  type: z.string(),
  url: z.string(),
  title: z.string(),
  dialogs: z.object({
    blocking: z.boolean(),
    list: z.array(z.object({
      id: z.string(),
      type: z.string(),
      title: z.string().optional(),
      modal: z.boolean(),
      actions: z.array(z.object({
        id: z.string(),
        label: z.string(),
        role: z.string(),
      })),
    })),
  }).optional(),
  regions: z.object({
    header: z.array(ElementInfoSchema).optional(),
    nav: z.array(ElementInfoSchema).optional(),
    main: z.array(ElementInfoSchema).optional(),
    footer: z.array(ElementInfoSchema).optional(),
    aside: z.array(ElementInfoSchema).optional(),
    dialog: z.array(ElementInfoSchema).optional(),
    unknown: z.array(ElementInfoSchema).optional(),
  }),
  stats: z.object({
    total: z.number(),
    by_kind: z.record(z.number()),
  }),
});

export type PageSummary = z.infer<typeof PageSummarySchema>;

// ============================================================================
// Delta Response Types (shared by mutation tools)
// ============================================================================

/** Response type indicating what kind of snapshot data is returned */
export const SnapshotResponseTypeSchema = z.enum([
  'full',
  'delta',
  'no_change',
  'overlay_opened',
  'overlay_closed',
]);

export type SnapshotResponseType = z.infer<typeof SnapshotResponseTypeSchema>;

const DeltaCountsSchema = z.object({
  invalidated: z.number(),
  added: z.number(),
  modified: z.number(),
  removed: z.number(),
});

const DeltaNodeStateSchema = z.object({
  visible: z.boolean(),
  enabled: z.boolean(),
  checked: z.boolean().optional(),
  expanded: z.boolean().optional(),
  selected: z.boolean().optional(),
  focused: z.boolean().optional(),
  required: z.boolean().optional(),
  invalid: z.boolean().optional(),
  readonly: z.boolean().optional(),
});

const DeltaNodeSummarySchema = z.object({
  ref: z.string(),
  kind: z.string(),
  label: z.string(),
  state: DeltaNodeStateSchema.optional(),
});

const DeltaModifiedSummarySchema = z.object({
  ref: z.string(),
  kind: z.string().optional(),
  change_type: z.enum(['text', 'state', 'attributes']),
  previous_label: z.string().optional(),
  current_label: z.string().optional(),
});

const DeltaPayloadDeltaSchema = z.object({
  type: z.literal('delta'),
  context: z.enum(['base', 'overlay']),
  summary: z.string(),
  counts: DeltaCountsSchema,
  invalidated_refs: z.array(z.string()),
  added: z.array(DeltaNodeSummarySchema),
  modified: z.array(DeltaModifiedSummarySchema),
  removed_refs: z.array(z.string()),
});

const DeltaPayloadFullSchema = z.object({
  type: z.literal('full'),
  summary: z.string(),
  snapshot: z.string(),
  reason: z.string().optional(),
});

const DeltaPayloadNoChangeSchema = z.object({
  type: z.literal('no_change'),
  summary: z.string(),
});

const DeltaPayloadOverlayOpenedSchema = z.object({
  type: z.literal('overlay_opened'),
  summary: z.string(),
  invalidated_refs: z.array(z.string()),
  overlay: z.object({
    overlay_type: z.string(),
    root_ref: z.string(),
  }),
  counts: DeltaCountsSchema,
  nodes: z.array(DeltaNodeSummarySchema),
  transition: z.enum(['opened', 'replaced']).optional(),
  previous_overlay: z
    .object({
      overlay_type: z.string(),
      root_ref: z.string(),
      invalidated_refs: z.array(z.string()),
    })
    .optional(),
});

const DeltaPayloadOverlayClosedSchema = z.object({
  type: z.literal('overlay_closed'),
  summary: z.string(),
  overlay: z.object({
    overlay_type: z.string(),
    root_ref: z.string(),
  }),
  invalidated_refs: z.array(z.string()),
  base_changes: z
    .object({
      counts: DeltaCountsSchema,
      added: z.array(DeltaNodeSummarySchema),
      modified: z.array(DeltaModifiedSummarySchema),
      removed_refs: z.array(z.string()),
    })
    .optional(),
});

const DeltaPayloadSchema = z.discriminatedUnion('type', [
  DeltaPayloadDeltaSchema,
  DeltaPayloadFullSchema,
  DeltaPayloadNoChangeSchema,
  DeltaPayloadOverlayOpenedSchema,
  DeltaPayloadOverlayClosedSchema,
]);

// Deprecated: ActionDeltaPayloadSchema kept for backwards compatibility but no longer used
const _ActionDeltaPayloadSchema = z.object({
  action: z.object({
    name: z.string(),
    status: z.enum(['completed', 'failed', 'skipped']),
  }),
  pre_action: DeltaPayloadSchema.optional(),
  result: DeltaPayloadSchema,
  warnings: z.array(z.string()).optional(),
  error: z.string().optional(),
});

// ============================================================================
// SIMPLIFIED API - Clearer tool contracts for LLMs
// ============================================================================

// ============================================================================
// launch_browser - Launch a new browser instance
// ============================================================================

export const LaunchBrowserInputSchema = z.object({
  /** Run browser in headless mode (default: true) */
  headless: z.boolean().default(true),
});

export const LaunchBrowserOutputSchema = z.object({
  /** Session ID for the browser session */
  session_id: z.string(),
  /** Unique page identifier */
  page_id: z.string(),
  /** Current URL of the page */
  url: z.string(),
  /** Page title */
  title: z.string(),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Comprehensive JSON page summary for LLM context */
  page_summary: PageSummarySchema,
  /** Token count for page_summary */
  page_summary_tokens: z.number(),
});

export type LaunchBrowserInput = z.infer<typeof LaunchBrowserInputSchema>;
export type LaunchBrowserOutput = z.infer<typeof LaunchBrowserOutputSchema>;

// ============================================================================
// connect_browser - Connect to an existing browser instance
// ============================================================================

export const ConnectBrowserInputSchema = z.object({
  /** CDP endpoint URL (e.g., http://localhost:9223). Defaults to Athena CEF bridge host/port. */
  endpoint_url: z.string().optional(),
});

export const ConnectBrowserOutputSchema = z.object({
  /** Session ID for the browser session */
  session_id: z.string(),
  /** Unique page identifier */
  page_id: z.string(),
  /** Current URL of the page */
  url: z.string(),
  /** Page title */
  title: z.string(),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Comprehensive JSON page summary for LLM context */
  page_summary: PageSummarySchema,
  /** Token count for page_summary */
  page_summary_tokens: z.number(),
});

export type ConnectBrowserInput = z.infer<typeof ConnectBrowserInputSchema>;
export type ConnectBrowserOutput = z.infer<typeof ConnectBrowserOutputSchema>;

// ============================================================================
// close_page - Close a specific page
// ============================================================================

export const ClosePageInputSchema = z.object({
  /** Page ID to close */
  page_id: z.string(),
});

export const ClosePageOutputSchema = z.object({
  /** Whether the close operation succeeded */
  closed: z.boolean(),
  /** Page ID that was closed */
  page_id: z.string(),
});

export type ClosePageInput = z.infer<typeof ClosePageInputSchema>;
export type ClosePageOutput = z.infer<typeof ClosePageOutputSchema>;

// ============================================================================
// close_session - Close the entire browser session
// ============================================================================

export const CloseSessionInputSchema = z.object({});

export const CloseSessionOutputSchema = z.object({
  /** Whether the close operation succeeded */
  closed: z.boolean(),
});

export type CloseSessionInput = z.infer<typeof CloseSessionInputSchema>;
export type CloseSessionOutput = z.infer<typeof CloseSessionOutputSchema>;

// ============================================================================
// navigate - Navigate to a URL
// ============================================================================

export const NavigateInputSchema = z.object({
  /** URL to navigate to */
  url: z.string().url(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const NavigateOutputSchema = z.object({
  /** Page ID */
  page_id: z.string(),
  /** Final URL after navigation */
  url: z.string(),
  /** Page title */
  title: z.string(),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Comprehensive JSON page summary for LLM context */
  page_summary: PageSummarySchema,
  /** Token count for page_summary */
  page_summary_tokens: z.number(),
});

export type NavigateInput = z.infer<typeof NavigateInputSchema>;
export type NavigateOutput = z.infer<typeof NavigateOutputSchema>;

// ============================================================================
// go_back - Go back in browser history
// ============================================================================

export const GoBackInputSchema = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const GoBackOutputSchema = z.object({
  /** Page ID */
  page_id: z.string(),
  /** URL after going back */
  url: z.string(),
  /** Page title */
  title: z.string(),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Comprehensive JSON page summary for LLM context */
  page_summary: PageSummarySchema,
  /** Token count for page_summary */
  page_summary_tokens: z.number(),
});

export type GoBackInput = z.infer<typeof GoBackInputSchema>;
export type GoBackOutput = z.infer<typeof GoBackOutputSchema>;

// ============================================================================
// go_forward - Go forward in browser history
// ============================================================================

export const GoForwardInputSchema = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const GoForwardOutputSchema = z.object({
  /** Page ID */
  page_id: z.string(),
  /** URL after going forward */
  url: z.string(),
  /** Page title */
  title: z.string(),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Comprehensive JSON page summary for LLM context */
  page_summary: PageSummarySchema,
  /** Token count for page_summary */
  page_summary_tokens: z.number(),
});

export type GoForwardInput = z.infer<typeof GoForwardInputSchema>;
export type GoForwardOutput = z.infer<typeof GoForwardOutputSchema>;

// ============================================================================
// reload - Reload the current page
// ============================================================================

export const ReloadInputSchema = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const ReloadOutputSchema = z.object({
  /** Page ID */
  page_id: z.string(),
  /** URL after reload */
  url: z.string(),
  /** Page title */
  title: z.string(),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Comprehensive JSON page summary for LLM context */
  page_summary: PageSummarySchema,
  /** Token count for page_summary */
  page_summary_tokens: z.number(),
});

export type ReloadInput = z.infer<typeof ReloadInputSchema>;
export type ReloadOutput = z.infer<typeof ReloadOutputSchema>;

// ============================================================================
// capture_snapshot - Capture a fresh snapshot of the current page
// ============================================================================

export const CaptureSnapshotInputSchema = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const CaptureSnapshotOutputSchema = z.object({
  /** Page ID */
  page_id: z.string(),
  /** Current URL of the page */
  url: z.string(),
  /** Page title */
  title: z.string(),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Comprehensive JSON page summary for LLM context */
  page_summary: PageSummarySchema,
  /** Token count for page_summary */
  page_summary_tokens: z.number(),
});

export type CaptureSnapshotInput = z.infer<typeof CaptureSnapshotInputSchema>;
export type CaptureSnapshotOutput = z.infer<typeof CaptureSnapshotOutputSchema>;

// ============================================================================
// find_elements - Find elements by semantic criteria
// ============================================================================

export const FindElementsInputSchema = z.object({
  /** Filter by NodeKind (single or array) */
  kind: z.union([z.string(), z.array(z.string())]).optional(),
  /** Filter by label text (simple contains match) */
  label: z.string().optional(),
  /** Filter by semantic region (single or array) */
  region: z.union([z.string(), z.array(z.string())]).optional(),
  /** Maximum number of results (default: 10) */
  limit: z.number().int().min(1).max(100).default(10),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const FindElementsOutputSchema = z.object({
  /** Page ID */
  page_id: z.string(),
  /** Snapshot ID */
  snapshot_id: z.string(),
  /** Matched nodes */
  matches: z.array(
    z.object({
      node_id: z.string(),
      backend_node_id: z.number(),
      kind: z.string(),
      label: z.string(),
      selector: z.string(),
      region: z.string(),
      /** Element state */
      state: z
        .object({
          visible: z.boolean().optional(),
          enabled: z.boolean().optional(),
          checked: z.boolean().optional(),
          expanded: z.boolean().optional(),
          selected: z.boolean().optional(),
          focused: z.boolean().optional(),
          required: z.boolean().optional(),
          invalid: z.boolean().optional(),
          readonly: z.boolean().optional(),
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
        })
        .optional(),
    })
  ),
});

export type FindElementsInput = z.infer<typeof FindElementsInputSchema>;
export type FindElementsOutput = z.infer<typeof FindElementsOutputSchema>;

// ============================================================================
// get_node_details - Get full details for a specific node
// ============================================================================

export const GetNodeDetailsInputSchema = z.object({
  /** Node ID to get details for */
  node_id: z.string(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const GetNodeDetailsOutputSchema = z.object({
  /** Page ID */
  page_id: z.string(),
  /** Snapshot ID */
  snapshot_id: z.string(),
  /** Node details */
  node: NodeDetailsSchema,
});

export type GetNodeDetailsInput = z.infer<typeof GetNodeDetailsInputSchema>;
export type GetNodeDetailsOutput = z.infer<typeof GetNodeDetailsOutputSchema>;

// ============================================================================
// scroll_element_into_view - Scroll an element into view
// ============================================================================

export const ScrollElementIntoViewInputSchema = z.object({
  /** Node ID to scroll into view */
  node_id: z.string(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const ScrollElementIntoViewOutputSchema = z.object({
  /** Whether scroll succeeded */
  success: z.boolean(),
  /** Node ID that was scrolled into view */
  node_id: z.string(),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Comprehensive JSON page summary for LLM context */
  page_summary: PageSummarySchema,
  /** Token count for page_summary */
  page_summary_tokens: z.number(),
  /** Error message if action failed */
  error: z.string().optional(),
});

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

export const ScrollPageOutputSchema = z.object({
  /** Whether scroll succeeded */
  success: z.boolean(),
  /** Direction scrolled */
  direction: z.enum(['up', 'down']),
  /** Amount scrolled in pixels */
  amount: z.number(),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Comprehensive JSON page summary for LLM context */
  page_summary: PageSummarySchema,
  /** Token count for page_summary */
  page_summary_tokens: z.number(),
  /** Error message if action failed */
  error: z.string().optional(),
});

export type ScrollPageInput = z.infer<typeof ScrollPageInputSchema>;
export type ScrollPageOutput = z.infer<typeof ScrollPageOutputSchema>;

// ============================================================================
// Simplified mutation tools WITHOUT agent_version
// ============================================================================

/** Supported keyboard keys */
export const SupportedKeys = [
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

// click - Click an element (no agent_version)
export const ClickInputSchema = z.object({
  /** Node ID to click */
  node_id: z.string(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const ClickOutputSchema = z.object({
  /** Whether click succeeded */
  success: z.boolean(),
  /** Node ID that was clicked */
  node_id: z.string(),
  /** Label of clicked element */
  clicked_element: z.string().optional(),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Comprehensive JSON page summary for LLM context */
  page_summary: PageSummarySchema,
  /** Token count for page_summary */
  page_summary_tokens: z.number(),
  /** Error message if action failed */
  error: z.string().optional(),
});

export type ClickInput = z.infer<typeof ClickInputSchema>;
export type ClickOutput = z.infer<typeof ClickOutputSchema>;

// type - Type text into an element (node_id required, no agent_version)
export const TypeInputSchema = z.object({
  /** Text to type */
  text: z.string(),
  /** Node ID to type into (required) */
  node_id: z.string(),
  /** Clear existing text before typing (default: false) */
  clear: z.boolean().default(false),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const TypeOutputSchema = z.object({
  /** Whether typing succeeded */
  success: z.boolean(),
  /** Text that was typed */
  typed_text: z.string(),
  /** Node ID that received input */
  node_id: z.string(),
  /** Label of element typed into */
  element_label: z.string().optional(),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Comprehensive JSON page summary for LLM context */
  page_summary: PageSummarySchema,
  /** Token count for page_summary */
  page_summary_tokens: z.number(),
  /** Error message if action failed */
  error: z.string().optional(),
});

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

export const PressOutputSchema = z.object({
  /** Whether key press succeeded */
  success: z.boolean(),
  /** Key that was pressed */
  key: z.string(),
  /** Modifiers that were held */
  modifiers: z.array(z.string()).optional(),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Comprehensive JSON page summary for LLM context */
  page_summary: PageSummarySchema,
  /** Token count for page_summary */
  page_summary_tokens: z.number(),
  /** Error message if action failed */
  error: z.string().optional(),
});

export type PressInput = z.infer<typeof PressInputSchema>;
export type PressOutput = z.infer<typeof PressOutputSchema>;

// select - Select a dropdown option (no agent_version)
export const SelectInputSchema = z.object({
  /** Select element node_id */
  node_id: z.string(),
  /** Option value or visible text to select */
  value: z.string(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const SelectOutputSchema = z.object({
  /** Whether selection succeeded */
  success: z.boolean(),
  /** Node ID of the select element */
  node_id: z.string(),
  /** Value that was selected */
  selected_value: z.string(),
  /** Visible text of selected option */
  selected_text: z.string(),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Comprehensive JSON page summary for LLM context */
  page_summary: PageSummarySchema,
  /** Token count for page_summary */
  page_summary_tokens: z.number(),
  /** Error message if action failed */
  error: z.string().optional(),
});

export type SelectInput = z.infer<typeof SelectInputSchema>;
export type SelectOutput = z.infer<typeof SelectOutputSchema>;

// hover - Hover over an element (no agent_version)
export const HoverInputSchema = z.object({
  /** Node ID to hover over */
  node_id: z.string(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const HoverOutputSchema = z.object({
  /** Whether hover succeeded */
  success: z.boolean(),
  /** Node ID that was hovered */
  node_id: z.string(),
  /** Label of hovered element */
  element_label: z.string().optional(),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Comprehensive JSON page summary for LLM context */
  page_summary: PageSummarySchema,
  /** Token count for page_summary */
  page_summary_tokens: z.number(),
  /** Error message if action failed */
  error: z.string().optional(),
});

export type HoverInput = z.infer<typeof HoverInputSchema>;
export type HoverOutput = z.infer<typeof HoverOutputSchema>;
