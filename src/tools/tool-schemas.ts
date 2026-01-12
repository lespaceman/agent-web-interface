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

const ActionDeltaPayloadSchema = z.object({
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
// SIMPLIFIED V2 API - Clearer tool contracts for LLMs
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
  /** XML-compact page brief for LLM context */
  page_brief: z.string(),
  /** Token count for page_brief */
  page_brief_tokens: z.number(),
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
  /** XML-compact page brief for LLM context */
  page_brief: z.string(),
  /** Token count for page_brief */
  page_brief_tokens: z.number(),
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
  /** XML-compact page brief for LLM context */
  page_brief: z.string(),
  /** Token count for page_brief */
  page_brief_tokens: z.number(),
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
  /** XML-compact page brief for LLM context */
  page_brief: z.string(),
  /** Token count for page_brief */
  page_brief_tokens: z.number(),
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
  /** XML-compact page brief for LLM context */
  page_brief: z.string(),
  /** Token count for page_brief */
  page_brief_tokens: z.number(),
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
  /** XML-compact page brief for LLM context */
  page_brief: z.string(),
  /** Token count for page_brief */
  page_brief_tokens: z.number(),
});

export type ReloadInput = z.infer<typeof ReloadInputSchema>;
export type ReloadOutput = z.infer<typeof ReloadOutputSchema>;

// ============================================================================
// find_elements_v2 - Find elements by semantic criteria
// ============================================================================

export const FindElementsV2InputSchema = z.object({
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

export const FindElementsV2OutputSchema = z.object({
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
    })
  ),
});

export type FindElementsV2Input = z.infer<typeof FindElementsV2InputSchema>;
export type FindElementsV2Output = z.infer<typeof FindElementsV2OutputSchema>;

// ============================================================================
// get_node_details_v2 - Get full details for a specific node
// ============================================================================

export const GetNodeDetailsV2InputSchema = z.object({
  /** Node ID to get details for */
  node_id: z.string(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const GetNodeDetailsV2OutputSchema = z.object({
  /** Page ID */
  page_id: z.string(),
  /** Snapshot ID */
  snapshot_id: z.string(),
  /** Node details */
  node: NodeDetailsSchema,
});

export type GetNodeDetailsV2Input = z.infer<typeof GetNodeDetailsV2InputSchema>;
export type GetNodeDetailsV2Output = z.infer<typeof GetNodeDetailsV2OutputSchema>;

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
  /** Current page version after action */
  version: z.number().optional(),
  /** Structured action delta payload */
  delta: ActionDeltaPayloadSchema.optional(),
  /** Type of response (full, delta, no_change, overlay_opened, overlay_closed) */
  response_type: SnapshotResponseTypeSchema.optional(),
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
  /** Current page version after action */
  version: z.number().optional(),
  /** Structured action delta payload */
  delta: ActionDeltaPayloadSchema.optional(),
  /** Type of response (full, delta, no_change, overlay_opened, overlay_closed) */
  response_type: SnapshotResponseTypeSchema.optional(),
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

// click_v2 - Click an element (no agent_version)
export const ClickV2InputSchema = z.object({
  /** Node ID to click */
  node_id: z.string(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const ClickV2OutputSchema = z.object({
  /** Whether click succeeded */
  success: z.boolean(),
  /** Node ID that was clicked */
  node_id: z.string(),
  /** Label of clicked element */
  clicked_element: z.string().optional(),
  /** Current page version after action */
  version: z.number().optional(),
  /** Structured action delta payload */
  delta: ActionDeltaPayloadSchema.optional(),
  /** Type of response (full, delta, no_change, overlay_opened, overlay_closed) */
  response_type: SnapshotResponseTypeSchema.optional(),
});

export type ClickV2Input = z.infer<typeof ClickV2InputSchema>;
export type ClickV2Output = z.infer<typeof ClickV2OutputSchema>;

// type_v2 - Type text into an element (node_id required, no agent_version)
export const TypeV2InputSchema = z.object({
  /** Text to type */
  text: z.string(),
  /** Node ID to type into (required) */
  node_id: z.string(),
  /** Clear existing text before typing (default: false) */
  clear: z.boolean().default(false),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const TypeV2OutputSchema = z.object({
  /** Whether typing succeeded */
  success: z.boolean(),
  /** Text that was typed */
  typed_text: z.string(),
  /** Node ID that received input */
  node_id: z.string(),
  /** Label of element typed into */
  element_label: z.string().optional(),
  /** Current page version after action */
  version: z.number().optional(),
  /** Structured action delta payload */
  delta: ActionDeltaPayloadSchema.optional(),
  /** Type of response (full, delta, no_change, overlay_opened, overlay_closed) */
  response_type: SnapshotResponseTypeSchema.optional(),
});

export type TypeV2Input = z.infer<typeof TypeV2InputSchema>;
export type TypeV2Output = z.infer<typeof TypeV2OutputSchema>;

// press_v2 - Press a keyboard key (no agent_version)
export const PressV2InputSchema = z.object({
  /** Key to press */
  key: z.enum(SupportedKeys),
  /** Modifier keys to hold (Control, Shift, Alt, Meta) */
  modifiers: z.array(z.enum(['Control', 'Shift', 'Alt', 'Meta'])).optional(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const PressV2OutputSchema = z.object({
  /** Whether key press succeeded */
  success: z.boolean(),
  /** Key that was pressed */
  key: z.string(),
  /** Modifiers that were held */
  modifiers: z.array(z.string()).optional(),
  /** Current page version after action */
  version: z.number().optional(),
  /** Structured action delta payload */
  delta: ActionDeltaPayloadSchema.optional(),
  /** Type of response (full, delta, no_change, overlay_opened, overlay_closed) */
  response_type: SnapshotResponseTypeSchema.optional(),
});

export type PressV2Input = z.infer<typeof PressV2InputSchema>;
export type PressV2Output = z.infer<typeof PressV2OutputSchema>;

// select_v2 - Select a dropdown option (no agent_version)
export const SelectV2InputSchema = z.object({
  /** Select element node_id */
  node_id: z.string(),
  /** Option value or visible text to select */
  value: z.string(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const SelectV2OutputSchema = z.object({
  /** Whether selection succeeded */
  success: z.boolean(),
  /** Node ID of the select element */
  node_id: z.string(),
  /** Value that was selected */
  selected_value: z.string(),
  /** Visible text of selected option */
  selected_text: z.string(),
  /** Current page version after action */
  version: z.number().optional(),
  /** Structured action delta payload */
  delta: ActionDeltaPayloadSchema.optional(),
  /** Type of response (full, delta, no_change, overlay_opened, overlay_closed) */
  response_type: SnapshotResponseTypeSchema.optional(),
});

export type SelectV2Input = z.infer<typeof SelectV2InputSchema>;
export type SelectV2Output = z.infer<typeof SelectV2OutputSchema>;

// hover_v2 - Hover over an element (no agent_version)
export const HoverV2InputSchema = z.object({
  /** Node ID to hover over */
  node_id: z.string(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});

export const HoverV2OutputSchema = z.object({
  /** Whether hover succeeded */
  success: z.boolean(),
  /** Node ID that was hovered */
  node_id: z.string(),
  /** Label of hovered element */
  element_label: z.string().optional(),
  /** Current page version after action */
  version: z.number().optional(),
  /** Structured action delta payload */
  delta: ActionDeltaPayloadSchema.optional(),
  /** Type of response (full, delta, no_change, overlay_opened, overlay_closed) */
  response_type: SnapshotResponseTypeSchema.optional(),
});

export type HoverV2Input = z.infer<typeof HoverV2InputSchema>;
export type HoverV2Output = z.infer<typeof HoverV2OutputSchema>;
