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
  /** Connection mode used */
  mode: z.enum(['launched', 'connected']),
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
