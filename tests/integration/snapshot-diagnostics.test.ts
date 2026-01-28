/**
 * Integration test for Snapshot Diagnostics Flow
 *
 * Verifies the full diagnostic flow works end-to-end - from snapshot capture
 * failure to diagnostics appearing in the output.
 *
 * This is not a "real browser" integration test; it uses mocks to test the
 * integration between snapshot-health, snapshot-compiler, and page-health modules.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureWithStabilization } from '../../src/snapshot/snapshot-health.js';
import { MockCdpClient } from '../mocks/cdp-client.mock.js';
import { createMockPage, type MockPage } from '../mocks/puppeteer.mock.js';
import type { Page } from 'puppeteer-core';
import type { CdpClient } from '../../src/cdp/cdp-client.interface.js';

// Mock compileSnapshot to return empty snapshot for failure scenarios
vi.mock('../../src/snapshot/index.js', () => ({
  compileSnapshot: vi.fn().mockResolvedValue({
    snapshot_id: 'snap-test',
    page_id: 'page-test',
    url: 'https://example.com',
    title: '',
    nodes: [],
    meta: {
      node_count: 0,
      interactive_count: 0,
      capture_duration_ms: 100,
    },
    frames: [],
    document: { documentURL: 'https://example.com' },
  }),
}));

// Mock DOM stabilizer
vi.mock('../../src/delta/dom-stabilizer.js', () => ({
  stabilizeDom: vi.fn().mockResolvedValue({ status: 'stable', waitTimeMs: 50 }),
}));

// We do NOT mock page-health - let it run against the mock page
// This tests the real integration between checkPageHealth and the mock page

import { compileSnapshot } from '../../src/snapshot/index.js';

describe('Snapshot Diagnostics Integration', () => {
  let mockCdp: CdpClient;
  let mockPageObj: MockPage;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCdp = new MockCdpClient() as unknown as CdpClient;
  });

  it('should provide actionable diagnostics for empty snapshot with empty content', async () => {
    // Create page with empty title and content - both diagnostic indicators
    mockPageObj = createMockPage({
      url: 'https://example.com',
      title: '', // Empty title - warning indicator
      content: '', // Empty content - error indicator
    });

    const result = await captureWithStabilization(
      mockCdp,
      mockPageObj as unknown as Page,
      'page-test',
      {
        maxRetries: 1,
        retryDelayMs: 10,
        includeDiagnostics: true,
      }
    );

    // Verify we get useful diagnostics
    expect(result.health.valid).toBe(false);
    expect(result.health.reason).toBe('empty');
    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics?.pageHealth).toBeDefined();

    // Verify specific diagnostic indicators
    const pageHealth = result.diagnostics!.pageHealth;
    expect(pageHealth.isHealthy).toBe(false);
    expect(pageHealth.errors).toContain('empty_content');
    expect(pageHealth.warnings).toContain('empty_title');
  });

  it('should include page URL and title in diagnostics', async () => {
    mockPageObj = createMockPage({
      url: 'https://test-site.example.com/path',
      title: '',
      content: '', // Empty content for diagnostics
    });

    const result = await captureWithStabilization(
      mockCdp,
      mockPageObj as unknown as Page,
      'page-test',
      {
        maxRetries: 1,
        includeDiagnostics: true,
      }
    );

    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics?.pageHealth.url).toBe('https://test-site.example.com/path');
    expect(result.diagnostics?.pageHealth.title).toBe('');
    expect(result.diagnostics?.pageHealth.contentLength).toBe(0);
  });

  it('should not include diagnostics when snapshot is healthy', async () => {
    // Override the mock for this test to return a healthy snapshot
    vi.mocked(compileSnapshot).mockResolvedValueOnce({
      snapshot_id: 'snap-test',
      page_id: 'page-test',
      url: 'https://example.com',
      title: 'Test Page',
      nodes: [{ idx: 0, kind: 'button', label: 'Click me' }],
      meta: {
        node_count: 1,
        interactive_count: 1,
        capture_duration_ms: 100,
      },
      frames: [],
      document: { documentURL: 'https://example.com' },
    } as never);

    mockPageObj = createMockPage({
      url: 'https://example.com',
      title: 'Test Page',
    });

    const result = await captureWithStabilization(
      mockCdp,
      mockPageObj as unknown as Page,
      'page-test',
      {
        includeDiagnostics: true,
      }
    );

    expect(result.health.valid).toBe(true);
    expect(result.diagnostics).toBeUndefined();
  });

  it('should not include diagnostics when includeDiagnostics is false', async () => {
    mockPageObj = createMockPage({
      url: 'https://example.com',
      title: '',
      content: '', // Empty content
    });

    const result = await captureWithStabilization(
      mockCdp,
      mockPageObj as unknown as Page,
      'page-test',
      {
        maxRetries: 1,
        retryDelayMs: 10,
        includeDiagnostics: false, // Explicitly disabled
      }
    );

    expect(result.health.valid).toBe(false);
    expect(result.diagnostics).toBeUndefined();
  });

  it('should report page closed error when page is closed', async () => {
    mockPageObj = createMockPage({
      url: 'https://example.com',
      title: '',
    });
    // Set page as closed by modifying the mock's return value
    mockPageObj.isClosed.mockReturnValue(true);

    const result = await captureWithStabilization(
      mockCdp,
      mockPageObj as unknown as Page,
      'page-test',
      {
        maxRetries: 1,
        includeDiagnostics: true,
      }
    );

    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics?.pageHealth.isClosed).toBe(true);
    expect(result.diagnostics?.pageHealth.errors).toContain('page_closed');
  });

  it('should correctly track attempt count in diagnostics scenario', async () => {
    mockPageObj = createMockPage({
      url: 'https://example.com',
      title: '',
      content: '', // Empty content
    });

    const result = await captureWithStabilization(
      mockCdp,
      mockPageObj as unknown as Page,
      'page-test',
      {
        maxRetries: 3,
        retryDelayMs: 10,
        includeDiagnostics: true,
      }
    );

    // Should have attempted all retries before collecting diagnostics
    expect(result.attempts).toBe(3);
    expect(result.health.valid).toBe(false);
    expect(result.diagnostics).toBeDefined();
  });

  it('should handle content fetch error gracefully', async () => {
    mockPageObj = createMockPage({
      url: 'https://example.com',
      title: 'Some Title',
    });
    // Simulate content() throwing an error
    mockPageObj.content.mockRejectedValue(new Error('Page context destroyed'));

    const result = await captureWithStabilization(
      mockCdp,
      mockPageObj as unknown as Page,
      'page-test',
      {
        maxRetries: 1,
        includeDiagnostics: true,
      }
    );

    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics?.pageHealth.errors).toContain('content_error');
    expect(result.diagnostics?.pageHealth.contentError).toContain('Page context destroyed');
  });

  it('should report healthy page indicators even when snapshot fails', async () => {
    // Page has content but snapshot extraction failed for other reasons
    mockPageObj = createMockPage({
      url: 'https://example.com',
      title: 'Test Page With Content',
      content: '<html><body><button>Click me</button></body></html>',
    });

    const result = await captureWithStabilization(
      mockCdp,
      mockPageObj as unknown as Page,
      'page-test',
      {
        maxRetries: 1,
        includeDiagnostics: true,
      }
    );

    // Page is healthy but snapshot failed (could be AX/CDP issue)
    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics?.pageHealth.isHealthy).toBe(true);
    expect(result.diagnostics?.pageHealth.errors).toHaveLength(0);
    expect(result.diagnostics?.pageHealth.contentLength).toBeGreaterThan(0);
    expect(result.diagnostics?.pageHealth.title).toBe('Test Page With Content');
  });
});
