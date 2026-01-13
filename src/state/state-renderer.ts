/**
 * State Renderer
 *
 * Converts internal state representation (StateResponse) into a dense XML format
 * optimized for LLM context windows.
 */

import type { StateResponseObject, ActionableInfo } from './types.js';

/**
 * Render a StateResponseObject as a dense XML string.
 *
 * @param response - Internal state response object
 * @returns Dense XML string
 */
export function renderStateXml(response: StateResponseObject): string {
  const { state, diff, actionables, atoms } = response;

  const lines: string[] = [];

  // 1. Root and Meta
  lines.push(`<state step="${state.step}" title="${escapeXml(state.doc.title)}" url="${escapeXml(state.doc.url)}">`);

  const view = `${atoms.viewport.w}x${atoms.viewport.h}`;
  const scroll = `${atoms.scroll.x},${atoms.scroll.y}`;
  lines.push(`  <meta view="${view}" scroll="${scroll}" layer="${state.layer.active}" />`);

  // 2. Diff/Baseline
  if (diff.mode === 'baseline') {
    lines.push(`  <baseline reason="${diff.reason}"${diff.error ? ` error="${escapeXml(diff.error)}"` : ''} />`);
  } else {
    const d = diff;
    lines.push(`  <diff type="mutation">`);
    if (d.diff.doc) {
      lines.push(`    <nav type="${d.diff.doc.nav_type}" />`);
    }
    if (d.diff.actionables.added.length > 0 || d.diff.actionables.removed.length > 0) {
      lines.push(`    <nodes added="${d.diff.actionables.added.length}" removed="${d.diff.actionables.removed.length}" />`);
    }
    lines.push(`  </diff>`);
  }

  // 3. Actionables (Grouped by Region)
  const regions = groupActionablesByRegion(actionables);
  for (const [regionName, items] of Object.entries(regions)) {
    lines.push(`  <region name="${regionName}">`);
    for (const item of items) {
      lines.push(`    ${renderActionable(item)}`);
    }
    lines.push(`  </region>`);
  }

  lines.push(`</state>`);

  return lines.join('\n');
}

/**
 * Render a single actionable element as XML.
 */
function renderActionable(item: ActionableInfo): string {
  const tag = mapKindToTag(item.kind);
  const attrs: string[] = [`id="${item.eid}"`];

  // State flags (compact)
  if (!item.ena) attrs.push(`e="0"`);
  if (!item.vis) attrs.push(`v="0"`);
  if (item.chk) attrs.push(`chk="1"`);
  if (item.sel) attrs.push(`sel="1"`);
  if (item.exp) attrs.push(`exp="1"`);
  if (item.foc) attrs.push(`foc="1"`);

  // Attributes
  if (item.val_hint) attrs.push(`val="${escapeXml(item.val_hint)}"`);
  if (item.type) attrs.push(`type="${escapeXml(item.type)}"`);
  if (item.href) attrs.push(`href="${escapeXml(item.href)}"`);

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  const content = escapeXml(item.name);

  return `<${tag}${attrStr}>${content}</${tag}>`;
}

/**
 * Map semantic kind to short XML tag names.
 */
function mapKindToTag(kind: string): string {
  switch (kind.toLowerCase()) {
    case 'button': return 'btn';
    case 'link': return 'link';
    case 'textbox': return 'inp';
    case 'checkbox': return 'chk';
    case 'radio': return 'rad';
    case 'combobox': return 'sel';
    case 'image': return 'img';
    case 'heading': return 'h';
    default: return 'elt';
  }
}

/**
 * Group actionables by their region context.
 */
function groupActionablesByRegion(actionables: ActionableInfo[]): Record<string, ActionableInfo[]> {
  const regions: Record<string, ActionableInfo[]> = {};
  for (const item of actionables) {
    const region = item.ctx.layer || 'unknown';
    if (!regions[region]) regions[region] = [];
    regions[region].push(item);
  }
  return regions;
}

/**
 * Simple XML escaping.
 */
function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/[<>&"']/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '"': return '&quot;';
        case "'": return '&apos;';
        default: return c;
      }
    });
}
