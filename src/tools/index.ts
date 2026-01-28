/**
 * MCP Tools Module
 *
 * Browser automation tools exposed via MCP protocol.
 */

export { initializeTools, getSnapshotStore } from './browser-tools.js';

// Tool handlers - Simplified API
export {
  closePage,
  closeSession,
  navigate,
  goBack,
  goForward,
  reload,
  captureSnapshot,
  findElements,
  getNodeDetails,
  scrollElementIntoView,
  scrollPage,
  click,
  type,
  press,
  select,
  hover,
} from './browser-tools.js';

// Server config - lazy browser initialization
export { ensureBrowserForTools, getSessionManager } from '../server/server-config.js';

// Schemas - Simplified API
export {
  // close_page
  ClosePageInputSchema,
  ClosePageOutputSchema,
  type ClosePageInput,
  type ClosePageOutput,
  // close_session
  CloseSessionInputSchema,
  CloseSessionOutputSchema,
  type CloseSessionInput,
  type CloseSessionOutput,
  // navigate
  NavigateInputSchema,
  NavigateOutputSchema,
  type NavigateInput,
  type NavigateOutput,
  // go_back
  GoBackInputSchema,
  GoBackOutputSchema,
  type GoBackInput,
  type GoBackOutput,
  // go_forward
  GoForwardInputSchema,
  GoForwardOutputSchema,
  type GoForwardInput,
  type GoForwardOutput,
  // reload
  ReloadInputSchema,
  ReloadOutputSchema,
  type ReloadInput,
  type ReloadOutput,
  // capture_snapshot
  CaptureSnapshotInputSchema,
  CaptureSnapshotOutputSchema,
  type CaptureSnapshotInput,
  type CaptureSnapshotOutput,
  // find_elements
  FindElementsInputSchema,
  FindElementsOutputSchema,
  type FindElementsInput,
  type FindElementsOutput,
  // get_node_details
  GetNodeDetailsInputSchema,
  GetNodeDetailsOutputSchema,
  type GetNodeDetailsInput,
  type GetNodeDetailsOutput,
  // scroll_element_into_view
  ScrollElementIntoViewInputSchema,
  ScrollElementIntoViewInputSchemaBase,
  ScrollElementIntoViewOutputSchema,
  type ScrollElementIntoViewInput,
  type ScrollElementIntoViewOutput,
  // scroll_page
  ScrollPageInputSchema,
  ScrollPageOutputSchema,
  type ScrollPageInput,
  type ScrollPageOutput,
  // click
  ClickInputSchema,
  ClickInputSchemaBase,
  ClickOutputSchema,
  type ClickInput,
  type ClickOutput,
  // type
  TypeInputSchema,
  TypeInputSchemaBase,
  TypeOutputSchema,
  type TypeInput,
  type TypeOutput,
  // press
  PressInputSchema,
  PressOutputSchema,
  type PressInput,
  type PressOutput,
  // select
  SelectInputSchema,
  SelectInputSchemaBase,
  SelectOutputSchema,
  type SelectInput,
  type SelectOutput,
  // hover
  HoverInputSchema,
  HoverInputSchemaBase,
  HoverOutputSchema,
  type HoverInput,
  type HoverOutput,
} from './tool-schemas.js';

// Form tools
export {
  initializeFormTools,
  getFormUnderstanding,
  getFieldContext,
  GetFormUnderstandingInputSchema,
  GetFieldContextInputSchema,
  type GetFormUnderstandingInput,
  type GetFieldContextInput,
} from './form-tools.js';
