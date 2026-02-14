/**
 * Types for network request watching.
 *
 * Captures HTTP request/response pairs made by the browser page,
 * filtered by resource type. Used by the watch_network / get_network_requests tools.
 */

/**
 * A captured network request/response entry.
 */
export interface CapturedNetworkEntry {
  /** Sequence number (monotonically increasing per watcher session) */
  seq: number;
  /** HTTP method (GET, POST, PUT, DELETE, etc.) */
  method: string;
  /** Full request URL */
  url: string;
  /** Puppeteer resource type (xhr, fetch, document, etc.) */
  resourceType: string;
  /** Epoch ms when the request was initiated */
  timestamp: number;

  // Response (populated on requestfinished)
  /** HTTP status code */
  status?: number;
  /** HTTP status text */
  statusText?: string;
  /** Duration from request start to response complete (ms) */
  durationMs?: number;

  // Headers (sensitive values masked)
  /** Request headers with sensitive values masked */
  requestHeaders?: Record<string, string>;
  /** Response headers with sensitive values masked */
  responseHeaders?: Record<string, string>;

  // Bodies (truncated at MAX_BODY_SIZE)
  /** Request body (from postData) */
  requestBody?: string;
  /** Response body text */
  responseBody?: string;
  /** Whether the response body was truncated */
  bodyTruncated?: boolean;

  // Failure (populated on requestfailed)
  /** Failure reason if the request failed */
  failureReason?: string;
  /** Current state of the entry */
  state: 'pending' | 'completed' | 'failed';
}

/**
 * Resource types that can be filtered on.
 */
export type NetworkResourceType =
  | 'xhr'
  | 'fetch'
  | 'document'
  | 'stylesheet'
  | 'image'
  | 'media'
  | 'font'
  | 'script'
  | 'websocket'
  | 'manifest'
  | 'other';

/**
 * All valid resource type values.
 */
export const ALL_RESOURCE_TYPES: NetworkResourceType[] = [
  'xhr',
  'fetch',
  'document',
  'stylesheet',
  'image',
  'media',
  'font',
  'script',
  'websocket',
  'manifest',
  'other',
];

/**
 * Default resource types to watch when none specified.
 */
export const DEFAULT_RESOURCE_TYPES: NetworkResourceType[] = ['xhr'];

/** Maximum response/request body size before truncation (10KB) */
export const MAX_BODY_SIZE = 10 * 1024;

/** Headers whose values should be masked */
export const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
]);

/** Content types considered text (body will be captured) */
const TEXT_CONTENT_TYPE_PATTERNS = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-www-form-urlencoded',
  'application/graphql',
  'application/ld+json',
  'application/hal+json',
  'application/vnd.api+json',
  '+json',
  '+xml',
];

/**
 * Check if a content-type header indicates text content.
 */
export function isTextContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return TEXT_CONTENT_TYPE_PATTERNS.some((pattern) => lower.includes(pattern));
}
