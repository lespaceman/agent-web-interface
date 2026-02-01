/**
 * State Renderer
 *
 * Converts internal state representation (StateResponse) into a dense XML format
 * optimized for LLM context windows.
 *
 * In diff mode, only renders changed elements (added + changed) to minimize tokens.
 * In baseline mode, renders all actionables.
 */

import type { StateResponseObject, ActionableInfo, RenderOptions } from './types.js';
import type { DOMObservation, ObservationGroups } from '../observation/observation.types.js';
import { escapeXml } from '../lib/text-utils.js';

// ============================================================================
// Region Trimming Configuration
// ============================================================================

/** When 'false', disables region trimming globally regardless of per-tool options. Default: enabled. */
const TRIM_ENABLED = process.env.ATHENA_TRIM_REGIONS !== 'false';

/**
 * Per-region limits for trimming actionable elements in snapshot responses.
 * For each region, keep the first `head` and last `tail` elements; trim the middle.
 */
const REGION_TRIM_LIMITS: Record<string, { head: number; tail: number }> = {
  header: { head: 3, tail: 2 },
  nav: { head: 3, tail: 2 },
  main: { head: 5, tail: 5 },
  aside: { head: 3, tail: 2 },
  footer: { head: 2, tail: 2 },
  dialog: { head: 5, tail: 5 },
  search: { head: 2, tail: 2 },
  form: { head: 5, tail: 3 },
};

const DEFAULT_TRIM_LIMITS = { head: 5, tail: 3 };

/**
 * Trim a region's elements to head + tail, dropping the middle.
 *
 * @param elements - Full list of actionable elements in a region
 * @param limits - How many to keep from the start (head) and end (tail)
 * @returns The kept elements and count of trimmed elements
 */
export function trimRegionElements(
  elements: ActionableInfo[],
  limits: { head: number; tail: number }
): { kept: ActionableInfo[]; trimmedCount: number } {
  const total = limits.head + limits.tail;
  if (elements.length <= total) return { kept: elements, trimmedCount: 0 };

  const head = elements.slice(0, limits.head);
  const tail = limits.tail > 0 ? elements.slice(-limits.tail) : [];
  const trimmedCount = elements.length - total;

  return { kept: [...head, ...tail], trimmedCount };
}

/**
 * Render a StateResponseObject as a dense XML string.
 *
 * @param response - Internal state response object
 * @param options - Optional rendering options (e.g., trimRegions)
 * @returns Dense XML string
 */
export function renderStateXml(response: StateResponseObject, options?: RenderOptions): string {
  const { state, diff, actionables, atoms } = response;

  const lines: string[] = [];

  // 1. Root and Meta
  lines.push(
    `<state step="${state.step}" title="${escapeXml(state.doc.title)}" url="${escapeXml(state.doc.url)}">`
  );

  const view = `${atoms.viewport.w}x${atoms.viewport.h}`;
  const scroll = `${atoms.scroll.x},${atoms.scroll.y}`;
  lines.push(`  <meta view="${view}" scroll="${scroll}" layer="${state.layer.active}" />`);

  // 2. Diff/Baseline indicator
  if (diff.mode === 'baseline') {
    lines.push(
      `  <baseline reason="${diff.reason}"${diff.error ? ` error="${escapeXml(diff.error)}"` : ''} />`
    );
  } else {
    const d = diff;

    // Build flattened diff attributes
    const diffAttrs: string[] = ['type="mutation"'];
    if (d.diff.doc) {
      diffAttrs.push(`nav="${d.diff.doc.nav_type}"`);
    }
    if (d.diff.actionables.added.length > 0) {
      diffAttrs.push(`added="${d.diff.actionables.added.length}"`);
    }
    if (d.diff.actionables.removed.length > 0) {
      diffAttrs.push(`removed="${d.diff.actionables.removed.length}"`);
    }

    // Check if there are mutations to render inline
    const { textChanged, statusAppeared } = d.diff.mutations;
    const hasMutations = textChanged.length > 0 || statusAppeared.length > 0;

    if (hasMutations) {
      lines.push(`  <diff ${diffAttrs.join(' ')}>`);
      // Render mutations directly without wrapper
      for (const change of textChanged) {
        const from = escapeXml(change.from);
        const to = escapeXml(change.to);
        lines.push(`    <text-changed id="${change.eid}">${from} → ${to}</text-changed>`);
      }
      for (const status of statusAppeared) {
        const text = escapeXml(status.text);
        lines.push(`    <status id="${status.eid}" role="${status.role}">${text}</status>`);
      }
      lines.push(`  </diff>`);
    } else {
      lines.push(`  <diff ${diffAttrs.join(' ')} />`);
    }
  }

  // 3. Observations (if present)
  if (response.observations) {
    const obsLines = renderObservations(response.observations);
    if (obsLines.length > 0) {
      lines.push(...obsLines);
    }
  }

  // 4. Actionables (Grouped by Region)
  // In diff mode: only render added/changed elements (unless in overlay layer)
  // In baseline mode: render all elements
  const activeLayer = state.layer.active;
  const filteredActionables = filterActionablesForMode(actionables, diff, activeLayer);
  const regions = groupActionablesByRegion(filteredActionables);

  const shouldTrim = TRIM_ENABLED && options?.trimRegions === true;

  for (const [regionName, items] of Object.entries(regions)) {
    const limits = REGION_TRIM_LIMITS[regionName] ?? DEFAULT_TRIM_LIMITS;
    const { kept, trimmedCount } = shouldTrim
      ? trimRegionElements(items, limits)
      : { kept: items, trimmedCount: 0 };

    lines.push(`  <region name="${regionName}">`);

    for (const item of kept) {
      lines.push(`    ${renderActionable(item, diff)}`);
    }

    if (trimmedCount > 0) {
      lines.push(
        `    <!-- trimmed ${trimmedCount} items. Use find_elements with region=${regionName} to see all -->`
      );
    }

    lines.push(`  </region>`);
  }

  lines.push(`</state>`);

  return lines.join('\n');
}

/**
 * Overlay layer types that should always show all actionables.
 * When in these layers, we show all elements regardless of diff mode
 * because the user needs to see the overlay content to interact with it.
 *
 * These values correspond to non-'main' values of LayerDetectionResult.active.
 * See layer-detector.ts for detection logic.
 */
const OVERLAY_LAYERS = new Set(['modal', 'popover', 'drawer']);

/**
 * Filter actionables based on diff mode and active layer.
 *
 * In baseline mode: return all actionables
 * In diff mode with overlay layer: return all actionables (user needs to see overlay content)
 * In diff mode with main layer: return only added elements + elements with property changes
 *   (visibility, enabled, checked, selected, expanded, focused, value, label)
 */
function filterActionablesForMode(
  actionables: ActionableInfo[],
  diff: StateResponseObject['diff'],
  activeLayer: string
): ActionableInfo[] {
  // Baseline mode: return all
  if (diff.mode === 'baseline') {
    return actionables;
  }

  // Overlay layers (modal, popover, drawer): always show all actionables
  // The user needs to see the overlay content to interact with it
  if (OVERLAY_LAYERS.has(activeLayer)) {
    return actionables;
  }

  // Diff mode with main layer: only include added and changed elements
  const d = diff;
  const addedSet = new Set(d.diff.actionables.added);
  const changedSet = new Set(d.diff.actionables.changed.map((c) => c.eid));

  return actionables.filter((item) => addedSet.has(item.eid) || changedSet.has(item.eid));
}

/**
 * Render a single actionable element as XML.
 * In diff mode, can optionally mark elements as 'new' if they were just added.
 */
function renderActionable(item: ActionableInfo, _diff?: StateResponseObject['diff']): string {
  const tag = mapKindToTag(item.kind);
  const attrs: string[] = [`id="${item.eid}"`];

  // State flags (descriptive names with boolean values)
  if (!item.ena) attrs.push(`enabled="false"`);
  if (!item.vis) attrs.push(`visible="false"`);
  if (item.chk) attrs.push(`checked="true"`);
  if (item.sel) attrs.push(`selected="true"`);
  if (item.exp) attrs.push(`expanded="true"`);
  if (item.foc) attrs.push(`focused="true"`);

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
    case 'button':
      return 'btn';
    case 'link':
      return 'link';
    case 'textbox':
      return 'inp';
    case 'checkbox':
      return 'chk';
    case 'radio':
      return 'rad';
    case 'combobox':
      return 'sel';
    case 'image':
      return 'img';
    case 'heading':
      return 'h';
    default:
      return 'elt';
  }
}

/**
 * Group actionables by their semantic region.
 */
function groupActionablesByRegion(actionables: ActionableInfo[]): Record<string, ActionableInfo[]> {
  const regions: Record<string, ActionableInfo[]> = {};
  for (const item of actionables) {
    // Use semantic region, fallback to 'main' if unknown
    const region = item.ctx.region === 'unknown' ? 'main' : item.ctx.region;
    if (!regions[region]) regions[region] = [];
    regions[region].push(item);
  }
  return regions;
}

// ============================================================================
// Observation Rendering
// ============================================================================

/**
 * Deduplicate observations by tag + text content.
 * When multiple observations have the same tag and text (e.g., nested wrapper divs),
 * keep only the one with the highest significance score.
 *
 * This prevents noisy duplicate entries from nested DOM structures like:
 * <div class="toast"><div class="wrapper"><span>message</span></div></div>
 * where multiple divs would all report the same text content.
 */
function deduplicateObservations(observations: DOMObservation[]): DOMObservation[] {
  if (observations.length <= 1) {
    return observations;
  }

  // Group by tag + truncated text (first 50 chars to handle slight variations)
  const byContent = new Map<string, DOMObservation>();

  for (const obs of observations) {
    const textKey = obs.content.text.substring(0, 50).trim();
    const key = `${obs.content.tag}:${textKey}`;

    const existing = byContent.get(key);
    if (!existing || obs.significance > existing.significance) {
      // Keep the observation with higher significance
      byContent.set(key, obs);
    }
  }

  return Array.from(byContent.values());
}

/**
 * Render observations section if there are any significant observations.
 *
 * Output format (flattened, no wrapper elements):
 * <observations>
 *   <appeared when="action" eid="dialog-001" role="dialog">...</appeared>
 *   <appeared when="prior" eid="toast-002" role="alert" age_ms="1500">...</appeared>
 * </observations>
 */
export function renderObservations(observations: ObservationGroups): string[] {
  const { duringAction, sincePrevious } = observations;

  if (duringAction.length === 0 && sincePrevious.length === 0) {
    return [];
  }

  // Deduplicate observations to avoid noisy duplicates from nested elements
  const dedupedDuringAction = deduplicateObservations(duringAction);
  const dedupedSincePrevious = deduplicateObservations(sincePrevious);

  const lines: string[] = [];
  lines.push('  <observations>');

  // Render all observations with when="action" or when="prior" attribute
  for (const obs of dedupedDuringAction) {
    lines.push(...renderSingleObservation(obs, 'action', 4));
  }
  for (const obs of dedupedSincePrevious) {
    lines.push(...renderSingleObservation(obs, 'prior', 4));
  }

  lines.push('  </observations>');
  return lines;
}

/**
 * Render a single observation as XML lines.
 *
 * Output format:
 * <appeared when="action" eid="dialog-001" role="dialog" delay_ms="200">
 *   <heading eid="dlg-title">My Cart</heading>
 *   <text>Your cart is empty.</text>
 *   <button eid="btn-shop">Continue Shopping</button>
 * </appeared>
 *
 * Or without children:
 * <appeared when="action" eid="toast-001" role="alert">Error message</appeared>
 *
 * @param obs - The observation to render
 * @param when - 'action' for duringAction, 'prior' for sincePrevious
 * @param indent - Number of spaces for indentation
 * @returns Array of XML lines
 */
export function renderSingleObservation(
  obs: DOMObservation,
  when: 'action' | 'prior',
  indent: number
): string[] {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  // Build attributes (flattened, no nested elements)
  const attrs: string[] = [`when="${when}"`];
  if (obs.eid) attrs.push(`eid="${obs.eid}"`);
  if (obs.content.role) attrs.push(`role="${obs.content.role}"`);
  if (obs.delayMs) attrs.push(`delay_ms="${obs.delayMs}"`);
  if (obs.ageMs) attrs.push(`age_ms="${obs.ageMs}"`);
  if (obs.signals.wasShortLived) attrs.push('transient="true"');

  const hasChildren = obs.children && obs.children.length > 0;

  if (hasChildren) {
    lines.push(`${pad}<${obs.type} ${attrs.join(' ')}>`);
    for (const child of obs.children!) {
      const childAttrs = child.eid ? ` eid="${child.eid}"` : '';
      lines.push(`${pad}  <${child.tag}${childAttrs}>${escapeXml(child.text)}</${child.tag}>`);
    }
    lines.push(`${pad}</${obs.type}>`);
  } else {
    const text = escapeXml(obs.content.text);
    lines.push(`${pad}<${obs.type} ${attrs.join(' ')}>${text}</${obs.type}>`);
  }

  return lines;
}
