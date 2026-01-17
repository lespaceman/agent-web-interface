/**
 * Form Understanding Module
 *
 * Provides semantic understanding of form-like interactions,
 * regardless of HTML implementation.
 *
 * Key features:
 * - FormRegion detection (explicit and implicit forms)
 * - FormField extraction with purpose inference
 * - Runtime value reading via CDP
 * - Observed dependency tracking
 * - Action result hints
 *
 * @module form
 */

// Types
export type {
  FormRegion,
  FormDetection,
  FormSignal,
  FormIntent,
  FormPattern,
  FormState,
  FormField,
  FieldPurpose,
  FieldSemanticType,
  FieldConstraints,
  FieldOption,
  FieldState,
  FieldDependency,
  DependencyType,
  DependencyDetectionMethod,
  DependencyCondition,
  FormAction,
  ObservedEffect,
  FormUnderstandingResponse,
  FieldContextResponse,
  ActionResultHints,
  FormCandidate,
  FormDetectionConfig,
} from './types.js';

export { DEFAULT_FORM_DETECTION_CONFIG } from './types.js';

// Form detection
export { FormDetector, detectForms } from './form-detector.js';

// Field extraction
export { extractFields, extractFieldByEid } from './field-extractor.js';

// Form state computation
export { computeFormState } from './form-state.js';

// Runtime value reading
export {
  readRuntimeValues,
  type RuntimeValueResult,
  type FieldValueRequest,
  type RuntimeValueReaderOptions,
} from './runtime-value-reader.js';

// Dependency tracking
export {
  DependencyTracker,
  getDependencyTracker,
  createObservedEffect,
  type DependencyTrackerConfig,
} from './dependency-tracker.js';
