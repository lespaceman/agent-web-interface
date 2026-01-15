/**
 * TypeScript declarations for the browser-side observation accumulator.
 * Extends the Window interface with the __observationAccumulator property.
 */

import type { RawMutationEntry } from './observation.types.js';

interface ObservationAccumulatorGlobal {
  log: RawMutationEntry[];
  observer: MutationObserver;
  pageLoadTime: number;
  lastReportedIndex: number;

  getSince(timestamp: number): RawMutationEntry[];
  getSignificant(timestamp: number, threshold: number | undefined): RawMutationEntry[];
  getUnreported(): RawMutationEntry[];
  markReported(): void;
  reset(): void;
}

declare global {
  interface Window {
    __observationAccumulator?: ObservationAccumulatorGlobal;
  }
}

export {};
