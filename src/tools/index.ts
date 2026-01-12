/**
 * MCP Tools Module
 *
 * Browser automation tools exposed via MCP protocol.
 */

// Tool handlers - Legacy names (for backward compatibility during transition)
export {
  initializeTools,
  getSnapshotStore,
  browserLaunch,
  browserNavigate,
  browserClose,
  snapshotCapture,
  actionClick,
  getNodeDetails,
  findElements,
  getFactPack,
} from './browser-tools.js';

// Tool handlers - New simplified names
export {
  open,
  close,
  goto,
  snapshot,
  find,
  click,
  type,
  press,
  select,
  hover,
  scroll,
} from './browser-tools.js';

// Schemas - Legacy (for backward compatibility during transition)
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
  // get_node_details
  GetNodeDetailsInputSchema,
  GetNodeDetailsOutputSchema,
  NodeDetailsSchema,
  type GetNodeDetailsInput,
  type GetNodeDetailsOutput,
  type NodeDetails,
  // find_elements
  FindElementsInputSchema,
  FindElementsOutputSchema,
  type FindElementsInput,
  type FindElementsOutput,
  // get_factpack
  GetFactPackInputSchema,
  GetFactPackOutputSchema,
  type GetFactPackInput,
  type GetFactPackOutput,
  // FactPack schemas
  FactPackOptionsSchema,
  FactPackSchema,
  type FactPackOptions,
  type FactPackOutput,
} from './tool-schemas.js';

// Schemas - New simplified names
export {
  // open
  OpenInputSchema,
  OpenOutputSchema,
  type OpenInput,
  type OpenOutput,
  // close
  CloseInputSchema,
  CloseOutputSchema,
  type CloseInput,
  type CloseOutput,
  // goto
  GotoInputSchemaBase,
  GotoInputSchema,
  GotoOutputSchema,
  type GotoInput,
  type GotoOutput,
  // snapshot
  SnapshotInputSchema,
  SnapshotOutputSchema,
  type SnapshotInput,
  type SnapshotOutput,
  // find
  FindInputSchema,
  FindOutputSchema,
  type FindInput,
  type FindOutput,
  // click
  ClickInputSchema,
  ClickOutputSchema,
  type ClickInput,
  type ClickOutput,
  // type
  TypeInputSchema,
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
  SelectOutputSchema,
  type SelectInput,
  type SelectOutput,
  // hover
  HoverInputSchema,
  HoverOutputSchema,
  type HoverInput,
  type HoverOutput,
  // scroll
  ScrollInputSchemaBase,
  ScrollInputSchema,
  ScrollOutputSchema,
  type ScrollInput,
  type ScrollOutput,
} from './tool-schemas.js';

// Tool handlers - V2 Simplified API
export {
  launchBrowser,
  connectBrowser,
  closePage,
  closeSession,
  navigate,
  goBack,
  goForward,
  reload,
  findElementsV2,
  getNodeDetailsV2,
  scrollElementIntoView,
  scrollPageV2,
  clickV2,
  typeV2,
  pressV2,
  selectV2,
  hoverV2,
} from './browser-tools.js';

// Schemas - V2 Simplified API
export {
  // launch_browser
  LaunchBrowserInputSchema,
  LaunchBrowserOutputSchema,
  type LaunchBrowserInput,
  type LaunchBrowserOutput,
  // connect_browser
  ConnectBrowserInputSchema,
  ConnectBrowserOutputSchema,
  type ConnectBrowserInput,
  type ConnectBrowserOutput,
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
  // find_elements_v2
  FindElementsV2InputSchema,
  FindElementsV2OutputSchema,
  type FindElementsV2Input,
  type FindElementsV2Output,
  // get_node_details_v2
  GetNodeDetailsV2InputSchema,
  GetNodeDetailsV2OutputSchema,
  type GetNodeDetailsV2Input,
  type GetNodeDetailsV2Output,
  // scroll_element_into_view
  ScrollElementIntoViewInputSchema,
  ScrollElementIntoViewOutputSchema,
  type ScrollElementIntoViewInput,
  type ScrollElementIntoViewOutput,
  // scroll_page
  ScrollPageInputSchema,
  ScrollPageOutputSchema,
  type ScrollPageInput,
  type ScrollPageOutput,
  // click_v2
  ClickV2InputSchema,
  ClickV2OutputSchema,
  type ClickV2Input,
  type ClickV2Output,
  // type_v2
  TypeV2InputSchema,
  TypeV2OutputSchema,
  type TypeV2Input,
  type TypeV2Output,
  // press_v2
  PressV2InputSchema,
  PressV2OutputSchema,
  type PressV2Input,
  type PressV2Output,
  // select_v2
  SelectV2InputSchema,
  SelectV2OutputSchema,
  type SelectV2Input,
  type SelectV2Output,
  // hover_v2
  HoverV2InputSchema,
  HoverV2OutputSchema,
  type HoverV2Input,
  type HoverV2Output,
} from './tool-schemas.js';
