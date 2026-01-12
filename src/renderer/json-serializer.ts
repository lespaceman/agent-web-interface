/**
 * JSON Serializer
 *
 * Serialize BaseSnapshot and FactPack to comprehensive JSON page summary.
 * Returns ALL interactive elements with full state (no filtering).
 */

import type { BaseSnapshot, NodeKind } from '../snapshot/snapshot.types.js';
import type { FactPack } from '../factpack/types.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface PageSummary {
  type: string;
  url: string;
  title: string;

  dialogs?: {
    blocking: boolean;
    list: {
      id: string;
      type: string;
      title?: string;
      modal: boolean;
      actions: {
        id: string;
        label: string;
        role: string;
      }[];
    }[];
  };

  regions: {
    header?: ElementInfo[];
    nav?: ElementInfo[];
    main?: ElementInfo[];
    footer?: ElementInfo[];
    aside?: ElementInfo[];
    dialog?: ElementInfo[];
    unknown?: ElementInfo[];
  };

  stats: {
    total: number;
    by_kind: Record<string, number>;
  };
}

interface ElementInfo {
  id: string;
  kind: string;
  label: string;
  vis: boolean;
  ena: boolean;
  chk?: boolean;
  sel?: boolean;
  exp?: boolean;
  foc?: boolean;
  req?: boolean;
  inv?: boolean;
  rdo?: boolean;
  val?: string;
  placeholder?: string;
  href?: string;
  type?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a node kind represents an interactive element.
 */
function isInteractiveKind(kind: NodeKind): boolean {
  const interactiveKinds: NodeKind[] = [
    'link',
    'button',
    'input',
    'textarea',
    'select',
    'combobox',
    'checkbox',
    'radio',
    'switch',
    'slider',
    'tab',
    'menuitem',
  ];
  return interactiveKinds.includes(kind);
}

/**
 * Extract interactive elements from snapshot.
 */
function extractInteractiveElements(snapshot: BaseSnapshot) {
  return snapshot.nodes.filter(node => isInteractiveKind(node.kind));
}

/**
 * Estimate token count for JSON string.
 * Rule of thumb: ~4 characters per token.
 */
function estimateTokens(jsonString: string): number {
  return Math.ceil(jsonString.length / 4);
}

// ============================================================================
// Main Serializer
// ============================================================================

/**
 * Generate comprehensive JSON page summary from snapshot and factpack.
 * Includes ALL interactive elements with full state (no filtering).
 *
 * @param snapshot - Compiled BaseSnapshot
 * @param factpack - Extracted FactPack
 * @returns Page summary with token estimate
 */
export function generatePageSummary(
  snapshot: BaseSnapshot,
  factpack: FactPack
): { page_summary: PageSummary; page_summary_tokens: number } {

  // 1. Extract page type
  const pageType = factpack.page_type.classification.type;

  // 2. Extract dialogs (only if present)
  let dialogs: PageSummary['dialogs'] | undefined;
  if (factpack.dialogs.dialogs.length > 0) {
    dialogs = {
      blocking: factpack.dialogs.has_blocking_dialog,
      list: factpack.dialogs.dialogs.map(dialog => ({
        id: dialog.node_id,
        type: dialog.type,
        title: dialog.title,
        modal: dialog.is_modal,
        actions: dialog.actions.map(action => ({
          id: action.node_id,
          label: action.label,
          role: action.role,
        })),
      })),
    };
  }

  // 3. Extract ALL interactive elements
  const interactiveNodes = extractInteractiveElements(snapshot);

  // 4. Group elements by region
  const regionMap: Record<string, ElementInfo[]> = {
    header: [],
    nav: [],
    main: [],
    footer: [],
    aside: [],
    dialog: [],
    unknown: [],
  };

  for (const node of interactiveNodes) {
    const region = node.where.region || 'unknown';

    const element: ElementInfo = {
      id: node.node_id,
      kind: node.kind,
      label: node.label,
      vis: node.state?.visible ?? false,
      ena: node.state?.enabled ?? false,
    };

    // Only include truthy state values
    if (node.state?.checked) element.chk = true;
    if (node.state?.selected) element.sel = true;
    if (node.state?.expanded) element.exp = true;
    if (node.state?.focused) element.foc = true;
    if (node.state?.required) element.req = true;
    if (node.state?.invalid) element.inv = true;
    if (node.state?.readonly) element.rdo = true;

    // Flatten attributes to element level (only if present)
    if (node.attributes?.value) element.val = node.attributes.value;
    if (node.attributes?.placeholder) element.placeholder = node.attributes.placeholder;
    if (node.attributes?.href) element.href = node.attributes.href;
    if (node.attributes?.input_type) element.type = node.attributes.input_type;

    if (region in regionMap) {
      regionMap[region].push(element);
    } else {
      regionMap.unknown.push(element);
    }
  }

  // 5. Build regions object (only include non-empty regions)
  const regions: PageSummary['regions'] = {};
  for (const [region, elements] of Object.entries(regionMap)) {
    if (elements.length > 0) {
      regions[region as keyof PageSummary['regions']] = elements;
    }
  }

  // 6. Calculate stats
  const by_kind: Record<string, number> = {};
  for (const node of interactiveNodes) {
    by_kind[node.kind] = (by_kind[node.kind] || 0) + 1;
  }

  const stats = {
    total: interactiveNodes.length,
    by_kind,
  };

  // 7. Build final summary
  const page_summary: PageSummary = {
    type: pageType,
    url: snapshot.url,
    title: snapshot.title,
    regions,
    stats,
  };

  // Only include dialogs if present
  if (dialogs) {
    page_summary.dialogs = dialogs;
  }

  // 8. Estimate token count
  const jsonString = JSON.stringify(page_summary);
  const page_summary_tokens = estimateTokens(jsonString);

  return { page_summary, page_summary_tokens };
}
