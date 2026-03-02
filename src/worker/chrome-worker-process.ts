/**
 * Chrome Worker Process
 *
 * Manages a Chrome browser child process with CDP debugging enabled.
 * Handles process lifecycle: start, stop, crash detection.
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { CHROME_WORKER_ARGS, type WorkerState, type WorkerProcessEvents } from './types.js';
import { WorkerError } from './errors/index.js';
import { createLogger } from '../shared/services/logging.service.js';

const logger = createLogger('ChromeWorkerProcess');

/**
 * Configuration for ChromeWorkerProcess
 */
export interface ChromeWorkerProcessConfig {
  /** Unique worker identifier */
  workerId: string;
  /** Port for CDP debugging */
  port: number;
  /** Chrome user data directory */
  profileDir: string;
  /** Path to Chrome executable (optional, auto-detected) */
  chromePath?: string;
  /** Timeout for startup in milliseconds */
  startupTimeoutMs?: number;
}

/**
 * Default Chrome executable paths by platform
 */
const DEFAULT_CHROME_PATHS: Record<string, string[]> = {
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

/**
 * Find Chrome executable on the system
 */
export function findChromePath(): string | undefined {
  const platform = process.platform;
  const paths = DEFAULT_CHROME_PATHS[platform] || [];

  for (const chromePath of paths) {
    if (existsSync(chromePath)) {
      return chromePath;
    }
  }

  return undefined;
}

/**
 * Type-safe EventEmitter for ChromeWorkerProcess
 */
interface ChromeWorkerProcessEmitter {
  on<K extends keyof WorkerProcessEvents>(
    event: K,
    listener: (data: WorkerProcessEvents[K]) => void
  ): this;
  once<K extends keyof WorkerProcessEvents>(
    event: K,
    listener: (data: WorkerProcessEvents[K]) => void
  ): this;
  emit<K extends keyof WorkerProcessEvents>(event: K, data: WorkerProcessEvents[K]): boolean;
  off<K extends keyof WorkerProcessEvents>(
    event: K,
    listener: (data: WorkerProcessEvents[K]) => void
  ): this;
  removeAllListeners<K extends keyof WorkerProcessEvents>(event?: K): this;
}

/**
 * Manages a Chrome browser child process.
 *
 * @example
 * ```typescript
 * const worker = new ChromeWorkerProcess({
 *   workerId: 'w-123',
 *   port: 9300,
 *   profileDir: '/var/lib/athena/profiles/tenant-a',
 * });
 *
 * worker.on('started', ({ pid, cdpEndpoint }) => {
 *   console.log(`Chrome started with PID ${pid} at ${cdpEndpoint}`);
 * });
 *
 * worker.on('exit', ({ code, signal }) => {
 *   console.log(`Chrome exited with code ${code}`);
 * });
 *
 * await worker.start();
 * // ... use the worker ...
 * await worker.stop();
 * ```
 */
export class ChromeWorkerProcess extends EventEmitter implements ChromeWorkerProcessEmitter {
  readonly workerId: string;
  readonly port: number;
  readonly profileDir: string;

  private readonly chromePath: string;
  private readonly startupTimeoutMs: number;
  private process: ChildProcess | null = null;
  private _state: WorkerState = 'idle';
  private _pid: number | undefined;
  private _cdpEndpoint: string | undefined;

  constructor(config: ChromeWorkerProcessConfig) {
    super();

    this.workerId = config.workerId;
    this.port = config.port;
    this.profileDir = config.profileDir;
    this.startupTimeoutMs = config.startupTimeoutMs ?? 30_000;

    // Resolve Chrome path
    const chromePath = config.chromePath ?? findChromePath();
    if (!chromePath) {
      throw new Error(
        'Chrome executable not found. Please set CHROME_PATH environment variable or install Chrome.'
      );
    }
    this.chromePath = chromePath;
  }

  /**
   * Get current worker state
   */
  get state(): WorkerState {
    return this._state;
  }

  /**
   * Get Chrome process ID (if running)
   */
  get pid(): number | undefined {
    return this._pid;
  }

  /**
   * Get CDP endpoint URL (if running)
   */
  get cdpEndpoint(): string | undefined {
    return this._cdpEndpoint;
  }

  /**
   * Check if the worker is currently running
   */
  get isRunning(): boolean {
    return this._state === 'running';
  }

  /**
   * Start the Chrome process
   *
   * @throws WorkerError if process fails to start
   */
  async start(): Promise<void> {
    if (this._state !== 'idle' && this._state !== 'stopped' && this._state !== 'crashed') {
      throw WorkerError.invalidState(this._state, 'start', { workerId: this.workerId });
    }

    this._state = 'starting';

    try {
      // Ensure profile directory exists
      await mkdir(this.profileDir, { recursive: true });

      const args = this.buildArgs();

      logger.debug('Starting Chrome process', {
        workerId: this.workerId,
        chromePath: this.chromePath,
        port: this.port,
        profileDir: this.profileDir,
      });

      this.process = spawn(this.chromePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      this._pid = this.process.pid;

      // Set up event handlers
      this.setupProcessHandlers();

      // Wait for CDP to become available
      await this.waitForCdp();

      this._state = 'running';
      this._cdpEndpoint = `http://127.0.0.1:${this.port}`;

      this.emit('started', { pid: this._pid!, cdpEndpoint: this._cdpEndpoint });

      logger.info('Chrome process started', {
        workerId: this.workerId,
        pid: this._pid,
        cdpEndpoint: this._cdpEndpoint,
      });
    } catch (error) {
      this._state = 'crashed';
      // Kill orphaned process before cleanup to prevent process leak
      if (this.process) {
        this.process.kill('SIGKILL');
      }
      this.cleanup();
      throw WorkerError.workerStartFailed(
        this.workerId,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Stop the Chrome process gracefully
   *
   * @param timeoutMs - Time to wait for graceful shutdown before SIGKILL
   */
  async stop(timeoutMs = 5000): Promise<void> {
    if (!this.process || this._state === 'stopped' || this._state === 'stopping') {
      return;
    }

    this._state = 'stopping';

    logger.debug('Stopping Chrome process', {
      workerId: this.workerId,
      pid: this._pid,
    });

    return new Promise<void>((resolve) => {
      const forceKillTimer = setTimeout(() => {
        logger.warning('Chrome process did not exit gracefully, sending SIGKILL', {
          workerId: this.workerId,
          pid: this._pid,
        });
        this.process?.kill('SIGKILL');
      }, timeoutMs);

      const onExit = () => {
        clearTimeout(forceKillTimer);
        resolve();
      };

      this.process!.once('exit', onExit);

      // Send SIGTERM for graceful shutdown
      this.process!.kill('SIGTERM');
    });
  }

  /**
   * Force kill the Chrome process immediately
   */
  kill(): void {
    if (this.process) {
      this.process.kill('SIGKILL');
    }
  }

  /**
   * Build Chrome command line arguments
   */
  private buildArgs(): string[] {
    return [
      `--remote-debugging-port=${this.port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${this.profileDir}`,
      ...CHROME_WORKER_ARGS,
    ];
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(): void {
    if (!this.process) return;

    this.process.on('error', (error) => {
      logger.error('Chrome process error', error, {
        workerId: this.workerId,
      });
      this._state = 'crashed';
      this.emit('error', { error });
      this.cleanup();
    });

    this.process.on('exit', (code, signal) => {
      if (this._state !== 'stopping') {
        // Unexpected exit
        this._state = 'crashed';
        logger.warning('Chrome process exited unexpectedly', {
          workerId: this.workerId,
          exitCode: code,
          signal,
        });
      } else {
        this._state = 'stopped';
        logger.info('Chrome process stopped', {
          workerId: this.workerId,
          exitCode: code,
          signal,
        });
      }

      this.emit('exit', { code, signal });
      this.cleanup();
    });

    // Log stderr for debugging
    this.process.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        logger.debug('Chrome stderr', { workerId: this.workerId, message });
      }
    });
  }

  /**
   * Wait for CDP endpoint to become available
   */
  private async waitForCdp(): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 100;

    while (Date.now() - startTime < this.startupTimeoutMs) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/json/version`, {
          signal: AbortSignal.timeout(1000),
        });

        if (response.ok) {
          return;
        }
      } catch {
        // CDP not ready yet, continue waiting
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    throw new Error(`CDP endpoint did not become available within ${this.startupTimeoutMs}ms`);
  }

  /**
   * Clean up process references and event listeners
   */
  private cleanup(): void {
    if (this.process) {
      this.process.removeAllListeners();
    }
    this.process = null;
    this._pid = undefined;
    this._cdpEndpoint = undefined;
  }
}
