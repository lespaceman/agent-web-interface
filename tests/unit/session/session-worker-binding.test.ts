import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionWorkerBinding } from '../../../src/session/session-worker-binding.js';
import type { SessionManager } from '../../../src/browser/session-manager.js';
import type { WorkerManager } from '../../../src/worker/worker-manager.js';
import type { BrowserContext } from 'puppeteer-core';

/**
 * Create a mock SessionManager with the methods used by SessionWorkerBinding.
 */
function createMockSessionManager(): {
  connect: ReturnType<typeof vi.fn>;
  createIsolatedContext: ReturnType<typeof vi.fn>;
} & Partial<SessionManager> {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    createIsolatedContext: vi.fn().mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
      pages: vi.fn().mockResolvedValue([]),
    } as unknown as BrowserContext),
  } as unknown as ReturnType<typeof createMockSessionManager>;
}

/**
 * Create a mock WorkerManager with the methods used by SessionWorkerBinding.
 */
function createMockWorkerManager(): {
  acquireForTenant: ReturnType<typeof vi.fn>;
  releaseLease: ReturnType<typeof vi.fn>;
} & Partial<WorkerManager> {
  return {
    acquireForTenant: vi.fn().mockResolvedValue({
      success: true,
      workerId: 'worker-1',
      cdpEndpoint: 'ws://127.0.0.1:9300/devtools/browser/abc',
    }),
    releaseLease: vi.fn().mockReturnValue(true),
  } as unknown as ReturnType<typeof createMockWorkerManager>;
}

describe('SessionWorkerBinding', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockWorkerManager: ReturnType<typeof createMockWorkerManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
    mockWorkerManager = createMockWorkerManager();
  });

  describe('constructor', () => {
    it('should default to context isolation mode', () => {
      const binding = new SessionWorkerBinding();
      expect(binding.isolationMode).toBe('context');
    });

    it('should accept process isolation mode', () => {
      const binding = new SessionWorkerBinding('process');
      expect(binding.isolationMode).toBe('process');
    });

    it('should accept context isolation mode explicitly', () => {
      const binding = new SessionWorkerBinding('context');
      expect(binding.isolationMode).toBe('context');
    });
  });

  describe('process mode', () => {
    let binding: SessionWorkerBinding;

    beforeEach(() => {
      binding = new SessionWorkerBinding('process');
    });

    it('should acquire worker on session start', async () => {
      const result = await binding.onSessionStart(
        'session-abc',
        mockSessionManager as unknown as SessionManager,
        mockWorkerManager as unknown as WorkerManager
      );

      expect(mockWorkerManager.acquireForTenant).toHaveBeenCalledWith('session-abc', 'session-abc');
      expect(mockSessionManager.connect).toHaveBeenCalledWith({
        browserWSEndpoint: 'ws://127.0.0.1:9300/devtools/browser/abc',
      });
      expect(result.cdpEndpoint).toBe('ws://127.0.0.1:9300/devtools/browser/abc');
    });

    it('should store worker assignment after start', async () => {
      await binding.onSessionStart(
        'session-abc',
        mockSessionManager as unknown as SessionManager,
        mockWorkerManager as unknown as WorkerManager
      );

      const assignment = binding.getWorkerAssignment('session-abc');
      expect(assignment).toEqual({
        workerId: 'worker-1',
        cdpEndpoint: 'ws://127.0.0.1:9300/devtools/browser/abc',
      });
    });

    it('should throw if WorkerManager is not provided', async () => {
      await expect(
        binding.onSessionStart(
          'session-abc',
          mockSessionManager as unknown as SessionManager,
          undefined
        )
      ).rejects.toThrow('WorkerManager is required for process isolation mode');
    });

    it('should throw if worker acquisition fails', async () => {
      mockWorkerManager.acquireForTenant.mockResolvedValue({
        success: false,
        error: 'max workers reached',
      });

      await expect(
        binding.onSessionStart(
          'session-abc',
          mockSessionManager as unknown as SessionManager,
          mockWorkerManager as unknown as WorkerManager
        )
      ).rejects.toThrow('Failed to acquire worker for session session-abc: max workers reached');
    });

    it('should release worker lease on session end', async () => {
      // Start first to create the assignment
      await binding.onSessionStart(
        'session-abc',
        mockSessionManager as unknown as SessionManager,
        mockWorkerManager as unknown as WorkerManager
      );

      binding.onSessionEnd('session-abc', mockWorkerManager as unknown as WorkerManager);

      expect(mockWorkerManager.releaseLease).toHaveBeenCalledWith('session-abc');
      expect(binding.getWorkerAssignment('session-abc')).toBeUndefined();
    });

    it('should handle session end gracefully when no assignment exists', () => {
      // Should not throw
      binding.onSessionEnd('session-nonexistent', mockWorkerManager as unknown as WorkerManager);
      expect(mockWorkerManager.releaseLease).not.toHaveBeenCalled();
    });
  });

  describe('context mode', () => {
    let binding: SessionWorkerBinding;

    beforeEach(() => {
      binding = new SessionWorkerBinding('context');
    });

    it('should create isolated BrowserContext on session start', async () => {
      const result = await binding.onSessionStart(
        'session-abc',
        mockSessionManager as unknown as SessionManager
      );

      expect(mockSessionManager.createIsolatedContext).toHaveBeenCalled();
      expect(result.browserContext).toBeDefined();
    });

    it('should not require WorkerManager', async () => {
      // Should not throw even without workerManager
      await expect(
        binding.onSessionStart(
          'session-abc',
          mockSessionManager as unknown as SessionManager,
          undefined
        )
      ).resolves.toBeDefined();
    });

    it('should not call WorkerManager methods on session end', () => {
      binding.onSessionEnd('session-abc', mockWorkerManager as unknown as WorkerManager);
      expect(mockWorkerManager.releaseLease).not.toHaveBeenCalled();
    });

    it('should complete session end without errors', () => {
      expect(() => binding.onSessionEnd('session-abc')).not.toThrow();
    });
  });
});
