/**
 * list_tabs Tool Tests
 *
 * Verifies that listTabs returns correct XML for open tabs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SessionManager } from '../../../src/browser/session-manager.js';

// Mock session manager
const mockListPages = vi.fn();
const mockSessionManager = {
  listPages: mockListPages,
} as unknown as SessionManager;

vi.mock('../../../src/browser/session-manager.js', () => ({}));

// Mock form dependency tracker (required by browser-tools module)
vi.mock('../../../src/form/index.js', () => ({
  getDependencyTracker: vi.fn(() => ({
    clearPage: vi.fn(),
    clearAll: vi.fn(),
  })),
}));

// Mock snapshot modules that browser-tools imports
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

import { initializeTools, listTabs } from '../../../src/tools/browser-tools.js';

describe('listTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty tabs list when no pages are registered', () => {
    mockListPages.mockReturnValue([]);
    initializeTools(mockSessionManager);

    const result = listTabs();

    expect(result).toContain('type="list_tabs"');
    expect(result).toContain('status="success"');
    expect(result).toContain('count="0"');
    expect(result).not.toContain('<tab ');
  });

  it('should return correct metadata for multiple pages', () => {
    mockListPages.mockReturnValue([
      {
        page_id: 'page-abc',
        url: 'https://example.com',
        title: 'Example',
        page: {},
        cdp: {},
        created_at: new Date(),
      },
      {
        page_id: 'page-def',
        url: 'https://other.com',
        title: 'Other Site',
        page: {},
        cdp: {},
        created_at: new Date(),
      },
    ]);
    initializeTools(mockSessionManager);

    const result = listTabs();

    expect(result).toContain('count="2"');
    expect(result).toContain('page_id="page-abc"');
    expect(result).toContain('url="https://example.com"');
    expect(result).toContain('title="Example"');
    expect(result).toContain('page_id="page-def"');
    expect(result).toContain('url="https://other.com"');
    expect(result).toContain('title="Other Site"');
  });

  it('should handle pages with missing url and title', () => {
    mockListPages.mockReturnValue([
      {
        page_id: 'page-new',
        page: {},
        cdp: {},
        created_at: new Date(),
      },
    ]);
    initializeTools(mockSessionManager);

    const result = listTabs();

    expect(result).toContain('count="1"');
    expect(result).toContain('page_id="page-new"');
    expect(result).toContain('url=""');
    expect(result).toContain('title=""');
  });

  it('should escape XML special characters in tab metadata', () => {
    mockListPages.mockReturnValue([
      {
        page_id: 'page-special',
        url: 'https://example.com?foo=1&bar=2',
        title: 'Test <Page> & "Stuff"',
        page: {},
        cdp: {},
        created_at: new Date(),
      },
    ]);
    initializeTools(mockSessionManager);

    const result = listTabs();

    expect(result).toContain('&amp;');
    expect(result).toContain('&lt;Page&gt;');
    expect(result).toContain('&quot;Stuff&quot;');
  });
});
