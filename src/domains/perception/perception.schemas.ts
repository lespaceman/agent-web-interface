/**
 * Perception Domain Zod Schemas
 *
 * Schemas for DOM, Accessibility, Layout, Vision, Network, and Content extraction tools
 */

import { z } from 'zod';
import {
  BBoxSchema,
  ElementRefSchema,
  LocatorHintSchema,
  DomTreeNodeSchema,
  AxTreeNodeSchema,
  NetworkEventSchema,
} from '../../shared/schemas/index.js';

// ===== DOM TREE =====

export const DomGetTreeInputSchema = z.object({
  frameId: z.string().optional().default('main').describe('Frame identifier'),
  depth: z.number().optional().default(-1).describe('Tree depth (-1 for full tree)'),
  visibleOnly: z.boolean().optional().default(false).describe('Only include visible elements'),
});

export const DomGetTreeOutputSchema = z.object({
  nodes: z.array(DomTreeNodeSchema).describe('DOM tree nodes'),
});

// ===== ACCESSIBILITY TREE =====

export const AxGetTreeInputSchema = z.object({
  frameId: z.string().optional().default('main').describe('Frame identifier'),
});

export const AxGetTreeOutputSchema = z.object({
  nodes: z.array(AxTreeNodeSchema).describe('Accessibility tree nodes'),
});

// ===== LAYOUT =====

export const LayoutGetBoxModelInputSchema = z.object({
  target: z.union([ElementRefSchema, LocatorHintSchema]).describe('Target element'),
});

export const LayoutGetBoxModelOutputSchema = z.object({
  quad: z.array(z.number()).describe('Element quad points'),
  bbox: BBoxSchema.describe('Bounding box'),
});

export const LayoutIsVisibleInputSchema = z.object({
  target: z.union([ElementRefSchema, LocatorHintSchema]).describe('Target element'),
});

export const LayoutIsVisibleOutputSchema = z.object({
  visible: z.boolean().describe('Whether element is visible'),
});

// ===== UI DISCOVERY =====

export const UiDiscoverInputSchema = z.object({
  scope: LocatorHintSchema.optional().describe('Scope to limit discovery'),
});

export const UiDiscoverOutputSchema = z.object({
  elements: z.array(ElementRefSchema).describe('Discovered interactive elements'),
});

// ===== VISION (OCR) =====

export const VisionOcrInputSchema = z.object({
  region: BBoxSchema.optional().describe('Region to perform OCR on'),
});

export const VisionOcrOutputSchema = z.object({
  text: z.string().describe('Extracted text'),
  spans: z
    .array(
      z.object({
        text: z.string().describe('Text content'),
        bbox: BBoxSchema.describe('Bounding box of text span'),
        confidence: z.number().optional().describe('OCR confidence score (0-1)'),
      }),
    )
    .describe('Text spans with locations'),
});

export const VisionFindByTextInputSchema = z.object({
  text: z.string().describe('Text to find'),
  fuzzy: z.boolean().optional().default(false).describe('Use fuzzy matching'),
  areaHint: BBoxSchema.optional().describe('Area hint to narrow search'),
});

export const VisionFindByTextOutputSchema = z.object({
  element: ElementRefSchema.nullable().describe('Found element or null'),
});

// ===== NETWORK =====

export const NetObserveInputSchema = z.object({
  patterns: z.array(z.string()).optional().describe('URL patterns to observe'),
});

export const NetObserveOutputSchema = z.object({
  events: z.any().describe('Async iterable of network events'),
});

export const NetGetResponseBodyInputSchema = z.object({
  requestId: z.string().describe('Network request ID'),
});

export const NetGetResponseBodyOutputSchema = z.object({
  body: z.string().describe('Response body'),
  base64Encoded: z.boolean().describe('Whether body is base64 encoded'),
});

// ===== CONTENT EXTRACTION =====

export const ContentGetTextInputSchema = z.object({
  selector: z.string().optional().describe('CSS selector to extract text from'),
  includeHidden: z.boolean().optional().default(false).describe('Include hidden elements'),
});

export const ContentGetTextOutputSchema = z.object({
  text: z.string().describe('Extracted text content'),
});

export const ContentGetLinksInputSchema = z.object({
  includeHidden: z.boolean().optional().default(false).describe('Include hidden links'),
});

export const ContentGetLinksOutputSchema = z.object({
  links: z
    .array(
      z.object({
        href: z.string().describe('Link URL'),
        text: z.string().describe('Link text'),
        element: ElementRefSchema.describe('Link element reference'),
      }),
    )
    .describe('Extracted links'),
});

export const ContentGetMetadataInputSchema = z.object({});

export const ContentGetMetadataOutputSchema = z.object({
  title: z.string().describe('Page title'),
  description: z.string().optional().describe('Meta description'),
  og: z
    .record(z.string())
    .optional()
    .describe('Open Graph metadata'),
  twitter: z
    .record(z.string())
    .optional()
    .describe('Twitter Card metadata'),
});
