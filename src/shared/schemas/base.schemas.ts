/**
 * Shared Zod schemas for base types
 *
 * These schemas provide runtime validation and type inference for shared types
 * used across all domains.
 */

import { z } from 'zod';
import type { DomTreeNode as DomTreeNodeType } from '../types/index.js';

// ===== BBOX =====

export const BBoxSchema = z.object({
  x: z.number().describe('X coordinate'),
  y: z.number().describe('Y coordinate'),
  w: z.number().describe('Width'),
  h: z.number().describe('Height'),
});

export type BBox = z.infer<typeof BBoxSchema>;

// ===== SELECTORS =====

export const SelectorsSchema = z.object({
  ax: z.string().optional().describe('Accessibility selector'),
  css: z.string().optional().describe('CSS selector'),
  xpath: z.string().optional().describe('XPath selector'),
});

export type Selectors = z.infer<typeof SelectorsSchema>;

// ===== ELEMENT REF =====

export const ElementRefSchema = z.object({
  frameId: z.string().describe('Frame identifier'),
  nodeId: z.number().optional().describe('CDP node ID'),
  selectors: SelectorsSchema.describe('Available selectors for the element'),
  bbox: BBoxSchema.optional().describe('Bounding box'),
  role: z.string().optional().describe('ARIA role'),
  label: z.string().optional().describe('ARIA label'),
  name: z.string().optional().describe('Name attribute'),
});

export type ElementRef = z.infer<typeof ElementRefSchema>;

// ===== LOCATOR HINT =====

// Single flattened schema with all locator fields as optional
// This is simpler for LLMs and compatible with MCP SDK (no union types)
//
// USAGE GUIDELINES:
// 1. ALWAYS prefer concrete selectors (css, xpath, ax) over semantic hints (role, label, name)
// 2. Semantic hints alone (role, label, name) may fail - combine with css/xpath for reliability
// 3. Use nearText only in combination with a concrete selector (css/xpath/ax)
// 4. Avoid attribute selectors for implicit HTML attributes (e.g., button[type='submit'])
//    - Use simple selectors instead (e.g., 'button' rather than 'button[type="submit"]')
//
// EXAMPLES:
// ✅ Good: {css: "a", nearText: "Learn more"} - concrete selector + proximity
// ✅ Good: {css: "button"} - simple, reliable
// ✅ Good: {xpath: "//input[@name='email']"}
// ❌ Bad: {role: "link", nearText: "Learn more"} - semantic hints alone
// ❌ Bad: {css: "button[type='submit']"} - implicit attribute selector
export const LocatorHintSchema = z.object({
  // Semantic fields (use with concrete selectors)
  role: z.string().optional().describe('ARIA role - prefer combining with css/xpath selector'),
  label: z.string().optional().describe('ARIA label - prefer combining with css/xpath selector'),
  name: z.string().optional().describe('Name attribute - prefer combining with css/xpath selector'),
  nearText: z
    .string()
    .optional()
    .describe('Text content nearby - must combine with css/xpath/ax selector'),
  // Selector fields (preferred - most reliable)
  css: z
    .string()
    .optional()
    .describe(
      'CSS selector - most reliable option. Avoid implicit attribute selectors like [type="submit"] for elements that don\'t explicitly have that attribute'
    ),
  xpath: z.string().optional().describe('XPath selector - reliable option'),
  ax: z.string().optional().describe('Accessibility selector'),
  // BBox field
  bbox: BBoxSchema.optional().describe('Bounding box'),
});

export type LocatorHint = z.infer<typeof LocatorHintSchema>;

// Flattened schema that can accept either ElementRef or LocatorHint
// All fields are optional - provide either ElementRef fields OR LocatorHint fields
export const ElementRefOrLocatorHintSchema = z.object({
  // ElementRef fields
  frameId: z.string().optional().describe('Frame identifier'),
  nodeId: z.number().optional().describe('CDP node ID'),
  selectors: z
    .object({
      ax: z.string().optional().describe('Accessibility selector'),
      css: z.string().optional().describe('CSS selector'),
      xpath: z.string().optional().describe('XPath selector'),
    })
    .optional()
    .describe('Available selectors for the element'),
  bbox: BBoxSchema.optional().describe('Bounding box'),
  // LocatorHint fields (semantic)
  role: z.string().optional().describe('ARIA role'),
  label: z.string().optional().describe('ARIA label'),
  name: z.string().optional().describe('Name attribute'),
  nearText: z.string().optional().describe('Text content nearby'),
  // LocatorHint fields (selectors) - duplicated with selectors.css/xpath/ax above
  css: z.string().optional().describe('CSS selector'),
  xpath: z.string().optional().describe('XPath selector'),
  ax: z.string().optional().describe('Accessibility selector'),
});

export type ElementRefOrLocatorHint = z.infer<typeof ElementRefOrLocatorHintSchema>;

// ===== DOM TREE NODE =====

export const DomTreeNodeSchema: z.ZodType<DomTreeNodeType> = z.lazy(() =>
  z.object({
    id: z.string().describe('Unique identifier'),
    nodeId: z.number().optional().describe('CDP node ID'),
    tag: z.string().describe('HTML tag name'),
    attrs: z.array(z.string()).optional().describe('Attributes as [key, value, key, value, ...]'),
    text: z.string().optional().describe('Text content for text nodes'),
    children: z.array(DomTreeNodeSchema).optional().describe('Child nodes'),
  })
);

export type DomTreeNode = z.infer<typeof DomTreeNodeSchema>;

// ===== ACCESSIBILITY TREE NODE =====

export const AxTreeNodeSchema = z.object({
  nodeId: z.string().optional().describe('AX node ID'),
  role: z.string().optional().describe('ARIA role'),
  name: z.string().optional().describe('Accessible name'),
  value: z
    .object({
      type: z.string(),
      value: z.string(),
    })
    .optional()
    .describe('Value object'),
  properties: z
    .array(
      z.object({
        name: z.string(),
        value: z.unknown(),
      })
    )
    .optional()
    .describe('Additional properties'),
  childIds: z.array(z.string()).optional().describe('Child node IDs'),
  backendDOMNodeId: z.number().optional().describe('Backend DOM node ID'),
});

export type AxTreeNode = z.infer<typeof AxTreeNodeSchema>;

// ===== NETWORK EVENT =====

export const NetworkEventSchema = z.object({
  requestId: z.string().describe('Network request ID'),
  url: z.string().describe('Request URL'),
  method: z.string().describe('HTTP method'),
  status: z.number().optional().describe('Response status code'),
  headers: z.record(z.string()).optional().describe('Request/response headers'),
});

export type NetworkEvent = z.infer<typeof NetworkEventSchema>;

// ===== BROWSER COOKIE =====

export const BrowserCookieSchema = z.object({
  name: z.string().describe('Cookie name'),
  value: z.string().describe('Cookie value'),
  url: z.string().optional().describe('Cookie URL'),
  domain: z.string().optional().describe('Cookie domain'),
  path: z.string().optional().describe('Cookie path'),
  secure: z.boolean().optional().describe('Secure flag'),
  httpOnly: z.boolean().optional().describe('HttpOnly flag'),
  sameSite: z.enum(['Strict', 'Lax', 'None']).optional().describe('SameSite attribute'),
  expires: z.number().optional().describe('Expiration timestamp'),
});

export type BrowserCookie = z.infer<typeof BrowserCookieSchema>;

// ===== SESSION STATE =====

export const SessionStateSchema = z.object({
  url: z.string().describe('Current URL'),
  title: z.string().optional().describe('Page title'),
  cookies: z.array(BrowserCookieSchema).describe('Session cookies'),
  localStorage: z.record(z.string()).describe('LocalStorage contents'),
  timestamp: z.number().describe('State snapshot timestamp'),
});

export type SessionState = z.infer<typeof SessionStateSchema>;

// ===== NAVIGATION WAIT CONDITION =====

export const NavWaitConditionSchema = z.enum([
  'network-idle',
  'selector',
  'ax-role',
  'route-change',
]);

export type NavWaitCondition = z.infer<typeof NavWaitConditionSchema>;

// ===== ERROR RESPONSE =====

export const ErrorSeveritySchema = z.enum(['debug', 'info', 'warning', 'error', 'critical']);

export type ErrorSeverity = z.infer<typeof ErrorSeveritySchema>;

export const ErrorCodeSchema = z.string();

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const StructuredErrorSchema = z.object({
  error: z.string().describe('Error message'),
  code: ErrorCodeSchema.describe('Error code'),
  severity: ErrorSeveritySchema.describe('Error severity level'),
  details: z.record(z.unknown()).optional().describe('Additional error details'),
  stack: z.string().optional().describe('Stack trace (only in development)'),
});

export type StructuredError = z.infer<typeof StructuredErrorSchema>;
