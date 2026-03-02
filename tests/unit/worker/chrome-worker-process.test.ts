/**
 * ChromeWorkerProcess Unit Tests
 *
 * Tests the Chrome process management logic.
 * Note: Actual Chrome spawning is mocked.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Mock logging service
vi.mock('../../../src/shared/services/logging.service.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { ChromeWorkerProcess, findChromePath } from '../../../src/worker/chrome-worker-process.js';
import { WorkerError } from '../../../src/worker/errors/index.js';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';

/**
 * Create a mock child process that behaves like a real ChildProcess
 */
function createMockChildProcess(options: { pid?: number; failOnSpawn?: boolean } = {}) {
  const mockProcess = new EventEmitter() as EventEmitter & {
    pid?: number;
    kill: ReturnType<typeof vi.fn>;
    stdin: null;
    stdout: EventEmitter;
    stderr: EventEmitter;
  };

  mockProcess.pid = options.pid ?? 12345;
  mockProcess.kill = vi.fn((signal?: string) => {
    if (signal === 'SIGKILL') {
      setImmediate(() => mockProcess.emit('exit', null, 'SIGKILL'));
    } else {
      setImmediate(() => mockProcess.emit('exit', 0, null));
    }
    return true;
  });
  mockProcess.stdin = null;
  mockProcess.stdout = new EventEmitter();
  mockProcess.stderr = new EventEmitter();

  return mockProcess;
}

describe('ChromeWorkerProcess', () => {
  let mockProcess: ReturnType<typeof createMockChildProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockProcess = createMockChildProcess({ pid: 12345 });

    // Default mock implementations
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

    // Mock fetch to simulate CDP becoming available
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          Browser: 'Chrome/120.0.0.0',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9300/devtools/browser/abc',
        }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create worker with valid config', () => {
      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/profile',
        chromePath: '/usr/bin/chrome',
      });

      expect(worker.workerId).toBe('w-123');
      expect(worker.port).toBe(9300);
      expect(worker.profileDir).toBe('/tmp/profile');
      expect(worker.state).toBe('idle');
    });

    it('should auto-detect Chrome path', () => {
      vi.mocked(existsSync).mockImplementation(
        (path) => path === '/usr/bin/google-chrome-stable'
      );

      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/profile',
      });

      expect(worker.state).toBe('idle');
    });

    it('should throw if Chrome not found', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      expect(
        () =>
          new ChromeWorkerProcess({
            workerId: 'w-123',
            port: 9300,
            profileDir: '/tmp/profile',
          })
      ).toThrow('Chrome executable not found');
    });
  });

  describe('start', () => {
    it('should start Chrome process', async () => {
      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/profile',
        chromePath: '/usr/bin/chrome',
      });

      const startedPromise = new Promise<void>((resolve) => {
        worker.on('started', () => resolve());
      });

      await worker.start();
      await startedPromise;

      expect(worker.state).toBe('running');
      expect(worker.pid).toBe(12345);
      expect(worker.cdpEndpoint).toBe('http://127.0.0.1:9300');
      expect(worker.isRunning).toBe(true);
    });

    it('should create profile directory', async () => {
      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/test-profile',
        chromePath: '/usr/bin/chrome',
      });

      await worker.start();

      expect(mkdir).toHaveBeenCalledWith('/tmp/test-profile', { recursive: true });
    });

    it('should pass correct arguments to spawn', async () => {
      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/profile',
        chromePath: '/usr/bin/chrome',
      });

      await worker.start();

      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/chrome',
        expect.arrayContaining([
          '--remote-debugging-port=9300',
          '--remote-debugging-address=127.0.0.1',
          '--user-data-dir=/tmp/profile',
          '--no-first-run',
        ]),
        expect.objectContaining({
          detached: false,
        })
      );
    });

    it('should throw INVALID_STATE if already running', async () => {
      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/profile',
        chromePath: '/usr/bin/chrome',
      });

      await worker.start();

      await expect(worker.start()).rejects.toThrow(WorkerError);

      try {
        await worker.start();
      } catch (error) {
        expect(WorkerError.isWorkerError(error)).toBe(true);
        if (WorkerError.isWorkerError(error)) {
          expect(error.code).toBe('INVALID_STATE');
        }
      }
    });

    it('should throw WORKER_START_FAILED if CDP does not become available', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/profile',
        chromePath: '/usr/bin/chrome',
        startupTimeoutMs: 100,
      });

      await expect(worker.start()).rejects.toThrow(WorkerError);

      expect(worker.state).toBe('crashed');
    });
  });

  describe('stop', () => {
    it('should stop running process gracefully', async () => {
      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/profile',
        chromePath: '/usr/bin/chrome',
      });

      await worker.start();

      const exitPromise = new Promise<void>((resolve) => {
        worker.on('exit', () => resolve());
      });

      await worker.stop();
      await exitPromise;

      expect(worker.state).toBe('stopped');
      expect(worker.pid).toBeUndefined();
      expect(worker.cdpEndpoint).toBeUndefined();
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should use SIGKILL if process does not exit gracefully', async () => {
      // Make the process not respond to SIGTERM
      mockProcess.kill = vi.fn((signal?: string) => {
        if (signal === 'SIGKILL') {
          setImmediate(() => mockProcess.emit('exit', null, 'SIGKILL'));
        }
        // SIGTERM does nothing
        return true;
      });

      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/profile',
        chromePath: '/usr/bin/chrome',
      });

      await worker.start();

      // Start stop with short timeout
      const stopPromise = worker.stop(50);

      // Advance time past the timeout
      await vi.advanceTimersByTimeAsync(100);

      await stopPromise;

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should be idempotent', async () => {
      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/profile',
        chromePath: '/usr/bin/chrome',
      });

      await worker.start();
      await worker.stop();

      // Should not throw when called again
      await worker.stop();
      await worker.stop();
    });
  });

  describe('kill', () => {
    it('should force kill the process', async () => {
      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/profile',
        chromePath: '/usr/bin/chrome',
      });

      await worker.start();
      worker.kill();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });

  describe('crash handling', () => {
    it('should emit exit event on unexpected exit', async () => {
      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/profile',
        chromePath: '/usr/bin/chrome',
      });

      await worker.start();

      const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        worker.on('exit', resolve);
      });

      // Simulate unexpected crash
      mockProcess.emit('exit', 1, null);

      const exitData = await exitPromise;
      expect(exitData.code).toBe(1);
      expect(worker.state).toBe('crashed');
    });

    it('should emit error event on process error', async () => {
      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/profile',
        chromePath: '/usr/bin/chrome',
      });

      await worker.start();

      const errorPromise = new Promise<{ error: Error }>((resolve) => {
        worker.on('error', resolve);
      });

      // Simulate process error
      mockProcess.emit('error', new Error('Process spawn error'));

      const errorData = await errorPromise;
      expect(errorData.error.message).toBe('Process spawn error');
      expect(worker.state).toBe('crashed');
    });
  });

  describe('state transitions', () => {
    it('should allow restart after crash', async () => {
      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/profile',
        chromePath: '/usr/bin/chrome',
      });

      await worker.start();

      // Simulate crash
      mockProcess.emit('exit', 1, null);
      expect(worker.state).toBe('crashed');

      // Create new mock process for restart
      mockProcess = createMockChildProcess({ pid: 54321 });
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      // Should be able to restart
      await worker.start();
      expect(worker.state).toBe('running');
      expect(worker.pid).toBe(54321);
    });

    it('should allow restart after stop', async () => {
      const worker = new ChromeWorkerProcess({
        workerId: 'w-123',
        port: 9300,
        profileDir: '/tmp/profile',
        chromePath: '/usr/bin/chrome',
      });

      await worker.start();
      await worker.stop();
      expect(worker.state).toBe('stopped');

      // Create new mock process for restart
      mockProcess = createMockChildProcess({ pid: 54321 });
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      await worker.start();
      expect(worker.state).toBe('running');
    });
  });
});

describe('findChromePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return first existing path', () => {
    vi.mocked(existsSync).mockImplementation((path) => path === '/usr/bin/chromium');

    const result = findChromePath();
    expect(result).toBe('/usr/bin/chromium');
  });

  it('should return undefined if no Chrome found', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = findChromePath();
    expect(result).toBeUndefined();
  });
});
