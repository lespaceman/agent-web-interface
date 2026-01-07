/**
 * Browser Tools
 *
 * MCP tool handlers for browser automation.
 */

import type { SessionManager } from '../browser/session-manager.js';
import { SnapshotStore, extractSnapshot, resolveLocator } from '../snapshot/index.js';
import {
  BrowserLaunchInputSchema,
  BrowserNavigateInputSchema,
  BrowserCloseInputSchema,
  SnapshotCaptureInputSchema,
  ActionClickInputSchema,
  type BrowserLaunchOutput,
  type BrowserNavigateOutput,
  type BrowserCloseOutput,
  type SnapshotCaptureOutput,
  type ActionClickOutput,
} from './tool-schemas.js';

// Module-level state
let sessionManager: SessionManager | null = null;
const snapshotStore = new SnapshotStore();

/**
 * Initialize tools with a session manager instance.
 * Must be called before using any tool handlers.
 *
 * @param manager - SessionManager instance
 */
export function initializeTools(manager: SessionManager): void {
  sessionManager = manager;
}

/**
 * Get the session manager, throwing if not initialized.
 */
function getSessionManager(): SessionManager {
  if (!sessionManager) {
    throw new Error('Tools not initialized. Call initializeTools() first.');
  }
  return sessionManager;
}

/**
 * Get the snapshot store.
 */
export function getSnapshotStore(): SnapshotStore {
  return snapshotStore;
}

/**
 * Build CDP endpoint URL from environment variables.
 */
function buildEndpointUrl(): string {
  const host = process.env.CEF_BRIDGE_HOST ?? '127.0.0.1';
  const port = process.env.CEF_BRIDGE_PORT ?? '9223';
  return `http://${host}:${port}`;
}

/**
 * Launch a new browser or connect to an existing one.
 *
 * @param rawInput - Launch options (will be validated)
 * @returns Page info
 */
export async function browserLaunch(rawInput: unknown): Promise<BrowserLaunchOutput> {
  const input = BrowserLaunchInputSchema.parse(rawInput);
  const session = getSessionManager();

  if (input.mode === 'connect') {
    const endpointUrl = input.endpoint_url ?? buildEndpointUrl();
    await session.connect({ endpointUrl });
    const handle = await session.adoptPage(0);
    return {
      page_id: handle.page_id,
      url: handle.url ?? handle.page.url(),
      mode: 'connected',
    };
  }

  // Launch mode
  await session.launch({ headless: input.headless });
  const handle = await session.createPage();
  return {
    page_id: handle.page_id,
    url: handle.url ?? handle.page.url(),
    mode: 'launched',
  };
}

/**
 * Navigate a page to a URL.
 *
 * @param rawInput - Navigation options (will be validated)
 * @returns Navigation result
 */
export async function browserNavigate(rawInput: unknown): Promise<BrowserNavigateOutput> {
  const input = BrowserNavigateInputSchema.parse(rawInput);
  const session = getSessionManager();
  const handle = session.getPage(input.page_id);

  if (!handle) {
    throw new Error(`Page not found: ${input.page_id}`);
  }

  await session.navigateTo(input.page_id, input.url);

  // Get fresh page info after navigation
  const url = handle.page.url();
  const title = await handle.page.title();

  return {
    page_id: input.page_id,
    url,
    title,
  };
}

/**
 * Close a page or the entire browser session.
 *
 * @param rawInput - Close options (will be validated)
 * @returns Close result
 */
export async function browserClose(rawInput: unknown): Promise<BrowserCloseOutput> {
  const input = BrowserCloseInputSchema.parse(rawInput);
  const session = getSessionManager();

  if (input.page_id) {
    await session.closePage(input.page_id);
    // Also remove any cached snapshot for this page
    snapshotStore.removeByPageId(input.page_id);
  } else {
    await session.shutdown();
    // Clear all snapshots on full shutdown
    snapshotStore.clear();
  }

  return { closed: true };
}

/**
 * Capture a snapshot of the page's interactive elements.
 *
 * @param rawInput - Snapshot options (will be validated)
 * @returns Snapshot info with node summaries
 */
export async function snapshotCapture(rawInput: unknown): Promise<SnapshotCaptureOutput> {
  const input = SnapshotCaptureInputSchema.parse(rawInput);
  const session = getSessionManager();
  const handle = session.getPage(input.page_id);

  if (!handle) {
    throw new Error(`Page not found: ${input.page_id}`);
  }

  // Extract snapshot using CDP
  const snapshot = await extractSnapshot(handle.cdp, handle.page, input.page_id);

  // Store for later use by actions
  snapshotStore.store(input.page_id, snapshot);

  // Build node summaries for response
  const nodes = snapshot.nodes.map((node) => ({
    node_id: node.node_id,
    kind: node.kind,
    label: node.label,
    selector: node.find?.primary ?? '',
  }));

  return {
    snapshot_id: snapshot.snapshot_id,
    url: snapshot.url,
    title: snapshot.title,
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    nodes,
  };
}

/**
 * Click an element identified by node_id from a previous snapshot.
 *
 * @param rawInput - Click options (will be validated)
 * @returns Click result
 */
export async function actionClick(rawInput: unknown): Promise<ActionClickOutput> {
  const input = ActionClickInputSchema.parse(rawInput);
  const session = getSessionManager();
  const handle = session.getPage(input.page_id);

  if (!handle) {
    throw new Error(`Page not found: ${input.page_id}`);
  }

  // Get snapshot for this page
  const snapshot = snapshotStore.getByPageId(input.page_id);
  if (!snapshot) {
    throw new Error(`No snapshot for page ${input.page_id} - call snapshot_capture first`);
  }

  // Find node in snapshot
  const node = snapshot.nodes.find((n) => n.node_id === input.node_id);
  if (!node) {
    throw new Error(`Node ${input.node_id} not found in snapshot`);
  }

  // Resolve locator and click using Playwright
  const locator = resolveLocator(handle.page, node);
  await locator.click();

  return {
    success: true,
    node_id: input.node_id,
    clicked_element: node.label,
  };
}
