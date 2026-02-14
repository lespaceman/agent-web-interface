/**
 * Tests for network request XML renderer.
 */

import { describe, it, expect } from 'vitest';
import { renderNetworkRequestsXml } from '../../../src/network/network-renderer.js';
import type { CapturedNetworkEntry } from '../../../src/network/network-watcher.types.js';

function makeEntry(overrides: Partial<CapturedNetworkEntry> = {}): CapturedNetworkEntry {
  return {
    seq: 1,
    method: 'GET',
    url: 'https://api.example.com/data',
    resourceType: 'xhr',
    timestamp: 1707900000000,
    state: 'completed',
    status: 200,
    durationMs: 100,
    ...overrides,
  };
}

describe('renderNetworkRequestsXml', () => {
  it('should render empty results as self-closing tag', () => {
    const result = renderNetworkRequestsXml([], 'page-1');
    expect(result).toBe('<network_requests count="0" page_id="page-1" />');
  });

  it('should render a single completed request', () => {
    const entries = [makeEntry()];
    const result = renderNetworkRequestsXml(entries, 'page-1');

    expect(result).toContain('<network_requests count="1" page_id="page-1">');
    expect(result).toContain('method="GET"');
    expect(result).toContain('url="https://api.example.com/data"');
    expect(result).toContain('resource_type="xhr"');
    expect(result).toContain('status="200"');
    expect(result).toContain('duration_ms="100"');
    expect(result).toContain('state="completed"');
    expect(result).toContain('</network_requests>');
  });

  it('should render request with headers', () => {
    const entries = [
      makeEntry({
        requestHeaders: { 'Content-Type': 'application/json', Authorization: '***' },
        responseHeaders: { 'Content-Type': 'application/json' },
      }),
    ];
    const result = renderNetworkRequestsXml(entries, 'p1');

    expect(result).toContain('<request_headers>');
    expect(result).toContain('<header name="Content-Type">application/json</header>');
    expect(result).toContain('<header name="Authorization">***</header>');
    expect(result).toContain('</request_headers>');
    expect(result).toContain('<response_headers>');
    expect(result).toContain('</response_headers>');
  });

  it('should render request and response bodies', () => {
    const entries = [
      makeEntry({
        requestBody: '{"key":"value"}',
        responseBody: '{"result":"ok"}',
        bodyTruncated: false,
      }),
    ];
    const result = renderNetworkRequestsXml(entries, 'p1');

    expect(result).toContain('<request_body>{&quot;key&quot;:&quot;value&quot;}</request_body>');
    expect(result).toContain('<response_body>{&quot;result&quot;:&quot;ok&quot;}</response_body>');
  });

  it('should render truncated response body with attribute', () => {
    const entries = [
      makeEntry({
        responseBody: 'truncated content...',
        bodyTruncated: true,
      }),
    ];
    const result = renderNetworkRequestsXml(entries, 'p1');

    expect(result).toContain('<response_body truncated="true">');
  });

  it('should render failed request with failure reason', () => {
    const entries = [
      makeEntry({
        state: 'failed',
        status: undefined,
        failureReason: 'net::ERR_CONNECTION_REFUSED',
      }),
    ];
    const result = renderNetworkRequestsXml(entries, 'p1');

    expect(result).toContain('state="failed"');
    expect(result).toContain('<failure_reason>net::ERR_CONNECTION_REFUSED</failure_reason>');
  });

  it('should render pending request', () => {
    const entries = [
      makeEntry({
        state: 'pending',
        status: undefined,
        durationMs: undefined,
      }),
    ];
    const result = renderNetworkRequestsXml(entries, 'p1');

    expect(result).toContain('state="pending"');
    expect(result).not.toContain('status=');
    expect(result).not.toContain('duration_ms=');
  });

  it('should render multiple requests', () => {
    const entries = [
      makeEntry({ seq: 1, url: 'https://a.com/1' }),
      makeEntry({ seq: 2, url: 'https://a.com/2', method: 'POST', status: 201 }),
      makeEntry({ seq: 3, url: 'https://a.com/3', state: 'failed', failureReason: 'timeout' }),
    ];
    const result = renderNetworkRequestsXml(entries, 'p1');

    expect(result).toContain('count="3"');
    expect(result).toContain('seq="1"');
    expect(result).toContain('seq="2"');
    expect(result).toContain('seq="3"');
  });

  it('should escape special XML characters in URLs', () => {
    const entries = [makeEntry({ url: 'https://api.com/search?q=foo&bar=baz<1>' })];
    const result = renderNetworkRequestsXml(entries, 'p1');

    expect(result).toContain('url="https://api.com/search?q=foo&amp;bar=baz&lt;1&gt;"');
  });

  it('should escape special characters in page_id', () => {
    const result = renderNetworkRequestsXml([], 'page<"1">');
    expect(result).toContain('page_id="page&lt;&quot;1&quot;&gt;"');
  });

  it('should render self-closing request tag when no children', () => {
    const entries = [
      makeEntry({
        requestHeaders: undefined,
        responseHeaders: undefined,
        requestBody: undefined,
        responseBody: undefined,
        failureReason: undefined,
      }),
    ];
    const result = renderNetworkRequestsXml(entries, 'p1');

    expect(result).toContain('/>');
    expect(result).not.toContain('</request>');
  });
});
