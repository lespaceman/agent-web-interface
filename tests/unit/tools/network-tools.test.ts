/**
 * Network Tools Unit Tests
 *
 * Tests for listNetworkCalls and searchNetworkCalls handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '../../../src/tools/tool-context.types.js';

// Mock recorder
const mockGetEntries = vi.fn();
const mockSearch = vi.fn();
const mockGetStats = vi.fn();
const mockRecorder = {
  getEntries: mockGetEntries,
  search: mockSearch,
  getStats: mockGetStats,
};

vi.mock('../../../src/browser/page-network-recorder.js', () => ({
  getOrCreateRecorder: vi.fn(() => mockRecorder),
}));

import { listNetworkCalls, searchNetworkCalls } from '../../../src/tools/network-tools.js';

// Create a minimal mock ToolContext
const mockPage = {};
const mockCtx = {
  resolveExistingPage: vi.fn().mockReturnValue({
    page_id: 'page-123',
    page: mockPage,
  }),
} as unknown as ToolContext;

describe('listNetworkCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStats.mockReturnValue({ total: 2, pending: 0, failed: 0, by_resource_type: {} });
    (mockCtx.resolveExistingPage as ReturnType<typeof vi.fn>).mockReturnValue({
      page_id: 'page-123',
      page: mockPage,
    });
  });

  it('should return XML with entries', () => {
    mockGetEntries.mockReturnValue({
      total: 2,
      entries: [
        {
          id: 1,
          method: 'GET',
          url: 'https://api.example.com/users',
          resource_type: 'fetch',
          status: 200,
          duration_ms: 123,
          failed: false,
          failure_text: null,
          mime_type: 'application/json',
          request_headers: {},
          response_headers: {},
          post_data: null,
        },
        {
          id: 2,
          method: 'POST',
          url: 'https://api.example.com/login',
          resource_type: 'xhr',
          status: 401,
          duration_ms: 89,
          failed: false,
          failure_text: null,
          mime_type: null,
          request_headers: {},
          response_headers: {},
          post_data: null,
        },
      ],
    });

    const result = listNetworkCalls({}, mockCtx);

    expect(result).toContain('<network_calls');
    expect(result).toContain('page_id="page-123"');
    expect(result).toContain('total="2"');
    expect(result).toContain('method="GET"');
    expect(result).toContain('url="https://api.example.com/users"');
    expect(result).toContain('status="200"');
    expect(result).toContain('status="401"');
    expect(result).toContain('</network_calls>');
  });

  it('should pass filters to getEntries', () => {
    mockGetEntries.mockReturnValue({ total: 0, entries: [] });

    listNetworkCalls(
      {
        method: 'POST',
        resource_type: 'fetch',
        status_min: 400,
        status_max: 599,
        failed_only: true,
        url_pattern: '/api',
        offset: 5,
        limit: 10,
      },
      mockCtx
    );

    expect(mockGetEntries).toHaveBeenCalledWith(
      {
        method: 'POST',
        resource_type: 'fetch',
        status_min: 400,
        status_max: 599,
        failed_only: true,
        url_pattern: '/api',
      },
      5,
      10
    );
  });

  it('should handle empty results', () => {
    mockGetEntries.mockReturnValue({ total: 0, entries: [] });
    mockGetStats.mockReturnValue({ total: 0, pending: 0, failed: 0, by_resource_type: {} });

    const result = listNetworkCalls({}, mockCtx);

    expect(result).toContain('total="0"');
    expect(result).toContain('shown="0"');
  });

  it('should show failed entry attributes', () => {
    mockGetEntries.mockReturnValue({
      total: 1,
      entries: [
        {
          id: 1,
          method: 'GET',
          url: 'https://example.com/broken',
          resource_type: 'fetch',
          status: null,
          duration_ms: 50,
          failed: true,
          failure_text: 'net::ERR_FAILED',
          mime_type: null,
          request_headers: {},
          response_headers: null,
          post_data: null,
        },
      ],
    });

    const result = listNetworkCalls({}, mockCtx);

    expect(result).toContain('failed="true"');
    expect(result).toContain('error="net::ERR_FAILED"');
  });
});

describe('searchNetworkCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockCtx.resolveExistingPage as ReturnType<typeof vi.fn>).mockReturnValue({
      page_id: 'page-123',
      page: mockPage,
    });
  });

  it('should pass url_pattern and url_regex to search', () => {
    mockSearch.mockReturnValue({ total: 0, entries: [] });

    searchNetworkCalls({ url_pattern: '/api/v1', url_regex: true }, mockCtx);

    expect(mockSearch).toHaveBeenCalledWith('/api/v1', true, expect.any(Object), 25);
  });

  it('should include headers when requested', () => {
    mockSearch.mockReturnValue({
      total: 1,
      entries: [
        {
          id: 1,
          method: 'GET',
          url: 'https://api.example.com/data',
          resource_type: 'fetch',
          status: 200,
          duration_ms: 100,
          failed: false,
          failure_text: null,
          mime_type: 'application/json',
          request_headers: { 'content-type': 'application/json' },
          response_headers: { 'content-type': 'application/json' },
          post_data: null,
        },
      ],
    });

    const result = searchNetworkCalls(
      {
        url_pattern: '/data',
        include_headers: true,
      },
      mockCtx
    );

    expect(result).toContain('<request_headers>');
    expect(result).toContain('<response_headers>');
    expect(result).toContain('content-type');
  });

  it('should include body when requested', () => {
    mockSearch.mockReturnValue({
      total: 1,
      entries: [
        {
          id: 1,
          method: 'POST',
          url: 'https://api.example.com/submit',
          resource_type: 'fetch',
          status: 200,
          duration_ms: 50,
          failed: false,
          failure_text: null,
          mime_type: null,
          request_headers: {},
          response_headers: {},
          post_data: '{"key":"value"}',
        },
      ],
    });

    const result = searchNetworkCalls(
      {
        url_pattern: '/submit',
        include_body: true,
      },
      mockCtx
    );

    expect(result).toContain('<body>');
    expect(result).toContain('{&quot;key&quot;:&quot;value&quot;}');
  });

  it('should pass limit to recorder search', () => {
    mockSearch.mockReturnValue({
      total: 50,
      entries: Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        method: 'GET',
        url: `https://example.com/${i}`,
        resource_type: 'fetch',
        status: 200,
        duration_ms: 10,
        failed: false,
        failure_text: null,
        mime_type: null,
        request_headers: {},
        response_headers: null,
        post_data: null,
      })),
    });

    const result = searchNetworkCalls({ url_pattern: 'example', limit: 5 }, mockCtx);

    expect(mockSearch).toHaveBeenCalledWith('example', false, expect.any(Object), 5);
    expect(result).toContain('total="50"');
    expect(result).toContain('shown="5"');
  });
});
