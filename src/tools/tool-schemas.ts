/**
 * MCP Tool Schemas
 *
 * Zod schemas for tool inputs and outputs.
 * Used for validation and type inference.
 */

import { z } from 'zod';

// ============================================================================
// Runtime Health Schema (CDP + Snapshot health telemetry)
// ============================================================================

/**
 * Snapshot health codes - specific reasons for snapshot failures.
 */
export const SnapshotHealthCodeSchema = z.enum([
  'HEALTHY', // Snapshot valid and complete
  'PENDING_DOM', // DOM not ready (still loading)
  'AX_EMPTY', // Accessibility tree empty (AX extraction failed)
  'DOM_EMPTY', // DOM tree empty (DOM extraction failed)
  'CDP_SESSION_DEAD', // CDP session closed/detached
  'UNKNOWN', // Other failure
]);

/**
 * CDP session health status.
 */
export const CdpHealthSchema = z.object({
  /** Whether CDP session is operational */
  ok: z.boolean(),
  /** Whether recovery was attempted and succeeded */
  recovered: z.boolean().optional(),
  /** Recovery method used if recovery occurred */
  recovery_method: z.literal('rebind').optional(),
  /** Error message if not ok */
  error: z.string().optional(),
});

/**
 * Snapshot capture health status.
 */
export const SnapshotCaptureHealthSchema = z.object({
  /** Whether snapshot is usable */
  ok: z.boolean(),
  /** Whether recovery was attempted */
  recovered: z.boolean().optional(),
  /** Health code explaining status */
  code: SnapshotHealthCodeSchema,
  /** Number of capture attempts */
  attempts: z.number().optional(),
  /** Human-readable message */
  message: z.string().optional(),
});

/**
 * Runtime health info included in tool responses.
 * Enables LLM to understand CDP/snapshot recovery status.
 */
export const RuntimeHealthSchema = z.object({
  /** CDP session health */
  cdp: CdpHealthSchema,
  /** Snapshot capture health */
  snapshot: SnapshotCaptureHealthSchema,
});

export type RuntimeHealth = z.infer<typeof RuntimeHealthSchema>;

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
// State Response Schema (NEW: StateHandle + Diff + Actionables)
// ============================================================================

/**
 * Locator information for element targeting.
 */
export const LocatorInfoSchema = z.object({
  preferred: z.object({ ax: z.string() }),
  fallback: z.object({ css: z.string() }).optional(),
});

/**
 * Element target reference - for direct targeting via backend_node_id.
 * Included in actionables to enable direct element interaction.
 */
export const ElementTargetRefSchema = z.object({
  /** Snapshot that produced this ref */
  snapshot_id: z.string(),
  /** CDP backend node ID - primary targeting method */
  backend_node_id: z.number(),
  /** CDP frame ID - for cross-frame targeting */
  frame_id: z.string().optional(),
  /** CDP loader ID - changes on navigation */
  loader_id: z.string().optional(),
});

/**
 * Actionable element information.
 * Returned as a capped list of interactive elements in the active layer.
 *
 * NEW: Includes `ref` for direct element targeting. Use `eid` for stable
 * identity across snapshots, and `ref.backend_node_id` for immediate actions.
 */
export const ActionableInfoSchema = z.object({
  eid: z.string(),
  kind: z.string(),
  name: z.string(),
  role: z.string(),
  vis: z.boolean(),
  ena: z.boolean(),
  /** Element target reference for direct interaction */
  ref: ElementTargetRefSchema,
  loc: LocatorInfoSchema,
  ctx: z.object({
    layer: z.string(),
    group: z.string().optional(),
  }),
  chk: z.boolean().optional(),
  sel: z.boolean().optional(),
  exp: z.boolean().optional(),
  foc: z.boolean().optional(),
  req: z.boolean().optional(),
  inv: z.boolean().optional(),
  rdo: z.boolean().optional(),
  val_hint: z.string().optional(),
  placeholder: z.string().optional(),
  href: z.string().optional(),
  type: z.string().optional(),
});

/**
 * State handle - core state metadata.
 */
export const StateHandleSchema = z.object({
  sid: z.string(),
  step: z.number(),
  doc: z.object({
    url: z.string(),
    origin: z.string(),
    title: z.string(),
    doc_id: z.string(),
    nav_type: z.enum(['soft', 'hard']),
    history_idx: z.number(),
  }),
  layer: z.object({
    active: z.enum(['main', 'modal', 'drawer', 'popover']),
    stack: z.array(z.string()),
    focus_eid: z.string().optional(),
    pointer_lock: z.boolean(),
  }),
  timing: z.object({
    ts: z.string(),
    dom_ready: z.boolean(),
    network_busy: z.boolean(),
  }),
  hash: z.object({
    ui: z.string(),
    layer: z.string(),
  }),
});

/**
 * Baseline response (full state, no diff).
 *
 * Baselines are only sent when the LLM truly needs full context:
 * - first: No previous snapshot (LLM has no prior context)
 * - navigation: URL changed (old elements no longer exist)
 * - error: State corrupted, need to resync
 */
export const BaselineResponseSchema = z.object({
  mode: z.literal('baseline'),
  reason: z.enum(['first', 'navigation', 'error']),
  error: z.string().optional(),
});

/**
 * Diff change for actionables.
 */
export const DiffChangeSchema = z.object({
  eid: z.string(),
  k: z.string(),
  from: z.unknown(),
  to: z.unknown(),
});

/**
 * Atom change.
 */
export const AtomChangeSchema = z.object({
  k: z.string(),
  from: z.unknown(),
  to: z.unknown(),
});

/**
 * Diff response (incremental changes).
 */
export const DiffResponseSchema = z.object({
  mode: z.literal('diff'),
  diff: z.object({
    doc: z
      .object({
        from: z.object({ url: z.string(), title: z.string() }),
        to: z.object({ url: z.string(), title: z.string() }),
        nav_type: z.enum(['soft', 'hard']),
      })
      .optional(),
    layer: z
      .object({
        stack_from: z.array(z.string()),
        stack_to: z.array(z.string()),
      })
      .optional(),
    actionables: z.object({
      added: z.array(z.string()),
      removed: z.array(z.string()),
      changed: z.array(DiffChangeSchema),
    }),
    atoms: z.array(AtomChangeSchema),
  }),
});

/**
 * Universal UI state atoms.
 */
export const AtomsSchema = z.object({
  viewport: z.object({
    w: z.number(),
    h: z.number(),
    dpr: z.number(),
  }),
  scroll: z.object({
    x: z.number(),
    y: z.number(),
  }),
  loading: z
    .object({
      network_busy: z.boolean(),
      spinners: z.number(),
      progress: z.number().optional(),
    })
    .optional(),
  forms: z
    .object({
      dirty: z.boolean(),
      focused_field: z.string().optional(),
      validation_errors: z.number(),
    })
    .optional(),
  notifications: z
    .object({
      toasts: z.number(),
      banners: z.number(),
    })
    .optional(),
});

/**
 * Internal state response object structure (for reference/documentation).
 * The actual StateResponse is an XML string for LLM context efficiency.
 */
export const StateResponseObjectSchema = z.object({
  state: StateHandleSchema,
  diff: z.union([BaselineResponseSchema, DiffResponseSchema]),
  actionables: z.array(ActionableInfoSchema),
  counts: z.object({
    shown: z.number(),
    total_in_layer: z.number(),
  }),
  limits: z.object({
    max_actionables: z.number(),
    actionables_capped: z.boolean(),
  }),
  atoms: AtomsSchema,
  tokens: z.number(),
});

export type StateResponseObject = z.infer<typeof StateResponseObjectSchema>;

/**
 * State response - returned after every action as a dense XML string.
 *
 * This is the NEW response format that replaces page_summary.
 * It's rendered as XML for maximum LLM context efficiency.
 * Contains:
 * - StateHandle: Current state metadata
 * - Diff: Incremental changes since last action (or baseline)
 * - Actionables: Capped list of interactive elements from active layer
 * - Atoms: Universal UI state facts
 */
export const StateResponseSchema = z.string();

export type StateResponse = z.infer<typeof StateResponseSchema>;

// ============================================================================
// Click Outcome Schema (Navigation-aware action results)
// ============================================================================

/**
 * Click outcome - result of a click action with navigation awareness.
 * Differentiates between "element gone due to navigation" vs "element stale due to DOM mutation".
 */
export const ClickOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    /** Whether the click triggered a page navigation */
    navigated: z.boolean(),
  }),
  z.object({
    status: z.literal('stale_element'),
    /** Why the element became stale */
    reason: z.enum(['dom_mutation', 'navigation']),
    /** Whether retry was attempted */
    retried: z.boolean(),
  }),
  z.object({
    status: z.literal('element_not_found'),
    /** The eid that wasn't found */
    eid: z.string(),
    /** Last known label for debugging */
    last_known_label: z.string().optional(),
  }),
  z.object({
    status: z.literal('error'),
    /** Error message */
    message: z.string(),
  }),
]);

export type ClickOutcome = z.infer<typeof ClickOutcomeSchema>;

// ============================================================================
// Tool Input/Output Schemas
// ============================================================================

// ============================================================================
// launch_browser - Launch a new browser instance
// ============================================================================

export const LaunchBrowserInputSchema = z.object({
  /** Run browser in headless mode (default: true) */
  headless: z.boolean().default(true),
});

/** Returns XML state response string directly */
export const LaunchBrowserOutputSchema = z.string();

export type LaunchBrowserInput = z.infer<typeof LaunchBrowserInputSchema>;
export type LaunchBrowserOutput = z.infer<typeof LaunchBrowserOutputSchema>;

// ============================================================================
// connect_browser - Connect to an existing browser instance
// ============================================================================

export const ConnectBrowserInputSchema = z.object({
  /** CDP endpoint URL (e.g., http://localhost:9223). Defaults to Athena CEF bridge host/port. */
  endpoint_url: z.string().optional(),
});

/** Returns XML state response string directly */
export const ConnectBrowserOutputSchema = z.string();

export type ConnectBrowserInput = z.infer<typeof ConnectBrowserInputSchema>;
export type ConnectBrowserOutput = z.infer<typeof ConnectBrowserOutputSchema>;

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
// close_session - Close the entire browser session
// ============================================================================

export const CloseSessionInputSchema = z.object({});

/** Returns XML result string */
export const CloseSessionOutputSchema = z.string();

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
// capture_snapshot - Capture a fresh snapshot of the current page
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
// find_elements - Find elements by semantic criteria
// ============================================================================

export const FindElementsInputSchema = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional().describe('The ID of the page to search within.'),
  /** Filter by semantic type (e.g., 'radio' for form options). */
  kind: z
    .enum(['button', 'link', 'radio', 'checkbox', 'textbox', 'combobox', 'image', 'heading'])
    .optional()
    .describe("Filter by semantic type (e.g., 'radio' for form options)."),
  /** Fuzzy match for visible text or accessible name. */
  label: z.string().optional().describe('Fuzzy match for visible text or accessible name.'),
  /** Restrict search to a specific area. */
  region: z
    .enum(['main', 'nav', 'header', 'footer'])
    .optional()
    .describe('Restrict search to a specific area.'),
  /** Maximum number of results (default: 10) */
  limit: z.number().int().min(1).max(100).default(10).describe('Number of results to return.'),
  /** Include non-interactive readable content (text, paragraph, dialog) */
  include_readable: z
    .boolean()
    .default(true)
    .optional()
    .describe(
      'Include non-interactive readable content (text, heading, paragraph, dialog). These get rd-* IDs.'
    ),
});

/** Returns XML result string */
export const FindElementsOutputSchema = z.string();

export type FindElementsInput = z.infer<typeof FindElementsInputSchema>;
export type FindElementsOutput = z.infer<typeof FindElementsOutputSchema>;

// ============================================================================
// get_node_details - Get full details for a specific node
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
  /** Stable element ID from actionables list */
  eid: z.string(),
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
// Raw schema for .shape access (tool registration)
const ClickInputSchemaBase = z.object({
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional().describe('The ID of the page containing the element.'),
  /** Stable element ID from actionables list */
  eid: z.string().describe('The internal element ID (eid) from the snapshot.'),
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
  text: z.string(),
  /** Stable element ID from actionables list */
  eid: z.string(),
  /** Clear existing text before typing (default: false) */
  clear: z.boolean().default(false),
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
  /** Stable element ID from actionables list */
  eid: z.string(),
  /** Option value or visible text to select */
  value: z.string(),
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
  /** Stable element ID from actionables list */
  eid: z.string(),
  /** Page ID. If omitted, operates on the most recently used page */
  page_id: z.string().optional(),
});
export const HoverInputSchema = HoverInputSchemaBase;
export { HoverInputSchemaBase };

/** Returns XML state response string directly */
export const HoverOutputSchema = z.string();

export type HoverInput = z.infer<typeof HoverInputSchema>;
export type HoverOutput = z.infer<typeof HoverOutputSchema>;
