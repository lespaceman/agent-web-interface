/**
 * MCP Tool Schemas
 *
 * Zod schemas for tool inputs and outputs.
 * Used for validation and type inference.
 */

import { z } from 'zod';

// ============================================================================
// browser_launch
// ============================================================================

export const BrowserLaunchInputSchema = z.object({
  /** Launch new browser or connect to existing */
  mode: z.enum(['launch', 'connect']).default('launch'),
  /** Run browser in headless mode (launch mode only) */
  headless: z.boolean().default(true),
  /** CDP endpoint URL (connect mode). Falls back to CEF_BRIDGE_HOST/PORT env vars */
  endpoint_url: z.string().optional(),
});

export const BrowserLaunchOutputSchema = z.object({
  /** Unique page identifier */
  page_id: z.string(),
  /** Current URL of the page */
  url: z.string(),
  /** Page title */
  title: z.string(),
  /** Connection mode used */
  mode: z.enum(['launched', 'connected']),
  /** Snapshot ID for the captured page state */
  snapshot_id: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Summary of interactive nodes */
  nodes: z.array(
    z.object({
      node_id: z.string(),
      kind: z.string(),
      label: z.string(),
      selector: z.string(),
    })
  ),
});

export type BrowserLaunchInput = z.infer<typeof BrowserLaunchInputSchema>;
export type BrowserLaunchOutput = z.infer<typeof BrowserLaunchOutputSchema>;

// ============================================================================
// browser_navigate
// ============================================================================

export const BrowserNavigateInputSchema = z.object({
  /** Page ID to navigate */
  page_id: z.string(),
  /** URL to navigate to */
  url: z.string().url(),
});

export const BrowserNavigateOutputSchema = z.object({
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
  /** Summary of interactive nodes */
  nodes: z.array(
    z.object({
      node_id: z.string(),
      kind: z.string(),
      label: z.string(),
      selector: z.string(),
    })
  ),
});

export type BrowserNavigateInput = z.infer<typeof BrowserNavigateInputSchema>;
export type BrowserNavigateOutput = z.infer<typeof BrowserNavigateOutputSchema>;

// ============================================================================
// browser_close
// ============================================================================

export const BrowserCloseInputSchema = z.object({
  /** Page ID to close. If omitted, closes entire session */
  page_id: z.string().optional(),
});

export const BrowserCloseOutputSchema = z.object({
  /** Whether the close operation succeeded */
  closed: z.boolean(),
});

export type BrowserCloseInput = z.infer<typeof BrowserCloseInputSchema>;
export type BrowserCloseOutput = z.infer<typeof BrowserCloseOutputSchema>;

// ============================================================================
// snapshot_capture
// ============================================================================

/** Summary of a node in snapshot output */
export const NodeSummarySchema = z.object({
  /** Unique node identifier within snapshot */
  node_id: z.string(),
  /** Semantic node type (button, link, input, etc.) */
  kind: z.string(),
  /** Human-readable label */
  label: z.string(),
  /** Playwright locator string */
  selector: z.string(),
});

export const SnapshotCaptureInputSchema = z.object({
  /** Page ID to capture */
  page_id: z.string(),
});

export const SnapshotCaptureOutputSchema = z.object({
  /** Unique snapshot identifier */
  snapshot_id: z.string(),
  /** Page URL at capture time */
  url: z.string(),
  /** Page title */
  title: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** Summary of interactive nodes */
  nodes: z.array(NodeSummarySchema),
});

export type NodeSummary = z.infer<typeof NodeSummarySchema>;
export type SnapshotCaptureInput = z.infer<typeof SnapshotCaptureInputSchema>;
export type SnapshotCaptureOutput = z.infer<typeof SnapshotCaptureOutputSchema>;

// ============================================================================
// action_click
// ============================================================================

export const ActionClickInputSchema = z.object({
  /** Page ID */
  page_id: z.string(),
  /** Node ID from snapshot to click */
  node_id: z.string(),
});

export const ActionClickOutputSchema = z.object({
  /** Whether click succeeded */
  success: z.boolean(),
  /** Node ID that was clicked */
  node_id: z.string(),
  /** Label of clicked element */
  clicked_element: z.string().optional(),
});

export type ActionClickInput = z.infer<typeof ActionClickInputSchema>;
export type ActionClickOutput = z.infer<typeof ActionClickOutputSchema>;

// ============================================================================
// get_node_details
// ============================================================================

export const GetNodeDetailsInputSchema = z.object({
  /** Page ID */
  page_id: z.string(),
  /** Node ID to get details for */
  node_id: z.string(),
});

/** Full node details including location, layout, state, and attributes */
export const NodeDetailsSchema = z.object({
  /** Unique node identifier */
  node_id: z.string(),
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

export const GetNodeDetailsOutputSchema = z.object({
  /** Page ID */
  page_id: z.string(),
  /** Snapshot ID the details are from */
  snapshot_id: z.string(),
  /** Requested node details */
  nodes: z.array(NodeDetailsSchema),
  /** Node IDs that were not found */
  not_found: z.array(z.string()).optional(),
});

export type GetNodeDetailsInput = z.infer<typeof GetNodeDetailsInputSchema>;
export type GetNodeDetailsOutput = z.infer<typeof GetNodeDetailsOutputSchema>;
export type NodeDetails = z.infer<typeof NodeDetailsSchema>;

// ============================================================================
// find_elements
// ============================================================================

/** State constraint for filtering by element state */
const StateConstraintSchema = z
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
  .optional();

/** Label filter - either a simple string or an object with options */
const LabelFilterSchema = z.union([
  z.string(),
  z.object({
    text: z.string(),
    mode: z.enum(['exact', 'contains']).default('contains'),
    caseSensitive: z.boolean().default(false),
  }),
]);

export const FindElementsInputSchema = z.object({
  /** Page ID to query */
  page_id: z.string(),
  /** Filter by NodeKind (single or array) */
  kind: z
    .union([
      z.string(),
      z.array(z.string()),
    ])
    .optional(),
  /** Filter by label text (string for contains, or object for options) */
  label: LabelFilterSchema.optional(),
  /** Filter by semantic region (single or array) */
  region: z
    .union([
      z.string(),
      z.array(z.string()),
    ])
    .optional(),
  /** Filter by state constraints */
  state: StateConstraintSchema,
  /** Filter by group identifier (exact match) */
  group_id: z.string().optional(),
  /** Filter by heading context (exact match) */
  heading_context: z.string().optional(),
  /** Maximum number of results (default: 10) */
  limit: z.number().int().min(1).max(100).default(10),
});

/** Matched node in find_elements response */
const MatchedNodeSchema = z.object({
  node_id: z.string(),
  kind: z.string(),
  label: z.string(),
  selector: z.string(),
  region: z.string(),
  group_id: z.string().optional(),
  heading_context: z.string().optional(),
});

/** Query statistics */
const QueryStatsSchema = z.object({
  total_matched: z.number(),
  query_time_ms: z.number(),
  nodes_evaluated: z.number(),
});

export const FindElementsOutputSchema = z.object({
  /** Page ID */
  page_id: z.string(),
  /** Snapshot ID the query was run against */
  snapshot_id: z.string(),
  /** Matched nodes */
  matches: z.array(MatchedNodeSchema),
  /** Query execution statistics */
  stats: QueryStatsSchema,
});

export type FindElementsInput = z.infer<typeof FindElementsInputSchema>;
export type FindElementsOutput = z.infer<typeof FindElementsOutputSchema>;
