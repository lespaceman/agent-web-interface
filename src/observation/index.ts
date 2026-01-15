/**
 * DOM Observation module.
 *
 * Captures significant DOM mutations (toasts, dialogs, banners, overlays)
 * that appear during or between actions.
 */

// Types
export type {
  SignificanceSignals,
  ObservedContent,
  DOMObservation,
  RawMutationEntry,
  ObservationGroups,
} from './observation.types.js';

// Constants and functions
export {
  SIGNIFICANCE_WEIGHTS,
  SIGNIFICANCE_THRESHOLD,
  computeSignificance,
} from './observation.types.js';

// Accumulator
export { ObservationAccumulator, observationAccumulator } from './observation-accumulator.js';

// Browser script
export { OBSERVATION_OBSERVER_SCRIPT } from './observer-script.js';

// EID Linker
export {
  linkObservationsToSnapshot,
  type EidLinkerOptions,
  type EidLinkingResult,
} from './eid-linker.js';
