/**
 * list_pages live metadata refresh tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SessionManager } from '../../../src/browser/session-manager.js';

const mockSyncPages = vi.fn();
const mockSessionManager = {
  syncPages: mockSyncPages,
} as unknown as SessionManager;

vi.mock('../../../src/browser/session-manager.js', () => ({}));

vi.mock('../../../src/form/index.js', () => ({
  getDependencyTracker: vi.fn(() => ({
    clearPage: vi.fn(),
    clearAll: vi.fn(),
  })),
}));

vi.mock('../../../src/snapshot/index.js', () => {
  const SnapshotStore = class {
    store = vi.fn();
    getByPageId = vi.fn();
    removeByPageId = vi.fn();
    clear = vi.fn();
  };
  return {
    SnapshotStore,
    clickByBackendNodeId: vi.fn(),
    typeByBackendNodeId: vi.fn(),
    pressKey: vi.fn(),
    selectOption: vi.fn(),
    hoverByBackendNodeId: vi.fn(),
    scrollIntoView: vi.fn(),
    scrollPage: vi.fn(),
  };
});

vi.mock('../../../src/snapshot/snapshot-health.js', () => ({
  captureWithStabilization: vi.fn(),
  determineHealthCode: vi.fn(),
}));

vi.mock('../../../src/observation/index.js', () => ({
  observationAccumulator: {
    inject: vi.fn(),
    getAccumulatedObservations: vi.fn(),
    filterBySignificance: vi.fn(),
  },
}));

vi.mock('../../../src/tools/execute-action.js', () => ({
  executeAction: vi.fn(),
  executeActionWithRetry: vi.fn(),
  executeActionWithOutcome: vi.fn(),
  stabilizeAfterNavigation: vi.fn(),
  getStateManager: vi.fn(),
  removeStateManager: vi.fn(),
  clearAllStateManagers: vi.fn(),
}));

vi.mock('../../../src/state/element-identity.js', () => ({
  computeEid: vi.fn(),
}));

vi.mock('../../../src/state/health.types.js', () => ({
  createHealthyRuntime: vi.fn(),
  createRecoveredCdpRuntime: vi.fn(),
}));

vi.mock('../../../src/query/query-engine.js', () => ({
  QueryEngine: vi.fn(),
}));

vi.mock('../../../src/screenshot/index.js', () => ({
  captureScreenshot: vi.fn(),
  getElementBoundingBox: vi.fn(),
}));

vi.mock('../../../src/lib/temp-file.js', () => ({
  cleanupTempFiles: vi.fn().mockResolvedValue(undefined),
}));

import { initializeTools, listPages } from '../../../src/tools/browser-tools.js';

describe('listPages live metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers live page URL and title over cached metadata', async () => {
    mockSyncPages.mockResolvedValue([
      {
        page_id: 'page-live',
        url: 'https://stale.example.com',
        title: 'Stale Title',
        page: {
          url: () => 'https://live.example.com',
          title: vi.fn().mockResolvedValue('Live Title'),
        },
        cdp: {},
        created_at: new Date(),
      },
    ]);
    initializeTools(mockSessionManager);

    const result = await listPages();

    expect(result).toContain('page_id="page-live"');
    expect(result).toContain('url="https://live.example.com"');
    expect(result).toContain('title="Live Title"');
    expect(result).not.toContain('https://stale.example.com');
    expect(result).not.toContain('Stale Title');
  });
});
