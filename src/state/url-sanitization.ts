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
 * Keep only allowlisted query parameters from a URLSearchParams instance.
 */
function filterSafeParams(searchParams: URLSearchParams): URLSearchParams {
  const safe = new URLSearchParams();
  for (const [key, value] of searchParams) {
    if (SAFE_QUERY_PARAMS.has(key.toLowerCase())) {
      safe.set(key, value);
    }
  }
  return safe;
}

/**
 * Sanitize URL by stripping sensitive query parameters.
 * Only keeps safe params like page, sort, q.
 */
export function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.search = filterSafeParams(url.searchParams).toString();
    return url.toString();
  } catch {
    // If URL parsing fails, return origin only
    return rawUrl.split('?')[0];
  }
}

/**
 * Sanitize href attribute (strip non-safe query params from any URL).
 */
export function sanitizeHref(href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return sanitizeUrl(href);
  }

  const qIndex = href.indexOf('?');
  if (qIndex === -1) {
    return href;
  }

  try {
    const dummy = new URL(href, 'http://p');
    const search = filterSafeParams(dummy.searchParams).toString();
    const base = href.substring(0, qIndex);
    const hash = dummy.hash || '';
    return search ? `${base}?${search}${hash}` : `${base}${hash}`;
  } catch {
    return href.substring(0, qIndex);
  }
}
