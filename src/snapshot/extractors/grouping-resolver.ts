/**
 * Grouping Resolver
 *
 * Computes group hierarchy and heading context.
 *
 * @module snapshot/extractors/grouping-resolver
 *
 * Concepts:
 * - group_id: Unique identifier for containing group (form, menu, card)
 * - group_path: Breadcrumb hierarchy ["Men", "Shoes", "Running"]
 * - heading_context: Nearest preceding heading text
 */

import type { RawDomNode, RawAxNode, RawNodeData } from './types.js';

/** Maximum length for slugified names in group IDs */
const MAX_SLUG_LENGTH = 40;

/**
 * Grouping information for a node
 */
export interface GroupingInfo {
  /** Unique identifier for containing group */
  group_id?: string;
  /** Hierarchy path from nested groups */
  group_path?: string[];
  /** Nearest preceding heading text */
  heading_context?: string;
}

/**
 * DOM tags that indicate grouping elements
 */
const GROUPING_TAGS = new Set([
  'FORM',
  'FIELDSET',
  'ARTICLE',
  'SECTION',
  'NAV',
  'UL',
  'OL',
  'DL',
  'TABLE',
  'TBODY',
  'THEAD',
]);

/**
 * AX roles that indicate grouping elements
 */
const GROUPING_ROLES = new Set([
  'form',
  'group',
  'menu',
  'menubar',
  'navigation',
  'list',
  'listbox',
  'tree',
  'treegrid',
  'grid',
  'table',
  'tablist',
  'radiogroup',
  'toolbar',
  'directory',
]);

/**
 * Check if a node is a grouping container.
 *
 * @param domNode - DOM node
 * @param axNode - AX node
 * @returns true if this node is a grouping container
 */
function isGroupingContainer(domNode?: RawDomNode, axNode?: RawAxNode): boolean {
  // Check AX role
  if (axNode?.role && GROUPING_ROLES.has(axNode.role.toLowerCase())) {
    return true;
  }

  // Check DOM tag
  if (domNode?.nodeName && GROUPING_TAGS.has(domNode.nodeName.toUpperCase())) {
    return true;
  }

  // Check DOM role attribute
  const domRole = domNode?.attributes?.role?.toLowerCase();
  if (domRole && GROUPING_ROLES.has(domRole)) {
    return true;
  }

  return false;
}

/**
 * Slugify a string for use in group IDs.
 *
 * Converts "Shop and Learn" → "shop-and-learn"
 * Removes special characters, normalizes whitespace.
 *
 * @param text - Input text
 * @returns Slugified string
 */
function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      // Replace common separators with hyphens
      .replace(/[\s_]+/g, '-')
      // Remove apostrophes and quotes
      .replace(/[''"`]/g, '')
      // Replace & with "and" word or just remove
      .replace(/&/g, '-')
      // Remove all non-alphanumeric except hyphens
      .replace(/[^a-z0-9-]/g, '')
      // Collapse multiple hyphens
      .replace(/-+/g, '-')
      // Trim leading/trailing hyphens
      .replace(/^-+|-+$/g, '')
      // Truncate to max length
      .slice(0, MAX_SLUG_LENGTH)
      // Remove trailing hyphen if truncated mid-word
      .replace(/-$/, '')
  );
}

/**
 * Generate a group ID from node information.
 *
 * Format: {role}-{slugified-name}
 *
 * @param domNode - DOM node
 * @param axNode - AX node
 * @param headingContext - Optional heading context as fallback name
 * @returns Group ID string
 */
function generateGroupId(
  domNode?: RawDomNode,
  axNode?: RawAxNode,
  headingContext?: string
): string {
  const role =
    axNode?.role?.toLowerCase() ??
    domNode?.attributes?.role?.toLowerCase() ??
    domNode?.nodeName?.toLowerCase() ??
    'group';

  // Use name, aria-label, or id as identifier
  const rawName =
    axNode?.name ?? domNode?.attributes?.['aria-label'] ?? domNode?.attributes?.id ?? '';

  // Only use name if it's not empty after trimming
  if (rawName?.trim()) {
    const sluggedName = slugify(rawName);
    if (sluggedName) {
      return `${role}-${sluggedName}`;
    }
  }

  // Fallback to heading context if available
  if (headingContext?.trim()) {
    const sluggedHeading = slugify(headingContext);
    if (sluggedHeading) {
      return `${role}-${sluggedHeading}`;
    }
  }

  // Generate a simple ID from backendNodeId
  const nodeId = axNode?.backendDOMNodeId ?? domNode?.backendNodeId;
  if (nodeId) {
    return `${role}-${nodeId}`;
  }

  return role;
}

/**
 * Get group name for path building.
 *
 * @param domNode - DOM node
 * @param axNode - AX node
 * @returns Group name or undefined
 */
function getGroupName(domNode?: RawDomNode, axNode?: RawAxNode): string | undefined {
  return (
    axNode?.name ?? domNode?.attributes?.['aria-label'] ?? domNode?.attributes?.title ?? undefined
  );
}

/**
 * Check if a node is a heading.
 *
 * @param domNode - DOM node
 * @param axNode - AX node
 * @returns true if this is a heading
 */
function isHeading(domNode?: RawDomNode, axNode?: RawAxNode): boolean {
  if (axNode?.role === 'heading') return true;
  if (domNode?.nodeName?.match(/^H[1-6]$/i)) return true;
  return false;
}

/**
 * Find nearest preceding heading in the node list.
 *
 * @param targetNodeId - Backend node ID of target element
 * @param allNodes - All nodes in document order
 * @param domTree - DOM tree for parent lookup
 * @returns Heading text or undefined
 */
function findHeadingContext(
  targetNodeId: number,
  allNodes: RawNodeData[],
  domTree: Map<number, RawDomNode>
): string | undefined {
  // Find the target node's position and parent
  const targetNode = domTree.get(targetNodeId);
  if (!targetNode) return undefined;

  const parentId = targetNode.parentId;
  if (parentId === undefined) return undefined;

  // Find the parent's children to check siblings
  const parent = domTree.get(parentId);
  if (!parent?.childNodeIds) return undefined;

  // Get index of target in parent's children
  const targetIndex = parent.childNodeIds.indexOf(targetNodeId);
  if (targetIndex === -1) return undefined;

  // Look at preceding siblings for headings
  for (let i = targetIndex - 1; i >= 0; i--) {
    const siblingId = parent.childNodeIds[i];
    const siblingData = allNodes.find((n) => n.backendNodeId === siblingId);
    if (siblingData && isHeading(siblingData.domNode, siblingData.axNode)) {
      return siblingData.axNode?.name;
    }
  }

  // Also check all preceding nodes in document order
  let foundTarget = false;
  for (let i = allNodes.length - 1; i >= 0; i--) {
    const node = allNodes[i];
    if (node.backendNodeId === targetNodeId) {
      foundTarget = true;
      continue;
    }
    if (foundTarget && isHeading(node.domNode, node.axNode) && node.axNode?.name) {
      return node.axNode.name;
    }
  }

  return undefined;
}

/**
 * Resolve grouping information for a node.
 *
 * @param nodeId - Backend node ID
 * @param domTree - Full DOM tree
 * @param axTree - Full AX tree (backendDOMNodeId -> RawAxNode)
 * @param allNodes - All extracted nodes for heading context
 * @returns GroupingInfo
 */
export interface GroupingOptions {
  /** Include heading context resolution (default: true) */
  includeHeadingContext?: boolean;
}

export function resolveGrouping(
  nodeId: number,
  domTree: Map<number, RawDomNode>,
  axTree: Map<number, RawAxNode>,
  allNodes: RawNodeData[],
  options?: GroupingOptions
): GroupingInfo {
  const result: GroupingInfo = {};

  const node = domTree.get(nodeId);
  if (!node) return result;

  // Traverse ancestors to find grouping containers
  const groupPath: string[] = [];
  let groupId: string | undefined;
  let currentId: number | undefined = node.parentId;
  const visited = new Set<number>();
  const maxDepth = 50;
  let depth = 0;

  while (currentId !== undefined && depth < maxDepth) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const parentDom = domTree.get(currentId);
    const parentAx = axTree.get(currentId);

    if (isGroupingContainer(parentDom, parentAx)) {
      // Set group_id to the innermost group
      // Use heading context as fallback for unnamed groups
      if (groupId === undefined) {
        const containerHeadingContext = findHeadingContext(currentId, allNodes, domTree);
        groupId = generateGroupId(parentDom, parentAx, containerHeadingContext);
      }

      // Add to path if named
      const groupName = getGroupName(parentDom, parentAx);
      if (groupName) {
        groupPath.unshift(groupName);
      }
    }

    currentId = parentDom?.parentId;
    depth++;
  }

  if (groupId) {
    result.group_id = groupId;
  }

  if (groupPath.length > 0) {
    result.group_path = groupPath;
  }

  if (options?.includeHeadingContext ?? true) {
    // Find heading context
    const headingContext = findHeadingContext(nodeId, allNodes, domTree);
    if (headingContext) {
      result.heading_context = headingContext;
    }
  }

  return result;
}
