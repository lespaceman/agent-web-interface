/**
 * Test Tool Context Helper
 *
 * Provides a mock ToolContext for use in unit tests.
 * All methods return sensible defaults or vi.fn() mocks.
 *
 * @module tests/helpers/test-tool-context
 */

import { vi } from 'vitest';
import type {
  ToolContext,
  CdpSessionResult,
  SnapshotCaptureResult,
} from '../../src/tools/tool-context.types.js';
import type { PageHandle } from '../../src/browser/page-registry.js';
import type { SessionManager } from '../../src/browser/session-manager.js';
import type { SnapshotStore } from '../../src/snapshot/snapshot-store.js';
import type { StateManager } from '../../src/state/state-manager.js';
import type { DependencyTracker } from '../../src/form/dependency-tracker.js';
import type { ObservationAccumulator } from '../../src/observation/observation-accumulator.js';
import { createHealthyRuntime } from '../../src/state/health.types.js';

/**
 * Create a mock ToolContext for testing.
 *
 * Override specific methods by passing them in the overrides parameter.
 * Unspecified methods get sensible mock defaults.
 */
export function createTestToolContext(overrides?: Partial<ToolContext>): ToolContext {
  const defaultSnapshotStore = {
    store: vi.fn(),
    get: vi.fn(),
    getByPageId: vi.fn(),
    removeByPageId: vi.fn(),
    clear: vi.fn(),
    getEntry: vi.fn(),
    findNode: vi.fn(),
    cleanupExpired: vi.fn(),
    getStats: vi.fn(),
    destroy: vi.fn(),
    stopCleanupTimer: vi.fn(),
    size: 0,
  } as unknown as SnapshotStore;

  const defaultStateManager = {
    generateResponse: vi.fn().mockReturnValue('<state />'),
    generateErrorResponse: vi.fn().mockReturnValue('<error />'),
    getElementRegistry: vi.fn().mockReturnValue({
      getByEid: vi.fn(),
      getEidBySnapshotAndBackendNodeId: vi.fn(),
      isStale: vi.fn().mockReturnValue(false),
      updateFromSnapshot: vi.fn(),
      getAllEids: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
    }),
    getPreviousSnapshot: vi.fn().mockReturnValue(null),
    getActiveLayer: vi.fn().mockReturnValue('main'),
  } as unknown as StateManager;

  const defaultDependencyTracker = {
    recordEffect: vi.fn(),
    getDependenciesFor: vi.fn().mockReturnValue([]),
    getDependentsOf: vi.fn().mockReturnValue([]),
    getAllDependencies: vi.fn().mockReturnValue(new Map()),
    clearPage: vi.fn(),
    clearAll: vi.fn(),
  } as unknown as DependencyTracker;

  const defaultObservationAccumulator = {
    inject: vi.fn().mockResolvedValue(undefined),
    ensureInjected: vi.fn().mockResolvedValue(undefined),
    getObservations: vi.fn().mockResolvedValue({ duringAction: [], sincePrevious: [] }),
    getAccumulatedObservations: vi.fn().mockResolvedValue({ duringAction: [], sincePrevious: [] }),
    reset: vi.fn().mockResolvedValue(undefined),
    hasUnreported: vi.fn().mockResolvedValue(false),
    filterBySignificance: vi.fn().mockImplementation(<T>(obs: T): T => obs),
  } as unknown as ObservationAccumulator;

  const defaultSessionManager = {
    isRunning: vi.fn().mockReturnValue(true),
    resolvePage: vi.fn(),
    resolvePageOrCreate: vi.fn(),
    touchPage: vi.fn(),
    listPages: vi.fn().mockReturnValue([]),
    syncPages: vi.fn().mockResolvedValue([]),
    closePage: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    createPage: vi.fn(),
    navigateTo: vi.fn().mockResolvedValue(undefined),
    rebindCdpSession: vi.fn(),
  } as unknown as SessionManager;

  return {
    sessionId: 'test-session',
    resolvePage: vi.fn(),
    resolvePageOrCreate: vi.fn(),
    resolveExistingPage: vi.fn(),
    touchPage: vi.fn(),
    closePage: vi.fn().mockResolvedValue(true),
    syncPages: vi.fn().mockResolvedValue([]),
    navigateTo: vi.fn().mockResolvedValue(undefined),
    getSessionManager: vi.fn().mockReturnValue(defaultSessionManager),
    getSnapshotStore: vi.fn().mockReturnValue(defaultSnapshotStore),
    getStateManager: vi.fn().mockReturnValue(defaultStateManager),
    removeStateManager: vi.fn(),
    clearAllStateManagers: vi.fn(),
    getDependencyTracker: vi.fn().mockReturnValue(defaultDependencyTracker),
    getObservationAccumulator: vi.fn().mockReturnValue(defaultObservationAccumulator),
    ensureCdpSession: vi.fn().mockResolvedValue({
      handle: {} as PageHandle,
      recovered: false,
      runtime_health: createHealthyRuntime(),
    } satisfies CdpSessionResult),
    captureSnapshotWithRecovery: vi.fn().mockResolvedValue({
      snapshot: {
        snapshot_id: 'snap-test',
        url: '',
        title: '',
        captured_at: '',
        viewport: { width: 1280, height: 720 },
        nodes: [],
        meta: { node_count: 0, interactive_count: 0 },
      },
      handle: {} as PageHandle,
      runtime_health: createHealthyRuntime(),
    } satisfies SnapshotCaptureResult),
    ensureBrowser: vi.fn().mockResolvedValue(undefined),
    setBrowserConfig: vi.fn(),
    canReconfigure: vi.fn().mockReturnValue(true),
    requireSnapshot: vi.fn(),
    resolveElementByEid: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
