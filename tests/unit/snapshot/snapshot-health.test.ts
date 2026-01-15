/**
 * Snapshot Health Tests
 *
 * TDD tests for snapshot health validation and recovery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateSnapshotHealth,
  isErrorHealth,
  captureWithStabilization,
  determineHealthCode,
} from '../../../src/snapshot/snapshot-health.js';
import type { BaseSnapshot } from '../../../src/snapshot/snapshot.types.js';
import type { CdpClient } from '../../../src/cdp/cdp-client.interface.js';
import type { Page } from 'playwright';
import { createMockPage } from '../../mocks/playwright.mock.js';

// Mock the snapshot compiler
vi.mock('../../../src/snapshot/index.js', () => ({
  compileSnapshot: vi.fn(),
}));

// Mock the dom-stabilizer
vi.mock('../../../src/delta/dom-stabilizer.js', () => ({
  stabilizeDom: vi.fn().mockResolvedValue({ status: 'stable', waitTimeMs: 50 }),
}));

import { compileSnapshot } from '../../../src/snapshot/index.js';
import { stabilizeDom } from '../../../src/delta/dom-stabilizer.js';

function createMockSnapshot(options: {
  nodeCount?: number;
  interactiveCount?: number;
  partial?: boolean;
  warnings?: string[];
}): BaseSnapshot {
  const { nodeCount = 10, interactiveCount = 5, partial = false, warnings } = options;

  return {
    snapshot_id: 'snap-test',
    page_id: 'page-test',
    url: 'https://example.com',
    title: 'Test Page',
    nodes: Array(nodeCount)
      .fill(null)
      .map((_, i) => ({
        idx: i,
        backend_node_id: 100 + i,
        kind: i < interactiveCount ? 'button' : 'text',
        label: `Element ${i}`,
        visible: true,
        layout: { x: 0, y: 0, w: 100, h: 30 },
      })),
    meta: {
      node_count: nodeCount,
      interactive_count: interactiveCount,
      capture_duration_ms: 100,
      partial,
      warnings,
    },
    frames: [],
    document: { documentURL: 'https://example.com' },
  } as unknown as BaseSnapshot;
}

function createMockCdp(): CdpClient {
  return {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    close: vi.fn(),
    isActive: vi.fn().mockReturnValue(true),
    getEnabledDomains: vi.fn().mockReturnValue(new Set()),
    getHealth: vi.fn().mockReturnValue({ active: true }),
  } as unknown as CdpClient;
}

/** Create a mock page for snapshot health tests */
function createSnapshotHealthMockPage(): Page {
  return createMockPage({
    url: 'https://example.com',
    title: 'Test Page',
  }) as unknown as Page;
}

describe('validateSnapshotHealth', () => {
  it('should return valid for healthy snapshot', () => {
    const snapshot = createMockSnapshot({ nodeCount: 10, interactiveCount: 5 });

    const health = validateSnapshotHealth(snapshot);

    expect(health.valid).toBe(true);
    expect(health.reason).toBeUndefined();
    expect(health.metrics?.node_count).toBe(10);
    expect(health.metrics?.interactive_count).toBe(5);
  });

  it('should return invalid for empty snapshot (0 nodes)', () => {
    const snapshot = createMockSnapshot({ nodeCount: 0, interactiveCount: 0 });

    const health = validateSnapshotHealth(snapshot);

    expect(health.valid).toBe(false);
    expect(health.reason).toBe('empty');
    expect(health.message).toContain('no nodes');
  });

  it('should return valid but partial for snapshot with no interactive elements', () => {
    const snapshot = createMockSnapshot({ nodeCount: 5, interactiveCount: 0 });

    const health = validateSnapshotHealth(snapshot);

    expect(health.valid).toBe(true);
    expect(health.reason).toBe('partial');
    expect(health.message).toContain('no interactive elements');
  });

  it('should return valid but partial for snapshot with partial flag', () => {
    const snapshot = createMockSnapshot({
      nodeCount: 10,
      interactiveCount: 5,
      partial: true,
      warnings: ['AX extraction failed'],
    });

    const health = validateSnapshotHealth(snapshot);

    expect(health.valid).toBe(true);
    expect(health.reason).toBe('partial');
    expect(health.message).toContain('AX extraction failed');
  });
});

describe('isErrorHealth', () => {
  it('should return true for invalid empty snapshot', () => {
    const health = { valid: false, reason: 'empty' as const };
    expect(isErrorHealth(health)).toBe(true);
  });

  it('should return true for invalid error snapshot', () => {
    const health = { valid: false, reason: 'error' as const };
    expect(isErrorHealth(health)).toBe(true);
  });

  it('should return false for valid snapshot', () => {
    const health = { valid: true };
    expect(isErrorHealth(health)).toBe(false);
  });

  it('should return false for valid partial snapshot', () => {
    const health = { valid: true, reason: 'partial' as const };
    expect(isErrorHealth(health)).toBe(false);
  });
});

describe('determineHealthCode', () => {
  it('should return HEALTHY for valid snapshot', () => {
    const result = {
      snapshot: createMockSnapshot({ nodeCount: 10 }),
      health: { valid: true },
      attempts: 1,
      stabilizationStatus: 'stable' as const,
    };

    const code = determineHealthCode(result);
    expect(code).toBe('HEALTHY');
  });

  it('should return PENDING_DOM for empty snapshot without specific warnings', () => {
    const result = {
      snapshot: createMockSnapshot({ nodeCount: 0 }),
      health: { valid: false, reason: 'empty' as const },
      attempts: 1,
      stabilizationStatus: 'stable' as const,
    };

    const code = determineHealthCode(result);
    expect(code).toBe('PENDING_DOM');
  });

  it('should return AX_EMPTY for snapshot with AX warning', () => {
    const result = {
      snapshot: createMockSnapshot({ nodeCount: 0, warnings: ['AX extraction failed'] }),
      health: { valid: false, reason: 'empty' as const },
      attempts: 1,
      stabilizationStatus: 'stable' as const,
    };

    const code = determineHealthCode(result);
    expect(code).toBe('AX_EMPTY');
  });

  it('should return DOM_EMPTY for snapshot with DOM warning', () => {
    const result = {
      snapshot: createMockSnapshot({ nodeCount: 0, warnings: ['DOM extraction failed'] }),
      health: { valid: false, reason: 'empty' as const },
      attempts: 1,
      stabilizationStatus: 'stable' as const,
    };

    const code = determineHealthCode(result);
    expect(code).toBe('DOM_EMPTY');
  });

  it('should return CDP_SESSION_DEAD for session/target errors', () => {
    const result = {
      snapshot: createMockSnapshot({ nodeCount: 0 }),
      health: { valid: false, reason: 'error' as const, message: 'CDP session is closed' },
      attempts: 1,
      stabilizationStatus: 'error' as const,
    };

    const code = determineHealthCode(result);
    expect(code).toBe('CDP_SESSION_DEAD');
  });

  it('should return UNKNOWN for unrecognized errors', () => {
    const result = {
      snapshot: createMockSnapshot({ nodeCount: 0 }),
      health: { valid: false, reason: 'error' as const, message: 'Unknown error' },
      attempts: 1,
      stabilizationStatus: 'error' as const,
    };

    const code = determineHealthCode(result);
    expect(code).toBe('UNKNOWN');
  });
});

describe('captureWithStabilization', () => {
  let mockCdp: CdpClient;
  let mockPage: Page;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCdp = createMockCdp();
    mockPage = createSnapshotHealthMockPage();
  });

  it('should return healthy snapshot on first attempt', async () => {
    const healthySnapshot = createMockSnapshot({ nodeCount: 10, interactiveCount: 5 });
    vi.mocked(compileSnapshot).mockResolvedValue(healthySnapshot);

    const result = await captureWithStabilization(mockCdp, mockPage, 'page-test');

    expect(result.snapshot).toBe(healthySnapshot);
    expect(result.health.valid).toBe(true);
    expect(result.attempts).toBe(1);
    expect(compileSnapshot).toHaveBeenCalledTimes(1);
  });

  it('should retry on empty snapshot', async () => {
    const emptySnapshot = createMockSnapshot({ nodeCount: 0, interactiveCount: 0 });
    const healthySnapshot = createMockSnapshot({ nodeCount: 10, interactiveCount: 5 });

    vi.mocked(compileSnapshot)
      .mockResolvedValueOnce(emptySnapshot)
      .mockResolvedValueOnce(healthySnapshot);

    const result = await captureWithStabilization(mockCdp, mockPage, 'page-test', {
      maxRetries: 3,
      retryDelayMs: 10, // Short delay for tests
    });

    expect(result.snapshot).toBe(healthySnapshot);
    expect(result.health.valid).toBe(true);
    expect(result.attempts).toBe(2);
    expect(compileSnapshot).toHaveBeenCalledTimes(2);
  });

  it('should return last attempt after max retries', async () => {
    const emptySnapshot = createMockSnapshot({ nodeCount: 0, interactiveCount: 0 });

    vi.mocked(compileSnapshot).mockResolvedValue(emptySnapshot);

    const result = await captureWithStabilization(mockCdp, mockPage, 'page-test', {
      maxRetries: 3,
      retryDelayMs: 10,
    });

    expect(result.snapshot).toBe(emptySnapshot);
    expect(result.health.valid).toBe(false);
    expect(result.attempts).toBe(3);
    expect(compileSnapshot).toHaveBeenCalledTimes(3);
  });

  it('should call stabilizeDom before each capture', async () => {
    const healthySnapshot = createMockSnapshot({ nodeCount: 10, interactiveCount: 5 });
    vi.mocked(compileSnapshot).mockResolvedValue(healthySnapshot);

    await captureWithStabilization(mockCdp, mockPage, 'page-test');

    expect(stabilizeDom).toHaveBeenCalledWith(mockPage, expect.any(Object));
  });

  it('should return stabilization status', async () => {
    const healthySnapshot = createMockSnapshot({ nodeCount: 10, interactiveCount: 5 });
    vi.mocked(compileSnapshot).mockResolvedValue(healthySnapshot);
    vi.mocked(stabilizeDom).mockResolvedValue({ status: 'timeout', waitTimeMs: 2000 });

    const result = await captureWithStabilization(mockCdp, mockPage, 'page-test');

    expect(result.stabilizationStatus).toBe('timeout');
  });
});
