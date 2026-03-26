/**
 * Network Tools
 *
 * MCP tool handlers for inspecting network activity on a page.
 * Provides list and search over recorded HTTP requests/responses.
 */

import { getSessionManager, resolveExistingPage } from './tool-context.js';
import {
  getOrCreateRecorder,
  type NetworkEntry,
  type NetworkFilter,
} from '../browser/page-network-recorder.js';
import { escapeXml } from '../lib/text-utils.js';
import {
  ListNetworkCallsInputSchema,
  SearchNetworkCallsInputSchema,
  type ListNetworkCallsInput,
  type SearchNetworkCallsInput,
} from './tool-schemas.js';

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(ms: number | null): string {
  if (ms === null) return 'pending';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function entryToXml(entry: NetworkEntry, includeHeaders: boolean, includeBody: boolean): string {
  const attrs: string[] = [
    `id="${entry.id}"`,
    `method="${escapeXml(entry.method)}"`,
    `url="${escapeXml(entry.url)}"`,
    `type="${escapeXml(entry.resource_type)}"`,
  ];

  if (entry.status !== null) {
    attrs.push(`status="${entry.status}"`);
  }

  attrs.push(`duration="${formatDuration(entry.duration_ms)}"`);

  if (entry.failed) {
    attrs.push('failed="true"');
    if (entry.failure_text) {
      attrs.push(`error="${escapeXml(entry.failure_text)}"`);
    }
  }

  if (entry.mime_type) {
    attrs.push(`mime="${escapeXml(entry.mime_type)}"`);
  }

  const needsChildren = includeHeaders || (includeBody && entry.post_data);

  if (!needsChildren) {
    return `  <call ${attrs.join(' ')}/>`;
  }

  const lines: string[] = [];
  lines.push(`  <call ${attrs.join(' ')}>`);

  if (includeHeaders) {
    if (Object.keys(entry.request_headers).length > 0) {
      lines.push('    <request_headers>');
      for (const [k, v] of Object.entries(entry.request_headers)) {
        lines.push(`      <h name="${escapeXml(k)}">${escapeXml(v)}</h>`);
      }
      lines.push('    </request_headers>');
    }
    if (entry.response_headers && Object.keys(entry.response_headers).length > 0) {
      lines.push('    <response_headers>');
      for (const [k, v] of Object.entries(entry.response_headers)) {
        lines.push(`      <h name="${escapeXml(k)}">${escapeXml(v)}</h>`);
      }
      lines.push('    </response_headers>');
    }
  }

  if (includeBody && entry.post_data) {
    lines.push(`    <body>${escapeXml(entry.post_data)}</body>`);
  }

  lines.push('  </call>');
  return lines.join('\n');
}

// ============================================================================
// Tool Handlers
// ============================================================================

export function listNetworkCalls(rawInput: unknown): string {
  const input: ListNetworkCallsInput = ListNetworkCallsInputSchema.parse(rawInput);
  const session = getSessionManager();
  const handle = resolveExistingPage(session, input.page_id);

  const recorder = getOrCreateRecorder(handle.page);
  const filter: NetworkFilter = {};
  if (input.resource_type) filter.resource_type = input.resource_type;
  if (input.method) filter.method = input.method;
  if (input.status_min != null) filter.status_min = input.status_min;
  if (input.status_max != null) filter.status_max = input.status_max;
  if (input.failed_only) filter.failed_only = true;
  if (input.url_pattern) filter.url_pattern = input.url_pattern;

  const result = recorder.getEntries(filter, input.offset, input.limit);
  const stats = recorder.getStats();

  const lines: string[] = [];
  lines.push(
    `<network_calls page_id="${escapeXml(handle.page_id)}" total="${result.total}" shown="${result.entries.length}" offset="${input.offset}" recorded="${stats.total}">`
  );

  for (const entry of result.entries) {
    lines.push(entryToXml(entry, false, false));
  }

  lines.push('</network_calls>');
  return lines.join('\n');
}

export function searchNetworkCalls(rawInput: unknown): string {
  const input: SearchNetworkCallsInput = SearchNetworkCallsInputSchema.parse(rawInput);
  const session = getSessionManager();
  const handle = resolveExistingPage(session, input.page_id);

  const recorder = getOrCreateRecorder(handle.page);
  const filter: NetworkFilter = {};
  if (input.resource_type) filter.resource_type = input.resource_type;
  if (input.method) filter.method = input.method;
  if (input.status_min != null) filter.status_min = input.status_min;
  if (input.status_max != null) filter.status_max = input.status_max;

  const result = recorder.search(input.url_pattern, input.url_regex, filter);
  const limited = result.entries.slice(0, input.limit);

  const lines: string[] = [];
  lines.push(
    `<network_calls page_id="${escapeXml(handle.page_id)}" total="${result.total}" shown="${limited.length}" pattern="${escapeXml(input.url_pattern)}">`
  );

  for (const entry of limited) {
    lines.push(entryToXml(entry, input.include_headers, input.include_body));
  }

  lines.push('</network_calls>');
  return lines.join('\n');
}
