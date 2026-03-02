/**
 * Session Worker Binding
 *
 * Thin adapter that routes session lifecycle to either WorkerManager (process isolation)
 * or BrowserContext (context isolation) based on the configured ISOLATION_MODE.
 */

import type { SessionManager } from '../browser/session-manager.js';
import type { WorkerManager } from '../worker/worker-manager.js';
import { createLogger } from '../shared/services/logging.service.js';

const logger = createLogger('SessionWorkerBinding');

/** Isolation mode determines how sessions get browser access */
export type IsolationMode = 'process' | 'context';

/**
 * Tracks worker assignments for process-mode sessions.
 * Maps sessionId to the workerId that was acquired.
 */
interface WorkerAssignment {
  workerId: string;
  cdpEndpoint: string;
}

/**
 * Routes session lifecycle events to the appropriate isolation backend.
 *
 * - **process** mode: Each session gets a dedicated Chrome worker process via WorkerManager.
 * - **context** mode: Each session gets an isolated BrowserContext within the shared browser.
 */
export class SessionWorkerBinding {
  readonly isolationMode: IsolationMode;
  private readonly workerAssignments = new Map<string, WorkerAssignment>();

  constructor(isolationMode: IsolationMode = 'context') {
    this.isolationMode = isolationMode;
    logger.info(`SessionWorkerBinding created`, { isolationMode });
  }

  /**
   * Handle session start: acquire isolation resources.
   *
   * @param sessionId - The session identifier (used as tenantId for worker leases)
   * @param sessionManager - The SessionManager for browser access
   * @param workerManager - Required in process mode; ignored in context mode
   * @returns The CDP endpoint (process mode) or the BrowserContext (context mode)
   */
  async onSessionStart(
    sessionId: string,
    sessionManager: SessionManager,
    workerManager?: WorkerManager
  ): Promise<{ cdpEndpoint?: string; browserContext?: import('puppeteer-core').BrowserContext }> {
    if (this.isolationMode === 'process') {
      return this.startProcessIsolation(sessionId, sessionManager, workerManager);
    }
    return this.startContextIsolation(sessionId, sessionManager);
  }

  /**
   * Handle session end: release isolation resources.
   *
   * @param sessionId - The session identifier
   * @param workerManager - Required in process mode; ignored in context mode
   */
  onSessionEnd(sessionId: string, workerManager?: WorkerManager): void {
    if (this.isolationMode === 'process') {
      this.endProcessIsolation(sessionId, workerManager);
      return;
    }
    // Context mode: BrowserContext cleanup is handled by SessionStore.destroySession()
    logger.debug(`Context-mode session ended; cleanup delegated to SessionStore`, { sessionId });
  }

  /**
   * Get the worker assignment for a session (process mode only).
   */
  getWorkerAssignment(sessionId: string): WorkerAssignment | undefined {
    return this.workerAssignments.get(sessionId);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async startProcessIsolation(
    sessionId: string,
    sessionManager: SessionManager,
    workerManager?: WorkerManager
  ): Promise<{ cdpEndpoint: string }> {
    if (!workerManager) {
      throw new Error('WorkerManager is required for process isolation mode');
    }

    logger.info(`Acquiring worker for session`, { sessionId });
    const result = await workerManager.acquireForTenant(sessionId, sessionId);

    if (!result.success || !result.cdpEndpoint || !result.workerId) {
      throw new Error(
        `Failed to acquire worker for session ${sessionId}: ${result.error ?? 'unknown error'}`
      );
    }

    const assignment = {
      workerId: result.workerId,
      cdpEndpoint: result.cdpEndpoint,
    };
    this.workerAssignments.set(sessionId, assignment);

    // Connect SessionManager to the worker's CDP endpoint
    try {
      await sessionManager.connect({ browserWSEndpoint: result.cdpEndpoint });
    } catch (err) {
      // Rollback: release assignment so we don't leak a dangling entry
      this.workerAssignments.delete(sessionId);
      throw err;
    }

    logger.info(`Session connected to worker`, {
      sessionId,
      workerId: result.workerId,
      cdpEndpoint: result.cdpEndpoint,
    });

    return { cdpEndpoint: result.cdpEndpoint };
  }

  private async startContextIsolation(
    _sessionId: string,
    sessionManager: SessionManager
  ): Promise<{ browserContext: import('puppeteer-core').BrowserContext }> {
    const browserContext = await sessionManager.createIsolatedContext();
    logger.info(`Created isolated BrowserContext for session`, { sessionId: _sessionId });
    return { browserContext };
  }

  private endProcessIsolation(sessionId: string, workerManager?: WorkerManager): void {
    if (!workerManager) {
      logger.warning(`No WorkerManager provided for process-mode session end`, { sessionId });
      return;
    }

    const assignment = this.workerAssignments.get(sessionId);
    if (!assignment) {
      logger.warning(`No worker assignment found for session`, { sessionId });
      return;
    }

    workerManager.releaseLease(sessionId);
    this.workerAssignments.delete(sessionId);
    logger.info(`Released worker lease for session`, { sessionId, workerId: assignment.workerId });
  }
}
