/**
 * Network Request XML Renderer
 *
 * Renders captured network entries to XML format for LLM consumption.
 */

import type { CapturedNetworkEntry } from './network-watcher.types.js';

/**
 * Escape special XML characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render headers as XML elements.
 */
function renderHeaders(tagName: string, headers: Record<string, string> | undefined): string {
  if (!headers || Object.keys(headers).length === 0) return '';

  const headerElements = Object.entries(headers)
    .map(([name, value]) => `      <header name="${escapeXml(name)}">${escapeXml(value)}</header>`)
    .join('\n');

  return `    <${tagName}>\n${headerElements}\n    </${tagName}>`;
}

/**
 * Render a single captured network entry as XML.
 */
function renderEntry(entry: CapturedNetworkEntry): string {
  const attrs: string[] = [
    `seq="${entry.seq}"`,
    `method="${escapeXml(entry.method)}"`,
    `url="${escapeXml(entry.url)}"`,
    `resource_type="${escapeXml(entry.resourceType)}"`,
  ];

  if (entry.status !== undefined) {
    attrs.push(`status="${entry.status}"`);
  }

  if (entry.durationMs !== undefined) {
    attrs.push(`duration_ms="${entry.durationMs}"`);
  }

  attrs.push(`timestamp="${entry.timestamp}"`);
  attrs.push(`state="${entry.state}"`);

  // Collect child elements
  const children: string[] = [];

  // Request headers
  const reqHeaders = renderHeaders('request_headers', entry.requestHeaders);
  if (reqHeaders) children.push(reqHeaders);

  // Request body
  if (entry.requestBody) {
    children.push(`    <request_body>${escapeXml(entry.requestBody)}</request_body>`);
  }

  // Response headers
  const resHeaders = renderHeaders('response_headers', entry.responseHeaders);
  if (resHeaders) children.push(resHeaders);

  // Response body
  if (entry.responseBody) {
    const truncAttr = entry.bodyTruncated ? ' truncated="true"' : '';
    children.push(
      `    <response_body${truncAttr}>${escapeXml(entry.responseBody)}</response_body>`
    );
  }

  // Failure reason
  if (entry.failureReason) {
    children.push(`    <failure_reason>${escapeXml(entry.failureReason)}</failure_reason>`);
  }

  if (children.length === 0) {
    return `  <request ${attrs.join(' ')} />`;
  }

  return `  <request ${attrs.join(' ')}>\n${children.join('\n')}\n  </request>`;
}

/**
 * Render captured network entries to XML string.
 *
 * @param entries - Array of captured network entries
 * @param pageId - Page identifier for context
 * @returns XML string
 */
export function renderNetworkRequestsXml(entries: CapturedNetworkEntry[], pageId: string): string {
  if (entries.length === 0) {
    return `<network_requests count="0" page_id="${escapeXml(pageId)}" />`;
  }

  const rendered = entries.map(renderEntry).join('\n');
  return `<network_requests count="${entries.length}" page_id="${escapeXml(pageId)}">\n${rendered}\n</network_requests>`;
}
