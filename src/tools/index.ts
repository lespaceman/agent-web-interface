/**
 * MCP Tools Module
 *
 * Browser automation tools exposed via MCP protocol.
 */

// Tool handlers
export {
  initializeTools,
  getSnapshotStore,
  browserLaunch,
  browserNavigate,
  browserClose,
  snapshotCapture,
  actionClick,
} from './browser-tools.js';

// Schemas
export {
  // browser_launch
  BrowserLaunchInputSchema,
  BrowserLaunchOutputSchema,
  type BrowserLaunchInput,
  type BrowserLaunchOutput,
  // browser_navigate
  BrowserNavigateInputSchema,
  BrowserNavigateOutputSchema,
  type BrowserNavigateInput,
  type BrowserNavigateOutput,
  // browser_close
  BrowserCloseInputSchema,
  BrowserCloseOutputSchema,
  type BrowserCloseInput,
  type BrowserCloseOutput,
  // snapshot_capture
  SnapshotCaptureInputSchema,
  SnapshotCaptureOutputSchema,
  NodeSummarySchema,
  type SnapshotCaptureInput,
  type SnapshotCaptureOutput,
  type NodeSummary,
  // action_click
  ActionClickInputSchema,
  ActionClickOutputSchema,
  type ActionClickInput,
  type ActionClickOutput,
} from './tool-schemas.js';
