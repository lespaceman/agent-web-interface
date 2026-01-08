/**
 * Region Resolver
 *
 * Determines semantic page region for each node.
 *
 * @module snapshot/extractors/region-resolver
 *
 * Sources:
 * - ARIA landmark roles (banner, navigation, main, contentinfo)
 * - HTML5 sectioning elements (header, nav, main, footer, aside)
 * - Ancestor traversal for inherited region
 */

import type { SemanticRegion } from '../snapshot.types.js';
import type { RawDomNode, RawAxNode } from './types.js';

/**
 * Mapping of ARIA roles to semantic regions
 */
const ROLE_TO_REGION: Record<string, SemanticRegion> = {
  banner: 'header',
  navigation: 'nav',
  main: 'main',
  complementary: 'aside',
  contentinfo: 'footer',
  dialog: 'dialog',
  alertdialog: 'dialog',
  search: 'search',
  form: 'form',
  region: 'unknown', // Generic region
};

/**
 * Mapping of HTML5 sectioning tags to semantic regions
 */
const TAG_TO_REGION: Record<string, SemanticRegion> = {
  HEADER: 'header',
  NAV: 'nav',
  MAIN: 'main',
  ASIDE: 'aside',
  FOOTER: 'footer',
  DIALOG: 'dialog',
  FORM: 'form',
  SEARCH: 'search',
};

/**
 * Get region from AX role.
 *
 * @param role - AX role string
 * @returns SemanticRegion or undefined
 */
function getRegionFromRole(role: string | undefined): SemanticRegion | undefined {
  if (!role) return undefined;
  return ROLE_TO_REGION[role.toLowerCase()];
}

/**
 * Get region from DOM tag name.
 *
 * @param tagName - DOM tag name
 * @returns SemanticRegion or undefined
 */
function getRegionFromTag(tagName: string | undefined): SemanticRegion | undefined {
  if (!tagName) return undefined;
  return TAG_TO_REGION[tagName.toUpperCase()];
}

/**
 * Get region from DOM role attribute.
 *
 * @param attributes - DOM attributes
 * @returns SemanticRegion or undefined
 */
function getRegionFromDomRole(
  attributes: Record<string, string> | undefined
): SemanticRegion | undefined {
  if (!attributes?.role) return undefined;
  return ROLE_TO_REGION[attributes.role.toLowerCase()];
}

/**
 * Resolve semantic region for a node.
 *
 * Priority:
 * 1. AX role (most reliable)
 * 2. DOM role attribute
 * 3. HTML5 tag name
 * 4. Ancestor traversal (checks DOM tags, DOM role attrs, AND AX roles)
 *
 * @param domNode - Raw DOM node data (optional)
 * @param axNode - Raw AX node data (optional)
 * @param domTree - Full DOM tree for ancestor lookup
 * @param axTree - Full AX tree for ancestor AX role lookup (optional)
 * @returns SemanticRegion
 */
export function resolveRegion(
  domNode: RawDomNode | undefined,
  axNode: RawAxNode | undefined,
  domTree: Map<number, RawDomNode>,
  axTree?: Map<number, RawAxNode>
): SemanticRegion {
  // 1. Check AX role (highest priority)
  const axRegion = getRegionFromRole(axNode?.role);
  if (axRegion && axRegion !== 'unknown') {
    return axRegion;
  }

  // 2. Check DOM role attribute
  const domRoleRegion = getRegionFromDomRole(domNode?.attributes);
  if (domRoleRegion && domRoleRegion !== 'unknown') {
    return domRoleRegion;
  }

  // 3. Check current node's tag
  const tagRegion = getRegionFromTag(domNode?.nodeName);
  if (tagRegion && tagRegion !== 'unknown') {
    return tagRegion;
  }

  // 4. Traverse ancestors to find containing landmark
  if (domNode && domTree.size > 0) {
    const ancestorRegion = findAncestorRegion(domNode, domTree, axTree);
    if (ancestorRegion && ancestorRegion !== 'unknown') {
      return ancestorRegion;
    }
  }

  return 'unknown';
}

/**
 * Find region by traversing DOM ancestors.
 *
 * Checks (in priority order):
 * 1. Parent's AX role (if axTree provided)
 * 2. Parent's DOM tag name
 * 3. Parent's DOM role attribute
 *
 * @param node - Starting node
 * @param domTree - Full DOM tree
 * @param axTree - Full AX tree (optional)
 * @returns SemanticRegion from nearest ancestor landmark, or undefined
 */
function findAncestorRegion(
  node: RawDomNode,
  domTree: Map<number, RawDomNode>,
  axTree?: Map<number, RawAxNode>
): SemanticRegion | undefined {
  let currentId = node.parentId;
  const visited = new Set<number>();

  // Traverse up to 50 levels (prevent infinite loops)
  let depth = 0;
  const maxDepth = 50;

  while (currentId !== undefined && depth < maxDepth) {
    if (visited.has(currentId)) {
      // Cycle detected
      break;
    }
    visited.add(currentId);

    const parentNode = domTree.get(currentId);
    if (!parentNode) {
      break;
    }

    // Check parent's AX role (highest priority if available)
    if (axTree) {
      const parentAx = axTree.get(currentId);
      if (parentAx?.role) {
        const axRoleRegion = getRegionFromRole(parentAx.role);
        if (axRoleRegion && axRoleRegion !== 'unknown') {
          return axRoleRegion;
        }
      }
    }

    // Check parent's tag for landmark
    const tagRegion = getRegionFromTag(parentNode.nodeName);
    if (tagRegion && tagRegion !== 'unknown') {
      return tagRegion;
    }

    // Check parent's role attribute
    const roleRegion = getRegionFromDomRole(parentNode.attributes);
    if (roleRegion && roleRegion !== 'unknown') {
      return roleRegion;
    }

    currentId = parentNode.parentId;
    depth++;
  }

  return undefined;
}
