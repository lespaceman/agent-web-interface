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
  /** Include raw node summary in response (default: false) */
  include_nodes: z.boolean().default(false),
  /** Include full FactPack JSON in response (default: false). Use when you need structured access to dialogs, forms, actions. */
  include_factpack: z.boolean().default(false),
  /** FactPack extraction options */
  factpack_options: z
    .object({
      max_actions: z.number().int().min(1).max(50).optional(),
      min_action_score: z.number().min(0).max(1).optional(),
      include_disabled_fields: z.boolean().optional(),
    })
    .optional(),
});

// Forward declaration for FactPack (defined later in file)
// The actual schema is FactPackSchema defined below
const FactPackSchemaLazy = z.lazy(() => FactPackSchema);

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
  /** XML-compact page brief for LLM context (always included) */
  page_brief: z.string(),
  /** Token count for page_brief */
  page_brief_tokens: z.number(),
  /** Extracted FactPack with page understanding (only when include_factpack: true) */
  factpack: FactPackSchemaLazy.optional(),
  /** Summary of interactive nodes (only when include_nodes: true) */
  nodes: z
    .array(
      z.object({
        node_id: z.string(),
        kind: z.string(),
        label: z.string(),
        selector: z.string(),
      })
    )
    .optional(),
});

export type BrowserLaunchInput = z.infer<typeof BrowserLaunchInputSchema>;
export type BrowserLaunchOutput = z.infer<typeof BrowserLaunchOutputSchema>;

// ============================================================================
// browser_navigate
// ============================================================================

export const BrowserNavigateInputSchema = z.object({
  /** Page ID to navigate. If omitted, uses most recently used page (or creates one if none exist) */
  page_id: z.string().optional(),
  /** URL to navigate to */
  url: z.string().url(),
  /** Include raw node summary in response (default: false) */
  include_nodes: z.boolean().default(false),
  /** Include full FactPack JSON in response (default: false). Use when you need structured access to dialogs, forms, actions. */
  include_factpack: z.boolean().default(false),
  /** FactPack extraction options */
  factpack_options: z
    .object({
      max_actions: z.number().int().min(1).max(50).optional(),
      min_action_score: z.number().min(0).max(1).optional(),
      include_disabled_fields: z.boolean().optional(),
    })
    .optional(),
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
  /** XML-compact page brief for LLM context (always included) */
  page_brief: z.string(),
  /** Token count for page_brief */
  page_brief_tokens: z.number(),
  /** Extracted FactPack with page understanding (only when include_factpack: true) */
  factpack: FactPackSchemaLazy.optional(),
  /** Summary of interactive nodes (only when include_nodes: true) */
  nodes: z
    .array(
      z.object({
        node_id: z.string(),
        kind: z.string(),
        label: z.string(),
        selector: z.string(),
      })
    )
    .optional(),
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
  /** Page ID to capture. If omitted, uses most recently used page */
  page_id: z.string().optional(),
  /** Include raw node summary in response (default: false) */
  include_nodes: z.boolean().default(false),
  /** Include full FactPack JSON in response (default: false). Use when you need structured access to dialogs, forms, actions. */
  include_factpack: z.boolean().default(false),
  /** FactPack extraction options */
  factpack_options: z
    .object({
      max_actions: z.number().int().min(1).max(50).optional(),
      min_action_score: z.number().min(0).max(1).optional(),
      include_disabled_fields: z.boolean().optional(),
    })
    .optional(),
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
  /** XML-compact page brief for LLM context (always included) */
  page_brief: z.string(),
  /** Token count for page_brief */
  page_brief_tokens: z.number(),
  /** Extracted FactPack with page understanding (only when include_factpack: true) */
  factpack: FactPackSchemaLazy.optional(),
  /** Summary of interactive nodes (only when include_nodes: true) */
  nodes: z.array(NodeSummarySchema).optional(),
});

export type NodeSummary = z.infer<typeof NodeSummarySchema>;
export type SnapshotCaptureInput = z.infer<typeof SnapshotCaptureInputSchema>;
export type SnapshotCaptureOutput = z.infer<typeof SnapshotCaptureOutputSchema>;

// ============================================================================
// action_click
// ============================================================================

export const ActionClickInputSchema = z.object({
  /** Page ID. If omitted, uses most recently used page */
  page_id: z.string().optional(),
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
  /** Page ID. If omitted, uses most recently used page */
  page_id: z.string().optional(),
  /** Node ID to get details for */
  node_id: z.string(),
});

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

/** Options for fuzzy matching behavior */
const FuzzyMatchOptionsSchema = z.object({
  /** Minimum token overlap ratio (0-1) for a match. Default: 0.5 */
  minTokenOverlap: z.number().min(0).max(1).optional(),
  /** Enable prefix matching for tokens. Default: true */
  prefixMatch: z.boolean().optional(),
  /** Minimum edit distance similarity (0-1) for similar tokens. Default: 0.8 */
  minSimilarity: z.number().min(0).max(1).optional(),
});

/** Label filter - either a simple string or an object with options */
const LabelFilterSchema = z.union([
  z.string(),
  z.object({
    text: z.string(),
    mode: z.enum(['exact', 'contains', 'fuzzy']).default('contains'),
    caseSensitive: z.boolean().default(false),
    fuzzyOptions: FuzzyMatchOptionsSchema.optional(),
  }),
]);

export const FindElementsInputSchema = z.object({
  /** Page ID to query. If omitted, uses most recently used page */
  page_id: z.string().optional(),
  /** Filter by NodeKind (single or array) */
  kind: z.union([z.string(), z.array(z.string())]).optional(),
  /** Filter by label text (string for contains, or object for options) */
  label: LabelFilterSchema.optional(),
  /** Filter by semantic region (single or array) */
  region: z.union([z.string(), z.array(z.string())]).optional(),
  /** Filter by state constraints */
  state: StateConstraintSchema,
  /** Filter by group identifier (exact match) */
  group_id: z.string().optional(),
  /** Filter by heading context (exact match) */
  heading_context: z.string().optional(),
  /** Maximum number of results (default: 10) */
  limit: z.number().int().min(1).max(100).default(10),
  /** Minimum relevance score (0-1) to include in results */
  min_score: z.number().min(0).max(1).optional(),
  /** Sort results by relevance (default: false, maintains document order) */
  sort_by_relevance: z.boolean().default(false).optional(),
  /** Include disambiguation suggestions when results are ambiguous */
  include_suggestions: z.boolean().default(false).optional(),
});

/** Matched node in find_elements response */
const MatchedNodeSchema = z.object({
  node_id: z.string(),
  backend_node_id: z.number(),
  kind: z.string(),
  label: z.string(),
  selector: z.string(),
  region: z.string(),
  group_id: z.string().optional(),
  heading_context: z.string().optional(),
  /** Relevance score (0-1, 1 = perfect match) */
  relevance: z.number().min(0).max(1).optional(),
});

/** Query statistics */
const QueryStatsSchema = z.object({
  total_matched: z.number(),
  query_time_ms: z.number(),
  nodes_evaluated: z.number(),
});

/** Disambiguation suggestion for refining ambiguous queries */
const DisambiguationSuggestionSchema = z.object({
  /** Type of refinement suggested */
  type: z.enum(['refine_kind', 'refine_region', 'refine_label', 'add_state', 'refine_group']),
  /** Human-readable suggestion message */
  message: z.string(),
  /** Query refinement to apply */
  refinement: z.record(z.unknown()),
  /** How many matches this refinement would reduce to */
  expected_matches: z.number(),
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
  /** Disambiguation suggestions when query matches multiple similar elements */
  suggestions: z.array(DisambiguationSuggestionSchema).optional(),
});

export type FindElementsInput = z.infer<typeof FindElementsInputSchema>;
export type FindElementsOutput = z.infer<typeof FindElementsOutputSchema>;

// ============================================================================
// FactPack Schemas
// ============================================================================

/**
 * Options for FactPack extraction.
 */
export const FactPackOptionsSchema = z.object({
  /** Max actions to select (default: 12) */
  max_actions: z.number().int().min(1).max(50).optional(),
  /** Min action score threshold (default: 0.2) */
  min_action_score: z.number().min(0).max(1).optional(),
  /** Include disabled form fields (default: true) */
  include_disabled_fields: z.boolean().optional(),
});

export type FactPackOptions = z.infer<typeof FactPackOptionsSchema>;

// --- Dialog schemas ---

const DialogActionSchema = z.object({
  node_id: z.string(),
  backend_node_id: z.number(),
  label: z.string(),
  role: z.enum(['primary', 'secondary', 'dismiss', 'unknown']),
  kind: z.string(),
});

const BBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const DetectedDialogSchema = z.object({
  node_id: z.string(),
  backend_node_id: z.number(),
  bbox: BBoxSchema,
  is_modal: z.boolean(),
  title: z.string().optional(),
  actions: z.array(DialogActionSchema),
  detection_method: z.enum([
    'role-dialog',
    'role-alertdialog',
    'html-dialog',
    'aria-modal',
    'heuristic',
  ]),
  type: z.enum([
    'modal',
    'alert',
    'confirm',
    'cookie-consent',
    'newsletter',
    'login-prompt',
    'age-gate',
    'unknown',
  ]),
  type_confidence: z.number(),
  classification_signals: z.array(z.string()),
});

const DialogDetectionResultSchema = z.object({
  dialogs: z.array(DetectedDialogSchema),
  has_blocking_dialog: z.boolean(),
  meta: z.object({
    total_detected: z.number(),
    classified_count: z.number(),
    detection_time_ms: z.number(),
  }),
});

// --- Form schemas ---

const FormFieldSchema = z.object({
  node_id: z.string(),
  backend_node_id: z.number(),
  kind: z.string(),
  label: z.string(),
  input_type: z.string(),
  required: z.boolean(),
  invalid: z.boolean(),
  disabled: z.boolean(),
  readonly: z.boolean(),
  has_value: z.boolean(),
  placeholder: z.string().optional(),
  autocomplete: z.string().optional(),
  semantic_type: z.string(),
  semantic_confidence: z.number(),
});

const FormSubmitButtonSchema = z.object({
  node_id: z.string(),
  backend_node_id: z.number(),
  label: z.string(),
  enabled: z.boolean(),
  visible: z.boolean(),
});

const FormValidationSchema = z.object({
  has_errors: z.boolean(),
  error_count: z.number(),
  required_unfilled: z.number(),
  ready_to_submit: z.boolean(),
});

const DetectedFormSchema = z.object({
  node_id: z.string(),
  backend_node_id: z.number(),
  title: z.string().optional(),
  action: z.string().optional(),
  method: z.string().optional(),
  fields: z.array(FormFieldSchema),
  submit_button: FormSubmitButtonSchema.optional(),
  validation: FormValidationSchema,
  purpose: z.string(),
  purpose_confidence: z.number(),
  purpose_signals: z.array(z.string()),
});

const FormDetectionResultSchema = z.object({
  forms: z.array(DetectedFormSchema),
  primary_form: DetectedFormSchema.optional(),
  meta: z.object({
    total_detected: z.number(),
    classified_count: z.number(),
    detection_time_ms: z.number(),
  }),
});

// --- Action schemas ---

const ActionSignalSchema = z.object({
  type: z.string(),
  weight: z.number(),
});

const SelectedActionSchema = z.object({
  node_id: z.string(),
  backend_node_id: z.number(),
  label: z.string(),
  kind: z.string(),
  region: z.string(),
  locator: z.string(),
  enabled: z.boolean(),
  score: z.number(),
  signals: z.array(ActionSignalSchema),
  category: z.string(),
  category_confidence: z.number(),
});

const ActionSelectionResultSchema = z.object({
  actions: z.array(SelectedActionSchema),
  primary_cta: SelectedActionSchema.optional(),
  meta: z.object({
    candidates_evaluated: z.number(),
    selection_time_ms: z.number(),
  }),
});

// --- Page classification schemas ---

const PageSignalSchema = z.object({
  source: z.enum(['url', 'title', 'content', 'form', 'element']),
  signal: z.string(),
  evidence: z.string(),
  weight: z.number(),
});

const PageEntitySchema = z.object({
  type: z.string(),
  value: z.string(),
  node_id: z.string().optional(),
  confidence: z.number(),
});

const PageClassificationSchema = z.object({
  type: z.string(),
  confidence: z.number(),
  secondary_type: z.string().optional(),
  secondary_confidence: z.number().optional(),
  signals: z.array(PageSignalSchema),
  entities: z.array(PageEntitySchema),
  has_forms: z.boolean(),
  has_navigation: z.boolean(),
  has_main_content: z.boolean(),
  has_search: z.boolean(),
});

const PageClassificationResultSchema = z.object({
  classification: PageClassificationSchema,
  meta: z.object({
    signals_evaluated: z.number(),
    classification_time_ms: z.number(),
  }),
});

// --- Complete FactPack schema ---

export const FactPackSchema = z.object({
  page_type: PageClassificationResultSchema,
  dialogs: DialogDetectionResultSchema,
  forms: FormDetectionResultSchema,
  actions: ActionSelectionResultSchema,
  meta: z.object({
    snapshot_id: z.string(),
    extraction_time_ms: z.number(),
  }),
});

export type FactPackOutput = z.infer<typeof FactPackSchema>;

// ============================================================================
// get_factpack
// ============================================================================

export const GetFactPackInputSchema = z.object({
  /** Page ID to get FactPack for. If omitted, uses most recently used page */
  page_id: z.string().optional(),
  /** Specific snapshot ID (defaults to latest for page) */
  snapshot_id: z.string().optional(),
  /** Max actions to select (default: 12) */
  max_actions: z.number().int().min(1).max(50).optional(),
  /** Min action score threshold (default: 0.2) */
  min_action_score: z.number().min(0).max(1).optional(),
  /** Include disabled form fields (default: true) */
  include_disabled_fields: z.boolean().optional(),
  /** Include rendered page_brief XML in response (default: false) */
  include_page_brief: z.boolean().default(false),
});

export const GetFactPackOutputSchema = z.object({
  /** Page ID */
  page_id: z.string(),
  /** Snapshot ID the FactPack was extracted from */
  snapshot_id: z.string(),
  /** Extracted FactPack */
  factpack: FactPackSchema,
  /** XML-compact page brief (only when include_page_brief: true) */
  page_brief: z.string().optional(),
  /** Token count for page_brief (only when include_page_brief: true) */
  page_brief_tokens: z.number().optional(),
});

export type GetFactPackInput = z.infer<typeof GetFactPackInputSchema>;
export type GetFactPackOutput = z.infer<typeof GetFactPackOutputSchema>;

// ============================================================================
// NEW SIMPLIFIED API - Tools with simple verb names
// ============================================================================

// ============================================================================
// open - Start browser session
// ============================================================================

export const OpenInputSchema = z.object({
  /** Run browser in headless mode (default: true) */
  headless: z.boolean().default(true),
  /** CDP endpoint URL to connect to existing browser (optional) */
  connect_to: z.string().optional(),
});

export const OpenOutputSchema = z.object({
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
  /** XML-compact page brief for LLM context */
  page_brief: z.string(),
  /** Token count for page_brief */
  page_brief_tokens: z.number(),
});

export type OpenInput = z.infer<typeof OpenInputSchema>;
export type OpenOutput = z.infer<typeof OpenOutputSchema>;

// ============================================================================
// close - End browser session
// ============================================================================

export const CloseInputSchema = z.object({
  /** Page ID to close. If omitted, closes entire session */
  page_id: z.string().optional(),
});

export const CloseOutputSchema = z.object({
  /** Whether the close operation succeeded */
  closed: z.boolean(),
});

export type CloseInput = z.infer<typeof CloseInputSchema>;
export type CloseOutput = z.infer<typeof CloseOutputSchema>;

// ============================================================================
// goto - Navigate (URL, back, forward, refresh)
// ============================================================================

/** Base schema for goto input (exported for .shape access in MCP registration) */
export const GotoInputSchemaBase = z.object({
  /** URL to navigate to */
  url: z.string().url().optional(),
  /** Go back in history */
  back: z.boolean().optional(),
  /** Go forward in history */
  forward: z.boolean().optional(),
  /** Refresh the page */
  refresh: z.boolean().optional(),
  /** Page ID. If omitted, uses most recently used page */
  page_id: z.string().optional(),
});

/** Full schema with refinement (used for validation) */
export const GotoInputSchema = GotoInputSchemaBase.refine(
  // Using || for intentional truthy check (not nullish coalescing)
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  (data) => data.url || data.back || data.forward || data.refresh,
  { message: 'Must provide url, back, forward, or refresh' }
);

export const GotoOutputSchema = z.object({
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

export type GotoInput = z.infer<typeof GotoInputSchema>;
export type GotoOutput = z.infer<typeof GotoOutputSchema>;

// ============================================================================
// snapshot - Capture/refresh page state
// ============================================================================

export const SnapshotInputSchema = z.object({
  /** Page ID. If omitted, uses most recently used page */
  page_id: z.string().optional(),
  /** Include raw node summary in response (default: false) */
  include_nodes: z.boolean().default(false),
});

export const SnapshotOutputSchema = z.object({
  /** Snapshot ID */
  snapshot_id: z.string(),
  /** Page URL */
  url: z.string(),
  /** Page title */
  title: z.string(),
  /** Total nodes captured */
  node_count: z.number(),
  /** Interactive nodes captured */
  interactive_count: z.number(),
  /** XML-compact page brief for LLM context */
  page_brief: z.string(),
  /** Token count for page_brief */
  page_brief_tokens: z.number(),
  /** Summary of interactive nodes (only when include_nodes: true) */
  nodes: z.array(NodeSummarySchema).optional(),
});

export type SnapshotInput = z.infer<typeof SnapshotInputSchema>;
export type SnapshotOutput = z.infer<typeof SnapshotOutputSchema>;

// ============================================================================
// find - Find elements by criteria OR get specific node details
// ============================================================================

export const FindInputSchema = z.object({
  /** Get specific node details by node_id (detail mode) */
  node_id: z.string().optional(),
  /** Filter by NodeKind (query mode) */
  kind: z.union([z.string(), z.array(z.string())]).optional(),
  /** Filter by label text */
  label: z.string().optional(),
  /** Filter by semantic region */
  region: z.union([z.string(), z.array(z.string())]).optional(),
  /** Maximum results (default: 10) */
  limit: z.number().int().min(1).max(100).default(10),
  /** Page ID. If omitted, uses most recently used page */
  page_id: z.string().optional(),
});

export const FindOutputSchema = z.object({
  /** Page ID */
  page_id: z.string(),
  /** Snapshot ID */
  snapshot_id: z.string(),
  /** Matched nodes (query mode) */
  matches: z
    .array(
      z.object({
        node_id: z.string(),
        backend_node_id: z.number(),
        kind: z.string(),
        label: z.string(),
        selector: z.string(),
        region: z.string(),
      })
    )
    .optional(),
  /** Node details (detail mode) */
  node: NodeDetailsSchema.optional(),
});

export type FindInput = z.infer<typeof FindInputSchema>;
export type FindOutput = z.infer<typeof FindOutputSchema>;

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

// ============================================================================
// click - Click an element
// ============================================================================

export const ClickInputSchema = z.object({
  /** Node ID to click */
  node_id: z.string(),
  /** Page ID. If omitted, uses most recently used page */
  page_id: z.string().optional(),
  /** Agent's last known page version for delta computation */
  agent_version: z.number().optional(),
});

export const ClickOutputSchema = z.object({
  /** Whether click succeeded */
  success: z.boolean(),
  /** Node ID that was clicked */
  node_id: z.string(),
  /** Label of clicked element */
  clicked_element: z.string().optional(),
  /** Current page version after action */
  version: z.number().optional(),
  /** Delta or full snapshot content */
  delta: z.string().optional(),
  /** Type of response (full, delta, no_change, overlay_opened, overlay_closed) */
  response_type: SnapshotResponseTypeSchema.optional(),
});

export type ClickInput = z.infer<typeof ClickInputSchema>;
export type ClickOutput = z.infer<typeof ClickOutputSchema>;

// ============================================================================
// type - Type text into an element
// ============================================================================

export const TypeInputSchema = z.object({
  /** Text to type */
  text: z.string(),
  /** Node ID to type into. If omitted, types into focused element */
  node_id: z.string().optional(),
  /** Clear existing text before typing (default: false) */
  clear: z.boolean().default(false),
  /** Page ID. If omitted, uses most recently used page */
  page_id: z.string().optional(),
  /** Agent's last known page version for delta computation */
  agent_version: z.number().optional(),
});

export const TypeOutputSchema = z.object({
  /** Whether typing succeeded */
  success: z.boolean(),
  /** Text that was typed */
  typed_text: z.string(),
  /** Node ID that received input */
  node_id: z.string().optional(),
  /** Label of element typed into */
  element_label: z.string().optional(),
  /** Current page version after action */
  version: z.number().optional(),
  /** Delta or full snapshot content */
  delta: z.string().optional(),
  /** Type of response (full, delta, no_change, overlay_opened, overlay_closed) */
  response_type: SnapshotResponseTypeSchema.optional(),
});

export type TypeInput = z.infer<typeof TypeInputSchema>;
export type TypeOutput = z.infer<typeof TypeOutputSchema>;

// ============================================================================
// press - Press a keyboard key
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

export const PressInputSchema = z.object({
  /** Key to press */
  key: z.enum(SupportedKeys),
  /** Modifier keys to hold (Control, Shift, Alt, Meta) */
  modifiers: z.array(z.enum(['Control', 'Shift', 'Alt', 'Meta'])).optional(),
  /** Page ID. If omitted, uses most recently used page */
  page_id: z.string().optional(),
  /** Agent's last known page version for delta computation */
  agent_version: z.number().optional(),
});

export const PressOutputSchema = z.object({
  /** Whether key press succeeded */
  success: z.boolean(),
  /** Key that was pressed */
  key: z.string(),
  /** Modifiers that were held */
  modifiers: z.array(z.string()).optional(),
  /** Current page version after action */
  version: z.number().optional(),
  /** Delta or full snapshot content */
  delta: z.string().optional(),
  /** Type of response (full, delta, no_change, overlay_opened, overlay_closed) */
  response_type: SnapshotResponseTypeSchema.optional(),
});

export type PressInput = z.infer<typeof PressInputSchema>;
export type PressOutput = z.infer<typeof PressOutputSchema>;

// ============================================================================
// select - Select a dropdown option
// ============================================================================

export const SelectInputSchema = z.object({
  /** Select element node_id */
  node_id: z.string(),
  /** Option value or visible text to select */
  value: z.string(),
  /** Page ID. If omitted, uses most recently used page */
  page_id: z.string().optional(),
  /** Agent's last known page version for delta computation */
  agent_version: z.number().optional(),
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
  /** Current page version after action */
  version: z.number().optional(),
  /** Delta or full snapshot content */
  delta: z.string().optional(),
  /** Type of response (full, delta, no_change, overlay_opened, overlay_closed) */
  response_type: SnapshotResponseTypeSchema.optional(),
});

export type SelectInput = z.infer<typeof SelectInputSchema>;
export type SelectOutput = z.infer<typeof SelectOutputSchema>;

// ============================================================================
// hover - Hover over an element
// ============================================================================

export const HoverInputSchema = z.object({
  /** Node ID to hover over */
  node_id: z.string(),
  /** Page ID. If omitted, uses most recently used page */
  page_id: z.string().optional(),
  /** Agent's last known page version for delta computation */
  agent_version: z.number().optional(),
});

export const HoverOutputSchema = z.object({
  /** Whether hover succeeded */
  success: z.boolean(),
  /** Node ID that was hovered */
  node_id: z.string(),
  /** Label of hovered element */
  element_label: z.string().optional(),
  /** Current page version after action */
  version: z.number().optional(),
  /** Delta or full snapshot content */
  delta: z.string().optional(),
  /** Type of response (full, delta, no_change, overlay_opened, overlay_closed) */
  response_type: SnapshotResponseTypeSchema.optional(),
});

export type HoverInput = z.infer<typeof HoverInputSchema>;
export type HoverOutput = z.infer<typeof HoverOutputSchema>;

// ============================================================================
// scroll - Scroll page or element into view
// ============================================================================

/** Base schema for scroll input (exported for .shape access in MCP registration) */
export const ScrollInputSchemaBase = z.object({
  /** Node ID to scroll into view */
  node_id: z.string().optional(),
  /** Scroll direction (when no node_id) */
  direction: z.enum(['up', 'down']).optional(),
  /** Scroll amount in pixels (default: 500) */
  amount: z.number().default(500),
  /** Page ID. If omitted, uses most recently used page */
  page_id: z.string().optional(),
  /** Agent's last known page version for delta computation */
  agent_version: z.number().optional(),
});

/** Full schema with refinement (used for validation) */
export const ScrollInputSchema = ScrollInputSchemaBase.refine(
  // Using || for intentional truthy check (not nullish coalescing)
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  (data) => data.node_id || data.direction,
  { message: 'Must provide node_id or direction' }
);

export const ScrollOutputSchema = z.object({
  /** Whether scroll succeeded */
  success: z.boolean(),
  /** What was scrolled */
  scrolled: z.enum(['element', 'page']),
  /** Direction scrolled (for page scroll) */
  direction: z.enum(['up', 'down']).optional(),
  /** Amount scrolled (for page scroll) */
  amount: z.number().optional(),
  /** Current page version after action */
  version: z.number().optional(),
  /** Delta or full snapshot content */
  delta: z.string().optional(),
  /** Type of response (full, delta, no_change, overlay_opened, overlay_closed) */
  response_type: SnapshotResponseTypeSchema.optional(),
});

export type ScrollInput = z.infer<typeof ScrollInputSchema>;
export type ScrollOutput = z.infer<typeof ScrollOutputSchema>;
