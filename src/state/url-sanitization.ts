/**
 * URL Sanitization
 *
 * Strips sensitive query parameters from URLs for safe display.
 *
 * @module state/url-sanitization
 */

/**
 * URL query parameters that are safe to keep.
 * All others will be stripped.
 */
export const SAFE_QUERY_PARAMS = new Set([
  'page',
  'p',
  'sort',
  'order',
  'q',
  'query',
  'search',
  'tab',
  'view',
  'limit',
  'offset',
  'lang',
  'locale',
]);

/**
 * Sanitize URL by stripping sensitive query parameters.
 * Only keeps safe params like page, sort, q.
 */
export function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);

    // Build new search params with only safe ones
    const safeParams = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      if (SAFE_QUERY_PARAMS.has(key.toLowerCase())) {
        safeParams.set(key, value);
      }
    }

    // Reconstruct URL with sanitized params
    url.search = safeParams.toString();
    return url.toString();
  } catch {
    // If URL parsing fails, return origin only
    return rawUrl.split('?')[0];
  }
}

/**
 * Sanitize href attribute (remove tokens from URLs).
 */
export function sanitizeHref(href: string): string {
  // For relative URLs, return as-is
  if (!href.startsWith('http://') && !href.startsWith('https://')) {
    return href;
  }

  return sanitizeUrl(href);
}
