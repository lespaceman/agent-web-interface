/**
 * Input Clustering
 *
 * Groups input nodes by proximity and structural context
 * to identify implicit form boundaries.
 *
 * @module form/input-clustering
 */

import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type { FormDetectionConfig } from './types.js';

/**
 * Cluster input nodes by proximity and structural context.
 */
export function clusterInputs(
  inputs: ReadableNode[],
  _snapshot: BaseSnapshot,
  config: FormDetectionConfig
): ReadableNode[][] {
  if (inputs.length === 0) return [];
  if (inputs.length === 1) return [[inputs[0]]];

  // Group by region first
  const byRegion = new Map<string, ReadableNode[]>();
  for (const input of inputs) {
    const key = input.where.region ?? 'unknown';
    const group = byRegion.get(key) ?? [];
    group.push(input);
    byRegion.set(key, group);
  }

  const clusters: ReadableNode[][] = [];

  // Within each region, cluster by proximity
  for (const regionInputs of byRegion.values()) {
    if (regionInputs.length === 1) {
      clusters.push(regionInputs);
      continue;
    }

    // Simple clustering by vertical proximity
    const sorted = [...regionInputs].sort((a, b) => {
      const yA = a.layout?.bbox?.y ?? 0;
      const yB = b.layout?.bbox?.y ?? 0;
      return yA - yB;
    });

    let currentCluster: ReadableNode[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];

      const prevY = (prev.layout?.bbox?.y ?? 0) + (prev.layout?.bbox?.h ?? 0);
      const currY = curr.layout?.bbox?.y ?? 0;
      const distance = currY - prevY;

      if (distance <= config.cluster_distance) {
        currentCluster.push(curr);
      } else {
        if (currentCluster.length > 0) {
          clusters.push(currentCluster);
        }
        currentCluster = [curr];
      }
    }

    if (currentCluster.length > 0) {
      clusters.push(currentCluster);
    }
  }

  return clusters;
}
