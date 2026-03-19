/**
 * Node Synthesizer
 *
 * Synthesizes nodes from DOM data that the AX tree misses or misclassifies:
 * - Option nodes from <select> children (often marked as ignored by Chrome)
 * - Canvas nodes (classified as generic/ignored by AX tree)
 * - Toast library nodes (promoted to alert role for unsemantic toast libraries)
 *
 * @module snapshot/node-synthesizer
 */

import type { RawNodeData, RawDomNode, RawAxNode, DomExtractionResult } from './extractors/index.js';
import { getTextContent } from '../lib/text-utils.js';

/**
 * Data attributes used by unsemantic toast libraries.
 * Keep in sync with TOAST_LIBRARY_SELECTOR in observer-script.ts.
 */
export const TOAST_DATA_ATTRS = ['data-sonner-toast', 'data-hot-toast'];

/**
 * CSS class substrings used by unsemantic toast libraries.
 * Keep in sync with TOAST_LIBRARY_SELECTOR in observer-script.ts.
 */
export const TOAST_CLASS_PATTERNS = [
  'Toastify__toast',
  'ant-message-notice',
  'ant-message',
  'chakra-toast',
];

/**
 * Check if a DOM node belongs to a known unsemantic toast library.
 */
export function isToastLibraryNode(domNode: RawDomNode): boolean {
  const attrs = domNode.attributes;
  if (!attrs) return false;

  for (const attrName of TOAST_DATA_ATTRS) {
    if (attrs[attrName] !== undefined) return true;
  }

  const className = attrs.class ?? attrs.className;
  if (typeof className === 'string') {
    for (const pattern of TOAST_CLASS_PATTERNS) {
      if (className.includes(pattern)) return true;
    }
  }

  return false;
}

/**
 * Synthesize option nodes from <select> children.
 *
 * Chrome's AX tree often marks <option> nodes as ignored when the select
 * is collapsed, and their bounding boxes are zero (OS-rendered).
 * We inject them from the DOM so AI agents can discover available options.
 *
 * @param nodesToProcess - Current node list (mutated in place)
 * @param domResult - DOM extraction result
 */
export function synthesizeOptionNodes(
  nodesToProcess: RawNodeData[],
  domResult: DomExtractionResult
): void {
  const alreadyInSet = new Set(nodesToProcess.map((n) => n.backendNodeId));

  for (const nodeData of [...nodesToProcess]) {
    const domNode = nodeData.domNode;
    if (domNode?.nodeName.toUpperCase() !== 'SELECT') continue;

    const collectOptions = (parentId: number) => {
      const parent = domResult.nodes.get(parentId);
      if (!parent?.childNodeIds) return;

      for (const childId of parent.childNodeIds) {
        const child = domResult.nodes.get(childId);
        if (!child) continue;

        const childTag = child.nodeName.toUpperCase();

        if (childTag === 'OPTGROUP') {
          // Recurse into optgroup to find nested options
          collectOptions(childId);
        } else if (childTag === 'OPTION' && !alreadyInSet.has(childId)) {
          // Extract text content from option's child text nodes
          const optionText = getTextContent(childId, domResult.nodes);

          // Build synthetic AX node so label resolution and state extraction work
          const syntheticAx: RawAxNode = {
            nodeId: `synthetic-opt-${childId}`,
            backendDOMNodeId: childId,
            role: 'option',
            name: optionText ?? '',
            properties: [],
          };

          // Transfer selected attribute to AX property
          if (child.attributes?.selected !== undefined) {
            syntheticAx.properties!.push({
              name: 'selected',
              value: { type: 'boolean', value: true },
            });
          }

          // Transfer disabled attribute to AX property
          if (child.attributes?.disabled !== undefined) {
            syntheticAx.properties!.push({
              name: 'disabled',
              value: { type: 'boolean', value: true },
            });
          }

          nodesToProcess.push({
            backendNodeId: childId,
            domNode: child,
            axNode: syntheticAx,
          });
          alreadyInSet.add(childId);
        }
      }
    };

    collectOptions(domNode.backendNodeId);
  }
}

/**
 * Synthesize canvas nodes from DOM.
 *
 * Canvas elements are classified as generic/ignored by the AX tree,
 * so we inject them from the DOM so AI agents can discover and interact with them.
 *
 * @param nodesToProcess - Current node list (mutated in place)
 * @param domResult - DOM extraction result
 */
export function synthesizeCanvasNodes(
  nodesToProcess: RawNodeData[],
  domResult: DomExtractionResult
): void {
  const alreadyInCanvas = new Set(nodesToProcess.map((n) => n.backendNodeId));

  for (const [backendNodeId, domNode] of domResult.nodes) {
    if (domNode.nodeName.toUpperCase() !== 'CANVAS') continue;
    if (alreadyInCanvas.has(backendNodeId)) continue;

    const syntheticAx: RawAxNode = {
      nodeId: `synthetic-canvas-${backendNodeId}`,
      backendDOMNodeId: backendNodeId,
      role: 'canvas',
      name: domNode.attributes?.['aria-label'] ?? '',
      properties: [],
    };

    nodesToProcess.push({
      backendNodeId,
      domNode,
      axNode: syntheticAx,
    });
    alreadyInCanvas.add(backendNodeId);
  }
}

/**
 * Promote unsemantic toast library nodes to alert role.
 *
 * Popular toast libraries (Sonner, react-hot-toast, Toastify, Ant Design, Chakra UI)
 * don't use ARIA roles. Detect them by data attributes and CSS classes.
 * Selectors mirror TOAST_LIBRARY_SELECTOR in observer-script.ts — keep in sync.
 *
 * Some toast elements (e.g., Sonner's <li data-sonner-toast>) are already in
 * nodesToProcess via the AX tree (as listitem/generic), so we must also override
 * their axNode role — not just add new nodes.
 *
 * @param nodesToProcess - Current node list (mutated in place)
 * @param domResult - DOM extraction result
 */
export function promoteToastNodes(
  nodesToProcess: RawNodeData[],
  domResult: DomExtractionResult
): void {
  const scheduledIndex = new Map(nodesToProcess.map((n, i) => [n.backendNodeId, i]));

  for (const [backendNodeId, domNode] of domResult.nodes) {
    if (!isToastLibraryNode(domNode)) continue;

    const syntheticAx: RawAxNode = {
      nodeId: `synthetic-toast-${backendNodeId}`,
      backendDOMNodeId: backendNodeId,
      role: 'alert',
      name: '', // Will be resolved via label fallback (textContent)
      properties: [],
    };

    const existingIdx = scheduledIndex.get(backendNodeId);
    if (existingIdx !== undefined) {
      // Already scheduled (e.g., Sonner <li> classified as listitem) — override role
      nodesToProcess[existingIdx].axNode = syntheticAx;
    } else {
      nodesToProcess.push({
        backendNodeId,
        domNode,
        axNode: syntheticAx,
      });
      scheduledIndex.set(backendNodeId, nodesToProcess.length - 1);
    }
  }
}
