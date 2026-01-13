/**
 * Element Identity
 *
 * Generate stable, semantic element IDs (eids) that survive DOM mutations.
 * Uses semantic hashing instead of transient CDP backend_node_id.
 */

import { createHash } from 'crypto';
import type { ReadableNode } from '../snapshot/snapshot.types.js';
import type { ElementIdentity } from './types.js';

// ============================================================================
// EID Generation
// ============================================================================

/**
 * Compute stable semantic element ID for a node.
 *
 * Uses hash of semantic components:
 * - Role (or kind)
 * - Accessible name (normalized label)
 * - Href (for links)
 * - Landmark path (region + group_path)
 * - Layer context (modal vs main - prevents collision across layers)
 * - Position hint (screen zone + heading context)
 * - Shadow path (disambiguates elements in different shadow roots)
 *
 * @param node - Node to compute EID for
 * @param layer - Optional layer context for disambiguation
 * @returns 12-character hex hash
 */
export function computeEid(node: ReadableNode, layer?: string): string {
  // Shadow path ensures elements in different shadow roots get unique EIDs
  // even if they have identical semantic properties
  const shadowPath = node.find?.shadow_path?.join('/') ?? '';

  const components = [
    node.attributes?.role ?? node.kind,
    normalizeAccessibleName(node.label),
    node.attributes?.href ?? '',
    computeLandmarkPath(node),
    layer ?? computeLayerFromRegion(node),
    computePositionHint(node),
    shadowPath,
  ];

  return hashComponents(components);
}

/**
 * Compute layer from node region.
 * Used when explicit layer not provided.
 *
 * @param node - Node to check
 * @returns Layer name
 */
function computeLayerFromRegion(node: ReadableNode): string {
  const region = node.where.region ?? 'unknown';
  return region === 'dialog' ? 'modal' : 'main';
}

/**
 * Normalize accessible name for stable hashing.
 * - Trim whitespace
 * - Lowercase
 * - Collapse multiple spaces
 * - Cap length at 100 chars
 *
 * @param label - Raw label text
 * @returns Normalized label
 */
export function normalizeAccessibleName(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ').substring(0, 100);
}

/**
 * Compute landmark path for a node.
 * Format: "region/group1/group2"
 *
 * @param node - Node to compute path for
 * @returns Landmark path string
 */
export function computeLandmarkPath(node: ReadableNode): string {
  const region = node.where.region ?? 'unknown';
  const path = node.where.group_path ?? [];
  return `${region}/${path.join('/')}`;
}

/**
 * Compute position hint for stable EID disambiguation.
 * Combines multiple signals for better uniqueness.
 *
 * Uses:
 * - Screen zone (above/below fold)
 * - Nearest heading context (if available)
 * - Bounding box quadrant
 *
 * @param node - Node to compute hint for
 * @returns Position hint string
 */
export function computePositionHint(node: ReadableNode): string {
  const parts: string[] = [];

  // Screen zone
  const zone = node.layout.screen_zone ?? 'unknown';
  parts.push(zone);

  // Nearest heading from group_path (if available)
  const groupPath = node.where.group_path ?? [];
  if (groupPath.length > 0) {
    // Use last group as heading context
    parts.push(groupPath[groupPath.length - 1]);
  }

  // Bounding box quadrant (coarse position)
  const bbox = node.layout.bbox;
  if (bbox) {
    const quadrant = computeQuadrant(bbox);
    parts.push(quadrant);
  }

  return parts.join(':');
}

/**
 * Compute quadrant from bounding box.
 * Divides viewport into 4 quadrants: TL, TR, BL, BR
 *
 * @param bbox - Bounding box {x, y, w, h}
 * @returns Quadrant string
 */
function computeQuadrant(bbox: { x: number; y: number; w: number; h: number }): string {
  // Use 500px as rough midpoint (works for most viewports)
  const horizontal = bbox.x < 500 ? 'L' : 'R';
  const vertical = bbox.y < 400 ? 'T' : 'B';

  return `${vertical}${horizontal}`;
}

/**
 * Compute nth-of-type heuristic for a node.
 * @deprecated Use computePositionHint instead for EID generation.
 *
 * @param node - Node to compute nth for
 * @returns Nth-of-type number (0 if unknown)
 */
export function computeNthOfType(node: ReadableNode): number {
  const zone = node.layout.screen_zone ?? '';
  if (zone.includes('above-fold')) return 1;
  if (zone.includes('below-fold')) return 2;
  return 0;
}

/**
 * Hash string components to generate EID.
 * Uses SHA-256 and returns first 12 hex chars.
 *
 * @param components - String components to hash
 * @returns 12-character hex hash
 */
export function hashComponents(components: string[]): string {
  const combined = components.join('::');
  const hash = createHash('sha256').update(combined).digest('hex');
  return hash.substring(0, 12);
}

// ============================================================================
// EID Collision Handling
// ============================================================================

/**
 * Resolve EID collisions by appending suffix.
 * If EID already exists in map, append "-2", "-3", etc.
 *
 * @param baseEid - Base EID before collision resolution
 * @param existingEids - Set of already-used EIDs
 * @returns Unique EID
 */
export function resolveEidCollision(baseEid: string, existingEids: Set<string>): string {
  if (!existingEids.has(baseEid)) {
    return baseEid;
  }

  let suffix = 2;
  while (existingEids.has(`${baseEid}-${suffix}`)) {
    suffix++;
  }

  return `${baseEid}-${suffix}`;
}

// ============================================================================
// Element Identity Registry
// ============================================================================

/**
 * Build element identity from node.
 *
 * @param node - Node to build identity for
 * @param eid - Computed EID
 * @param layer - Active layer
 * @param step - Current step counter
 * @returns Element identity object
 */
export function buildElementIdentity(
  node: ReadableNode,
  eid: string,
  layer: string,
  step: number
): ElementIdentity {
  return {
    eid,
    role: node.attributes?.role ?? node.kind,
    name: node.label,
    href: node.attributes?.href,
    landmarkPath: (node.where.group_path ?? []).slice(),
    nthOfType: computeNthOfType(node),
    layer,
    lastSeenStep: step,
  };
}
