/**
 * Browser Tools
 *
 * Re-export barrel for all browser automation tool handlers.
 * The actual implementations live in category-specific modules.
 */

// Action context & initialization
export {
  initializeTools,
  type ActionContext,
  prepareActionContext,
  captureSnapshotWithRecovery,
  createActionCapture,
  buildRuntimeHealth,
} from './action-context.js';

// Navigation & session tools
export {
  listPages,
  closePage,
  closeSession,
  navigate,
  goBack,
  goForward,
  reload,
} from './navigation-tools.js';

// Observation tools
export {
  captureSnapshot,
  findElements,
  getNodeDetails,
  scrollElementIntoView,
  scrollPage,
  mapSchemaKindToNodeKind,
} from './observation-tools.js';

// Interaction tools
export { click, type, press, select, hover } from './interaction-tools.js';

// Viewport tools
export { drag, wheel, takeScreenshot } from './viewport-tools.js';

// Readability tools
export { readPage } from './readability-tools.js';
