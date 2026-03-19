/**
 * Region Mapping
 *
 * Extracts region-to-EID mappings from actionables for deduplication.
 *
 * @module state/region-mapping
 */

import type { ActionableInfo } from './types.js';
import { normalizeRegion } from './state-renderer.js';

/**
 * Extract region → ordered eid list mapping from actionables.
 */
export function extractRegionEidMapping(actionables: ActionableInfo[]): Map<string, string[]> {
  const regions = new Map<string, string[]>();

  for (const item of actionables) {
    const region = normalizeRegion(item.ctx.region);
    let eids = regions.get(region);
    if (!eids) {
      eids = [];
      regions.set(region, eids);
    }
    eids.push(item.eid);
  }

  return regions;
}
