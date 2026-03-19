/**
 * MCP Tools Module
 *
 * Browser automation tools exposed via MCP protocol.
 */

// Shared tool context
export { initializeToolContext, getSnapshotStore } from './tool-context.js';

// Legacy exports for backward compatibility
export { initializeTools } from './browser-tools.js';

// Tool handlers - Simplified API
export {
  listPages,
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
  drag,
  wheel,
  takeScreenshot,
  mapSchemaKindToNodeKind,
} from './browser-tools.js';

// Server config - lazy browser initialization
export { ensureBrowserForTools, getSessionManager } from '../server/server-config.js';

// Schemas - Simplified API
export {
  // list_pages
  ListPagesInputSchema,
  ListPagesOutputSchema,
  type ListPagesInput,
  type ListPagesOutput,
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
  // snapshot
  CaptureSnapshotInputSchema,
  CaptureSnapshotOutputSchema,
  type CaptureSnapshotInput,
  type CaptureSnapshotOutput,
  // find
  FindElementsInputSchema,
  FindElementsOutputSchema,
  type FindElementsInput,
  type FindElementsOutput,
  // get_element
  GetNodeDetailsInputSchema,
  GetNodeDetailsOutputSchema,
  type GetNodeDetailsInput,
  type GetNodeDetailsOutput,
  // scroll_to
  ScrollElementIntoViewInputSchema,
  ScrollElementIntoViewInputSchemaBase,
  ScrollElementIntoViewOutputSchema,
  type ScrollElementIntoViewInput,
  type ScrollElementIntoViewOutput,
  // scroll
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
  // drag
  DragInputSchema,
  DragInputSchemaBase,
  DragOutputSchema,
  type DragInput,
  type DragOutput,
  // wheel
  WheelInputSchema,
  WheelInputSchemaBase,
  WheelOutputSchema,
  type WheelInput,
  type WheelOutput,
  // screenshot
  TakeScreenshotInputSchema,
  TakeScreenshotInputSchemaBase,
  TakeScreenshotOutputSchema,
  type TakeScreenshotInput,
  type TakeScreenshotOutput,
  // inspect_canvas (unchanged)
  InspectCanvasInputSchema,
  InspectCanvasInputSchemaBase,
  type InspectCanvasInput,
} from './tool-schemas.js';

// Tool result types
export {
  isImageResult,
  isFileResult,
  isCompositeResult,
  type ImageResult,
  type FileResult,
  type CompositeResult,
  type ToolResult,
} from './tool-result.types.js';

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

// Canvas tools
export { inspectCanvas, type CanvasMetadata, type CanvasObject } from './canvas-tools.js';
