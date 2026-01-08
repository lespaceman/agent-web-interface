/**
 * Snapshot Extractors
 *
 * Barrel export for all extractors and resolvers.
 *
 * @module snapshot/extractors
 */

// Types
export type {
  RawDomNode,
  RawAxNode,
  AxProperty,
  AxPropertyValue,
  NodeLayoutInfo,
  RawNodeData,
  ExtractorContext,
  DomExtractionResult,
  AxExtractionResult,
  LayoutExtractionResult,
} from './types.js';

export {
  createExtractorContext,
  isValidRawDomNode,
  isValidRawAxNode,
  isValidNodeLayoutInfo,
  DOM_NODE_TYPES,
  INTERACTIVE_AX_ROLES,
  READABLE_AX_ROLES,
  STRUCTURAL_AX_ROLES,
} from './types.js';

// DOM Extractor
export { extractDom } from './dom-extractor.js';

// AX Extractor
export { extractAx, classifyAxRole, type RoleClassification } from './ax-extractor.js';

// Layout Extractor
export {
  extractLayout,
  computeScreenZone,
  computeVisibility,
} from './layout-extractor.js';

// State Extractor
export { extractState } from './state-extractor.js';

// Label Resolver
export {
  resolveLabel,
  type LabelResolution,
  type LabelSource,
} from './label-resolver.js';

// Region Resolver
export { resolveRegion } from './region-resolver.js';

// Locator Builder
export { buildLocators } from './locator-builder.js';

// Grouping Resolver
export { resolveGrouping, type GroupingInfo } from './grouping-resolver.js';

// Attribute Extractor
export {
  extractAttributes,
  sanitizeUrl,
  type AttributeExtractionOptions,
} from './attribute-extractor.js';
