/**
 * Response Builder
 *
 * Common utility for building consistent XML responses across all browser tools.
 * - State tools return `<state>...</state>` (via StateManager)
 * - Data tools return `<result type="...">...</result>` (via builders here)
 */

import type { BaseSnapshot, NodeState } from '../snapshot/snapshot.types.js';
import { getStateManager } from './execute-action.js';
import type { StateResponse } from '../state/types.js';
import type { NodeDetails } from './tool-schemas.js';

// ============================================================================
// XML Utilities
// ============================================================================

/**
 * Escape special XML characters.
 */
function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return c;
    }
  });
}

// ============================================================================
// State Response Builders (for mutation/navigation tools)
// ============================================================================

/**
 * Build an XML state response for a page snapshot.
 *
 * This is the standard way to generate a response for tools that:
 * - Launch/connect browsers
 * - Navigate to URLs
 * - Capture snapshots directly
 * - Perform mutations (click, type, etc.)
 *
 * @param pageId - The page identifier
 * @param snapshot - The captured snapshot
 * @returns XML state response string
 */
export function buildStateResponse(pageId: string, snapshot: BaseSnapshot): StateResponse {
  const stateManager = getStateManager(pageId);
  return stateManager.generateResponse(snapshot);
}

/**
 * Build an error response.
 *
 * This provides a consistent error format across all tools.
 *
 * @param pageId - The page identifier
 * @param error - The error message or Error object
 * @returns XML state response string with error
 */
export function buildErrorResponse(pageId: string, error: Error | string): StateResponse {
  const stateManager = getStateManager(pageId);
  const errorMessage = error instanceof Error ? error.message : error;
  return stateManager.generateErrorResponse(errorMessage);
}

// ============================================================================
// Result Response Builders (for data/query tools)
// ============================================================================

/**
 * Build XML response for close_page tool.
 *
 * @param pageId - The page ID that was closed
 * @returns XML result string
 */
export function buildClosePageResponse(pageId: string): string {
  return `<result type="close_page" status="success">
  <closed page_id="${escapeXml(pageId)}" />
</result>`;
}

/**
 * Build XML response for close_session tool.
 *
 * @returns XML result string
 */
export function buildCloseSessionResponse(): string {
  return `<result type="close_session" status="success">
  <closed />
</result>`;
}

/**
 * Match item from find_elements query.
 */
export interface FindElementsMatch {
  /** Stable element ID for use with action tools */
  eid: string;
  kind: string;
  label: string;
  selector: string;
  region: string;
  /** Element state (visible, enabled, checked, etc.) */
  state?: NodeState;
  attributes?: Record<string, string>;
}

/**
 * Build XML response for find_elements tool.
 *
 * @param pageId - The page ID
 * @param snapshotId - The snapshot ID
 * @param matches - Array of matched elements
 * @returns XML result string
 */
export function buildFindElementsResponse(
  pageId: string,
  snapshotId: string,
  matches: FindElementsMatch[]
): string {
  const lines: string[] = [];

  lines.push(
    `<result type="find_elements" page_id="${escapeXml(pageId)}" snapshot_id="${escapeXml(snapshotId)}" count="${matches.length}">`
  );

  for (const m of matches) {
    const attrs: string[] = [
      `eid="${escapeXml(m.eid)}"`,
      `kind="${escapeXml(m.kind)}"`,
      `label="${escapeXml(m.label)}"`,
      `region="${escapeXml(m.region)}"`,
    ];

    // Add selector if present
    if (m.selector) {
      attrs.push(`selector="${escapeXml(m.selector)}"`);
    }

    // Add state flags
    if (m.state) {
      if (m.state.visible !== undefined) attrs.push(`vis="${m.state.visible ? '1' : '0'}"`);
      if (m.state.enabled !== undefined) attrs.push(`ena="${m.state.enabled ? '1' : '0'}"`);
      if (m.state.checked) attrs.push(`chk="1"`);
      if (m.state.expanded) attrs.push(`exp="1"`);
      if (m.state.selected) attrs.push(`sel="1"`);
      if (m.state.focused) attrs.push(`foc="1"`);
    }

    // Add common attributes
    if (m.attributes) {
      if (m.attributes.input_type) attrs.push(`type="${escapeXml(m.attributes.input_type)}"`);
      if (m.attributes.href) attrs.push(`href="${escapeXml(m.attributes.href)}"`);
      if (m.attributes.placeholder)
        attrs.push(`placeholder="${escapeXml(m.attributes.placeholder)}"`);
      if (m.attributes.value) attrs.push(`val="${escapeXml(m.attributes.value)}"`);
    }

    lines.push(`  <match ${attrs.join(' ')} />`);
  }

  lines.push(`</result>`);

  return lines.join('\n');
}

/**
 * Build XML response for get_node_details tool.
 *
 * @param pageId - The page ID
 * @param snapshotId - The snapshot ID
 * @param node - The node details
 * @returns XML result string
 */
export function buildGetNodeDetailsResponse(
  pageId: string,
  snapshotId: string,
  node: NodeDetails
): string {
  const lines: string[] = [];

  lines.push(
    `<result type="get_node_details" page_id="${escapeXml(pageId)}" snapshot_id="${escapeXml(snapshotId)}">`
  );

  // Node element with core attributes
  const nodeAttrs = [
    `eid="${escapeXml(node.eid)}"`,
    `kind="${escapeXml(node.kind)}"`,
    `label="${escapeXml(node.label)}"`,
  ];
  lines.push(`  <node ${nodeAttrs.join(' ')}>`);

  // Where (location info)
  const whereAttrs: string[] = [`region="${escapeXml(node.where.region)}"`];
  if (node.where.group_id) whereAttrs.push(`group_id="${escapeXml(node.where.group_id)}"`);
  if (node.where.group_path)
    whereAttrs.push(`group_path="${escapeXml(node.where.group_path.join('/'))}"`);
  if (node.where.heading_context)
    whereAttrs.push(`heading="${escapeXml(node.where.heading_context)}"`);
  lines.push(`    <where ${whereAttrs.join(' ')} />`);

  // Layout
  const layoutAttrs = [
    `x="${node.layout.bbox.x}"`,
    `y="${node.layout.bbox.y}"`,
    `w="${node.layout.bbox.w}"`,
    `h="${node.layout.bbox.h}"`,
  ];
  if (node.layout.display) layoutAttrs.push(`display="${escapeXml(node.layout.display)}"`);
  if (node.layout.screen_zone) layoutAttrs.push(`zone="${escapeXml(node.layout.screen_zone)}"`);
  lines.push(`    <layout ${layoutAttrs.join(' ')} />`);

  // State (if present)
  if (node.state) {
    const stateAttrs: string[] = [];
    if (node.state.visible !== undefined)
      stateAttrs.push(`vis="${node.state.visible ? '1' : '0'}"`);
    if (node.state.enabled !== undefined)
      stateAttrs.push(`ena="${node.state.enabled ? '1' : '0'}"`);
    if (node.state.checked) stateAttrs.push(`chk="1"`);
    if (node.state.expanded) stateAttrs.push(`exp="1"`);
    if (node.state.selected) stateAttrs.push(`sel="1"`);
    if (node.state.focused) stateAttrs.push(`foc="1"`);
    if (node.state.required) stateAttrs.push(`req="1"`);
    if (node.state.invalid) stateAttrs.push(`inv="1"`);
    if (node.state.readonly) stateAttrs.push(`rdo="1"`);
    if (stateAttrs.length > 0) {
      lines.push(`    <state ${stateAttrs.join(' ')} />`);
    }
  }

  // Find (locator strategies)
  if (node.find) {
    const findAttrs = [`primary="${escapeXml(node.find.primary)}"`];
    if (node.find.alternates && node.find.alternates.length > 0) {
      findAttrs.push(`alternates="${escapeXml(node.find.alternates.join(';'))}"`);
    }
    lines.push(`    <find ${findAttrs.join(' ')} />`);
  }

  // Attributes (if present)
  if (node.attributes) {
    const attrPairs: string[] = [];
    for (const [key, value] of Object.entries(node.attributes)) {
      if (value !== undefined) {
        attrPairs.push(`${escapeXml(key)}="${escapeXml(String(value))}"`);
      }
    }
    if (attrPairs.length > 0) {
      lines.push(`    <attrs ${attrPairs.join(' ')} />`);
    }
  }

  lines.push(`  </node>`);
  lines.push(`</result>`);

  return lines.join('\n');
}
