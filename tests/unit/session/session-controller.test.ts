/* eslint-disable @typescript-eslint/unbound-method */
/**
 * Unit tests for SessionController
 *
 * Tests the owned-SessionManager architecture where each session
 * lazily creates and owns its own SessionManager instance.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PageHandle } from '../../../src/browser/page-registry.js';
import type { CdpClient } from '../../../src/cdp/cdp-client.interface.js';

// ── Module mocks ────────────────────────────────────────────────────────────

/** Captured state change listeners for simulating browser crashes in tests */
const stateChangeListeners = new Set<
  (event: { previousState: string; currentState: string }) => void
>();

const mockSessionManagerInstance = {
  isRunning: vi.fn().mockReturnValue(false),
  connectionState: 'idle' as string,
  connectionPromise: null as Promise<void> | null,
  launch: vi.fn().mockResolvedValue(undefined),
  connect: vi.fn().mockResolvedValue(undefined),
  shutdown: vi.fn().mockResolvedValue(undefined),
  resolvePage: vi.fn(),
  resolvePageOrCreate: vi.fn(),
  touchPage: vi.fn(),
  closePage: vi.fn().mockResolvedValue(true),
  syncPages: vi.fn().mockResolvedValue([]),
  navigateTo: vi.fn().mockResolvedValue(undefined),
  rebindCdpSession: vi.fn(),
  onStateChange: vi
    .fn()
    .mockImplementation(
      (listener: (event: { previousState: string; currentState: string }) => void) => {
        stateChangeListeners.add(listener);
        return () => stateChangeListeners.delete(listener);
      }
    ),
};

vi.mock('../../../src/browser/session-manager.js', () => {
  // Use a real constructor function so `new SessionManager()` works
  function SessionManager(this: Record<string, unknown>) {
    return Object.assign(this, mockSessionManagerInstance);
  }
  return { SessionManager };
});

vi.mock('../../../src/tools/tool-context.js', () => ({
  ensureCdpSession: vi.fn(),
  resolveExistingPage: vi.fn(),
}));

vi.mock('../../../src/tools/action-context.js', () => ({
  captureSnapshotWithRecovery: vi.fn(),
}));

vi.mock('../../../src/cdp/puppeteer-cdp-client.js', () => {
  const PuppeteerCdpClient = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.isActive = vi.fn().mockReturnValue(true);
    this.send = vi.fn().mockResolvedValue({});
    this.close = vi.fn().mockResolvedValue(undefined);
  });
  return { PuppeteerCdpClient };
});

import { SessionController } from '../../../src/session/session-controller.js';
import { resolveExistingPage } from '../../../src/tools/tool-context.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePageHandle(overrides: Partial<PageHandle> = {}): PageHandle {
  return {
    page_id: overrides.page_id ?? 'page-1',
    page: (overrides.page ?? {}) as PageHandle['page'],
    cdp: (overrides.cdp ?? {
      isActive: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
    }) as unknown as CdpClient,
    created_at: overrides.created_at ?? new Date(),
    url: overrides.url ?? 'https://example.com',
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('SessionController', () => {
  let controller: SessionController;

  beforeEach(() => {
    vi.clearAllMocks();
    stateChangeListeners.clear();
    // Reset mock state
    mockSessionManagerInstance.isRunning.mockReturnValue(false);
    mockSessionManagerInstance.connectionState = 'idle';
    mockSessionManagerInstance.connectionPromise = null;

    controller = new SessionController({ sessionId: 'test-session' });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Construction and state
  // ══════════════════════════════════════════════════════════════════════════

  it('constructor sets state to active', () => {
    expect(controller.state).toBe('active');
  });

  it('touch() updates lastActivity timestamp', () => {
    const before = controller.lastActivity;
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);

    controller.touch();

    expect(controller.lastActivity).toBeGreaterThan(before);
    vi.useRealTimers();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SessionManager ownership
  // ══════════════════════════════════════════════════════════════════════════

  it('getSessionManager returns a SessionManager instance', () => {
    const sm = controller.getSessionManager();
    // The returned object should have all SessionManager methods
    expect(sm.resolvePage).toBeDefined();
    expect(sm.resolvePageOrCreate).toBeDefined();
    expect(sm.launch).toBeDefined();
    expect(sm.connect).toBeDefined();
    expect(sm.shutdown).toBeDefined();
  });

  it('getSessionManager lazily creates and reuses the same instance', () => {
    const sm1 = controller.getSessionManager();
    const sm2 = controller.getSessionManager();

    expect(sm1).toBe(sm2);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Page lifecycle delegation
  // ══════════════════════════════════════════════════════════════════════════

  it('resolvePage delegates to sessionManager', () => {
    const handle = makePageHandle();
    mockSessionManagerInstance.resolvePage.mockReturnValue(handle);

    const result = controller.resolvePage('page-1');

    expect(mockSessionManagerInstance.resolvePage).toHaveBeenCalledWith('page-1');
    expect(result).toBe(handle);
  });

  it('resolvePage delegates without pageId', () => {
    mockSessionManagerInstance.resolvePage.mockReturnValue(undefined);

    const result = controller.resolvePage();

    expect(mockSessionManagerInstance.resolvePage).toHaveBeenCalledWith(undefined);
    expect(result).toBeUndefined();
  });

  it('resolvePageOrCreate delegates to sessionManager', async () => {
    const handle = makePageHandle();
    mockSessionManagerInstance.resolvePageOrCreate.mockResolvedValue(handle);

    const result = await controller.resolvePageOrCreate('page-1');

    expect(mockSessionManagerInstance.resolvePageOrCreate).toHaveBeenCalledWith('page-1');
    expect(result).toBe(handle);
  });

  it('touchPage delegates to sessionManager', () => {
    controller.touchPage('page-1');

    expect(mockSessionManagerInstance.touchPage).toHaveBeenCalledWith('page-1');
  });

  it('closePage delegates to sessionManager', async () => {
    const result = await controller.closePage('page-1');

    expect(mockSessionManagerInstance.closePage).toHaveBeenCalledWith('page-1');
    expect(result).toBe(true);
  });

  it('syncPages delegates to sessionManager', async () => {
    const handles = [makePageHandle()];
    mockSessionManagerInstance.syncPages.mockResolvedValue(handles);

    const result = await controller.syncPages();

    expect(mockSessionManagerInstance.syncPages).toHaveBeenCalled();
    expect(result).toBe(handles);
  });

  it('navigateTo delegates to sessionManager', async () => {
    await controller.navigateTo('page-1', 'https://example.com');

    expect(mockSessionManagerInstance.navigateTo).toHaveBeenCalledWith(
      'page-1',
      'https://example.com'
    );
  });

  it('resolveExistingPage delegates to resolveExistingPageImpl', () => {
    const handle = makePageHandle();
    vi.mocked(resolveExistingPage).mockReturnValue(handle);

    const result = controller.resolveExistingPage('page-1');

    expect(resolveExistingPage).toHaveBeenCalledWith(mockSessionManagerInstance, 'page-1');
    expect(result).toBe(handle);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // State access
  // ══════════════════════════════════════════════════════════════════════════

  it('getSnapshotStore returns isolated store per session', () => {
    const store1 = controller.getSnapshotStore();
    const store2 = controller.getSnapshotStore();

    expect(store1).toBe(store2);

    // Different session controller gets a different store
    const controller2 = new SessionController({ sessionId: 'test-session-2' });
    const store3 = controller2.getSnapshotStore();
    expect(store3).not.toBe(store1);
  });

  it('getStateManager creates per-page state managers', () => {
    const sm1 = controller.getStateManager('page-1');
    const sm2 = controller.getStateManager('page-2');
    const sm1Again = controller.getStateManager('page-1');

    expect(sm1).toBe(sm1Again);
    expect(sm1).not.toBe(sm2);
  });

  it('removeStateManager removes per-page state manager', () => {
    const sm = controller.getStateManager('page-1');
    expect(sm).toBeDefined();

    controller.removeStateManager('page-1');

    // Should create a new instance after removal
    const smNew = controller.getStateManager('page-1');
    expect(smNew).not.toBe(sm);
  });

  it('clearAllStateManagers clears all state managers', () => {
    const sm1 = controller.getStateManager('page-1');
    const sm2 = controller.getStateManager('page-2');

    controller.clearAllStateManagers();

    expect(controller.getStateManager('page-1')).not.toBe(sm1);
    expect(controller.getStateManager('page-2')).not.toBe(sm2);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ensureBrowser()
  // ══════════════════════════════════════════════════════════════════════════

  describe('ensureBrowser', () => {
    it('launches browser by default when no connect options are set', async () => {
      await controller.ensureBrowser();

      expect(mockSessionManagerInstance.launch).toHaveBeenCalledWith(
        expect.objectContaining({ headless: false })
      );
      expect(mockSessionManagerInstance.connect).not.toHaveBeenCalled();
    });

    it('returns immediately if browser is already running', async () => {
      mockSessionManagerInstance.isRunning.mockReturnValue(true);

      await controller.ensureBrowser();

      expect(mockSessionManagerInstance.launch).not.toHaveBeenCalled();
      expect(mockSessionManagerInstance.connect).not.toHaveBeenCalled();
    });

    it('awaits in-flight connection if connectionState is connecting', async () => {
      const connectionPromise = Promise.resolve();
      mockSessionManagerInstance.connectionState = 'connecting';
      mockSessionManagerInstance.connectionPromise = connectionPromise;

      await controller.ensureBrowser();

      expect(mockSessionManagerInstance.launch).not.toHaveBeenCalled();
      expect(mockSessionManagerInstance.connect).not.toHaveBeenCalled();
    });

    it('connects when AWI_CDP_URL env var is set', async () => {
      process.env.AWI_CDP_URL = 'http://localhost:9222';
      try {
        const controller2 = new SessionController({
          sessionId: 'connect-session',
        });

        await controller2.ensureBrowser();

        expect(mockSessionManagerInstance.connect).toHaveBeenCalledWith(
          expect.objectContaining({ endpointUrl: 'http://localhost:9222' })
        );
        expect(mockSessionManagerInstance.launch).not.toHaveBeenCalled();
      } finally {
        delete process.env.AWI_CDP_URL;
      }
    });

    it('propagates errors from launch', async () => {
      mockSessionManagerInstance.launch.mockRejectedValueOnce(new Error('launch failed'));

      await expect(controller.ensureBrowser()).rejects.toThrow('launch failed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setBrowserConfig()
  // ══════════════════════════════════════════════════════════════════════════

  describe('setBrowserConfig', () => {
    it('sets config before browser is started', () => {
      // Should not throw
      controller.setBrowserConfig({ headless: true });
    });

    it('throws if browser is already running', () => {
      // Force creation of the SessionManager
      controller.getSessionManager();
      mockSessionManagerInstance.isRunning.mockReturnValue(true);

      expect(() => controller.setBrowserConfig({ headless: true })).toThrow(
        'Cannot change browser configuration while the browser is running'
      );
    });

    it('allows config change when SessionManager exists but browser is not running', () => {
      // Force creation of the SessionManager
      controller.getSessionManager();
      mockSessionManagerInstance.isRunning.mockReturnValue(false);

      // Should not throw
      controller.setBrowserConfig({ headless: true });
    });

    it('merges config with existing values', async () => {
      controller.setBrowserConfig({ headless: true });

      await controller.ensureBrowser();

      expect(mockSessionManagerInstance.launch).toHaveBeenCalledWith(
        expect.objectContaining({ headless: true })
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // close()
  // ══════════════════════════════════════════════════════════════════════════

  describe('close', () => {
    it('transitions to closed state', async () => {
      expect(controller.state).toBe('active');

      await controller.close();

      expect(controller.state).toBe('closed');
    });

    it('is idempotent', async () => {
      await controller.close();
      expect(controller.state).toBe('closed');

      // Second call should not throw
      await controller.close();
      expect(controller.state).toBe('closed');
    });

    it('shuts down the owned SessionManager', async () => {
      // Force creation of the SessionManager
      controller.getSessionManager();

      await controller.close();

      expect(mockSessionManagerInstance.shutdown).toHaveBeenCalledTimes(1);
      expect(controller.state).toBe('closed');
    });

    it('handles shutdown errors gracefully', async () => {
      // Force creation of the SessionManager
      controller.getSessionManager();
      mockSessionManagerInstance.shutdown.mockRejectedValueOnce(new Error('shutdown error'));

      // Should not throw
      await controller.close();

      expect(controller.state).toBe('closed');
    });

    it('does not call shutdown if SessionManager was never created', async () => {
      await controller.close();

      expect(mockSessionManagerInstance.shutdown).not.toHaveBeenCalled();
      expect(controller.state).toBe('closed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // canReconfigure()
  // ══════════════════════════════════════════════════════════════════════════

  describe('canReconfigure', () => {
    it('returns true when no SessionManager exists', () => {
      expect(controller.canReconfigure()).toBe(true);
    });

    it('returns true when SessionManager exists but browser is not running', () => {
      controller.getSessionManager();
      mockSessionManagerInstance.isRunning.mockReturnValue(false);

      expect(controller.canReconfigure()).toBe(true);
    });

    it('returns false when browser is running', () => {
      controller.getSessionManager();
      mockSessionManagerInstance.isRunning.mockReturnValue(true);

      expect(controller.canReconfigure()).toBe(false);
    });

    it('returns true after browser crash (failed state)', async () => {
      await controller.ensureBrowser();
      mockSessionManagerInstance.isRunning.mockReturnValue(false);

      expect(controller.canReconfigure()).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // crash recovery
  // ══════════════════════════════════════════════════════════════════════════

  describe('crash recovery', () => {
    it('clears session state when browser transitions to failed', () => {
      // Force SessionManager creation (registers the listener)
      controller.getSessionManager();
      expect(stateChangeListeners.size).toBe(1);

      // Spy on snapshot store clear
      const store = controller.getSnapshotStore();
      const clearSpy = vi.spyOn(store, 'clear');

      // Simulate browser crash
      for (const listener of stateChangeListeners) {
        listener({ previousState: 'connected', currentState: 'failed' });
      }

      expect(clearSpy).toHaveBeenCalled();
    });

    it('allows setBrowserConfig after browser crash', () => {
      controller.getSessionManager();
      mockSessionManagerInstance.isRunning.mockReturnValue(false);

      // Simulate crash
      for (const listener of stateChangeListeners) {
        listener({ previousState: 'connected', currentState: 'failed' });
      }

      // Should not throw — browser is dead, config can change
      expect(() => controller.setBrowserConfig({ isolated: true })).not.toThrow();
    });

    it('relaunches with new config after crash + reconfigure', async () => {
      // First launch with defaults
      await controller.ensureBrowser();
      expect(mockSessionManagerInstance.launch).toHaveBeenCalledWith(
        expect.objectContaining({ isolated: false })
      );

      // Simulate crash
      mockSessionManagerInstance.isRunning.mockReturnValue(false);
      for (const listener of stateChangeListeners) {
        listener({ previousState: 'connected', currentState: 'failed' });
      }

      // Reconfigure
      controller.setBrowserConfig({ isolated: true });

      // Relaunch
      vi.clearAllMocks();
      await controller.ensureBrowser();

      expect(mockSessionManagerInstance.launch).toHaveBeenCalledWith(
        expect.objectContaining({ isolated: true })
      );
    });

    it('does not clear state on non-failed transitions', () => {
      controller.getSessionManager();
      const store = controller.getSnapshotStore();
      const clearSpy = vi.spyOn(store, 'clear');

      // Simulate normal transition (connecting → connected)
      for (const listener of stateChangeListeners) {
        listener({ previousState: 'connecting', currentState: 'connected' });
      }

      expect(clearSpy).not.toHaveBeenCalled();
    });
  });
});
