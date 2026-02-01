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
import { escapeXml, xmlAttr } from '../lib/text-utils.js';

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
 * Page metadata for list_pages response.
 */
export interface PageInfo {
  page_id: string;
  url: string;
  title: string;
}

/**
 * Build XML response for list_pages tool.
 *
 * @param pages - Array of page metadata
 * @returns XML result string
 */
export function buildListPagesResponse(pages: PageInfo[]): string {
  const pageLines = pages.map(
    (page) =>
      `    <page page_id="${escapeXml(page.page_id)}" url="${escapeXml(page.url)}" title="${escapeXml(page.title)}" />`
  );

  return `<result type="list_pages" status="success">
  <pages count="${pages.length}">
${pageLines.join('\n')}
  </pages>
</result>`;
}

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
      if (m.state.visible !== undefined)
        attrs.push(`visible="${m.state.visible ? 'true' : 'false'}"`);
      if (m.state.enabled !== undefined)
        attrs.push(`enabled="${m.state.enabled ? 'true' : 'false'}"`);
      if (m.state.checked) attrs.push(`checked="true"`);
      if (m.state.expanded) attrs.push(`expanded="true"`);
      if (m.state.selected) attrs.push(`selected="true"`);
      if (m.state.focused) attrs.push(`focused="true"`);
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
 * Build XML response for get_element_details tool.
 *
 * Optimized format with flattened attributes, label as content, and no wrapper elements.
 * Location and layout are root attributes; state only includes non-defaults.
 *
 * @param _pageId - The page ID (unused - agent knows context)
 * @param _snapshotId - The snapshot ID (unused - agent knows context)
 * @param node - The node details
 * @returns XML result string
 */
export function buildGetElementDetailsResponse(
  _pageId: string,
  _snapshotId: string,
  node: NodeDetails
): string {
  const lines: string[] = [];

  // Build root <node> attributes with flattened where/layout
  const attrs: string[] = [
    `eid="${escapeXml(node.eid)}"`,
    `kind="${escapeXml(node.kind)}"`,
    `region="${escapeXml(node.where.region)}"`,
  ];

  // Location (flattened from <where>)
  if (node.where.group_id) attrs.push(`group="${escapeXml(node.where.group_id)}"`);
  if (node.where.group_path) attrs.push(`path="${escapeXml(node.where.group_path.join('/'))}"`);
  if (node.where.heading_context) attrs.push(`heading="${escapeXml(node.where.heading_context)}"`);

  // Layout (flattened)
  attrs.push(`x="${node.layout.bbox.x}"`);
  attrs.push(`y="${node.layout.bbox.y}"`);
  attrs.push(`w="${node.layout.bbox.w}"`);
  attrs.push(`h="${node.layout.bbox.h}"`);
  if (node.layout.display) attrs.push(`display="${escapeXml(node.layout.display)}"`);
  if (node.layout.screen_zone) attrs.push(`zone="${escapeXml(node.layout.screen_zone)}"`);

  // State flags - only include non-defaults
  if (node.state) {
    if (node.state.visible === false) attrs.push('visible="false"');
    if (node.state.enabled === false) attrs.push('enabled="false"');
    if (node.state.checked) attrs.push('checked="true"');
    if (node.state.expanded) attrs.push('expanded="true"');
    if (node.state.selected) attrs.push('selected="true"');
    if (node.state.focused) attrs.push('focused="true"');
    if (node.state.required) attrs.push('required="true"');
    if (node.state.invalid) attrs.push('invalid="true"');
    if (node.state.readonly) attrs.push('readonly="true"');
  }

  // Build optional child elements
  const children: string[] = [];

  if (node.find?.primary) {
    const selectorAttrs = [xmlAttr('primary', node.find.primary)];
    if (node.find.alternates && node.find.alternates.length > 0) {
      selectorAttrs.push(xmlAttr('alternates', node.find.alternates.join(';')));
    }
    children.push(`  <selector ${selectorAttrs.join(' ')} />`);
  }

  if (node.attributes) {
    const attrPairs: string[] = [];
    for (const [key, value] of Object.entries(node.attributes)) {
      if (value !== undefined) {
        attrPairs.push(`${escapeXml(key)}="${escapeXml(String(value))}"`);
      }
    }
    if (attrPairs.length > 0) {
      children.push(`  <attrs ${attrPairs.join(' ')} />`);
    }
  }

  const nodeOpen = `<node ${attrs.join(' ')}>${escapeXml(node.label)}`;
  if (children.length > 0) {
    lines.push(nodeOpen);
    lines.push(...children);
    lines.push('</node>');
  } else {
    lines.push(`${nodeOpen}</node>`);
  }

  return lines.join('\n');
}
