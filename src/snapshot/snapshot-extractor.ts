/**
 * Snapshot Extractor
 *
 * Extracts interactive elements from page using CDP Accessibility tree.
 * Minimal implementation for MVP - interactive elements only.
 */

import type { Page } from 'playwright';
import type { CdpClient } from '../cdp/cdp-client.interface.js';
import type { BaseSnapshot, ReadableNode, NodeKind } from './snapshot.types.js';
import { INTERACTIVE_ROLES } from '../lib/constants.js';

/**
 * CDP AX Node structure (simplified)
 */
interface AXNode {
  nodeId: string;
  ignored?: boolean;
  role?: { type?: string; value?: string };
  name?: { type?: string; value?: string };
  properties?: {
    name: string;
    value: { type?: string; value?: unknown };
  }[];
  childIds?: string[];
  backendDOMNodeId?: number;
}

/**
 * CDP Accessibility.getFullAXTree response
 */
interface AXTreeResponse {
  nodes: AXNode[];
}

/** Counter for generating unique snapshot IDs */
let snapshotCounter = 0;

/**
 * Generate a unique snapshot ID.
 */
function generateSnapshotId(): string {
  snapshotCounter++;
  return `snap-${Date.now()}-${snapshotCounter}`;
}

/** Counter for generating unique node IDs within a snapshot */
let nodeCounter = 0;

/**
 * Generate a unique node ID within a snapshot.
 */
function generateNodeId(): string {
  nodeCounter++;
  return `n${nodeCounter}`;
}

/**
 * Reset node counter for new snapshot.
 */
function resetNodeCounter(): void {
  nodeCounter = 0;
}

/**
 * Map AX role to NodeKind.
 * Returns undefined for non-interactive roles.
 *
 * @param role - AX role string
 * @returns NodeKind or undefined if not interactive
 */
export function mapAxRoleToNodeKind(role: string): NodeKind | undefined {
  const normalized = role.toLowerCase();

  // Direct mappings
  const roleMap: Record<string, NodeKind> = {
    button: 'button',
    link: 'link',
    textbox: 'input',
    searchbox: 'input',
    combobox: 'combobox',
    listbox: 'select',
    checkbox: 'checkbox',
    radio: 'radio',
    switch: 'switch',
    slider: 'slider',
    spinbutton: 'slider',
    tab: 'tab',
    menuitem: 'menuitem',
    menuitemcheckbox: 'menuitem',
    menuitemradio: 'menuitem',
    option: 'menuitem',
  };

  if (roleMap[normalized]) {
    return roleMap[normalized];
  }

  // Check against INTERACTIVE_ROLES set
  if (INTERACTIVE_ROLES.has(normalized)) {
    return 'button'; // Default to button for other interactive roles
  }

  return undefined;
}

/**
 * Build locator string for a node.
 *
 * @param role - Node role
 * @param name - Node accessible name
 * @returns Locator string in format "role=X" or "role=X[name="Y"]"
 */
function buildLocator(role: string, name: string | undefined): string {
  const normalizedRole = role.toLowerCase();

  if (name) {
    // Escape quotes in name
    const escapedName = name.replace(/"/g, '\\"');
    return `role=${normalizedRole}[name="${escapedName}"]`;
  }

  return `role=${normalizedRole}`;
}

/**
 * Extract interactive elements from page using CDP Accessibility tree.
 *
 * @param cdp - CDP client for the page
 * @param page - Playwright Page instance
 * @param _pageId - Page identifier (unused in extraction, kept for signature consistency)
 * @returns BaseSnapshot with interactive nodes
 */
export async function extractSnapshot(
  cdp: CdpClient,
  page: Page,
  _pageId: string
): Promise<BaseSnapshot> {
  const startTime = Date.now();
  resetNodeCounter();

  // Get accessibility tree
  const axTree = await cdp.send<AXTreeResponse>('Accessibility.getFullAXTree', { depth: -1 });

  // Get page info
  const url = page.url();
  const title = await page.title();
  const viewportSize = page.viewportSize() ?? { width: 1280, height: 720 };

  // Extract interactive nodes
  const nodes: ReadableNode[] = [];

  for (const axNode of axTree.nodes) {
    // Skip ignored nodes
    if (axNode.ignored) {
      continue;
    }

    const role = axNode.role?.value;
    if (!role) {
      continue;
    }

    // Check if this is an interactive role
    const kind = mapAxRoleToNodeKind(role);
    if (!kind) {
      continue;
    }

    const name = axNode.name?.value ?? '';
    const nodeId = generateNodeId();

    const node: ReadableNode = {
      node_id: nodeId,
      kind,
      label: name,
      where: {
        region: 'unknown', // Simplified: no region detection for MVP
      },
      layout: {
        bbox: { x: 0, y: 0, w: 0, h: 0 }, // Simplified: no bbox for MVP
      },
      find: {
        primary: buildLocator(role, name || undefined),
      },
    };

    // Add state for checkboxes/radios
    if (kind === 'checkbox' || kind === 'radio' || kind === 'switch') {
      const checkedProp = axNode.properties?.find((p) => p.name === 'checked');
      if (checkedProp) {
        node.state = {
          visible: true,
          enabled: true,
          checked: checkedProp.value.value === 'true' || checkedProp.value.value === true,
        };
      }
    }

    nodes.push(node);
  }

  const duration = Date.now() - startTime;

  return {
    snapshot_id: generateSnapshotId(),
    url,
    title,
    captured_at: new Date().toISOString(),
    viewport: viewportSize,
    nodes,
    meta: {
      node_count: nodes.length,
      interactive_count: nodes.length, // All nodes are interactive in this implementation
      capture_duration_ms: duration,
    },
  };
}
