/**
 * Worker Error
 *
 * Standardized error classification for worker operations.
 * Provides error codes for programmatic handling and detailed messages for debugging.
 */

/**
 * Error codes for worker operations
 */
export type WorkerErrorCode =
  // Worker lifecycle errors
  | 'WORKER_NOT_FOUND'
  | 'WORKER_NOT_RUNNING'
  | 'WORKER_CRASHED'
  | 'WORKER_START_FAILED'
  | 'WORKER_STOP_FAILED'
  // Lease errors
  | 'LEASE_NOT_FOUND'
  | 'LEASE_NOT_HELD'
  | 'LEASE_EXPIRED'
  | 'LEASE_ALREADY_HELD'
  // Resource errors
  | 'PORT_EXHAUSTED'
  | 'MAX_WORKERS_REACHED'
  // Health check errors
  | 'HEALTH_CHECK_FAILED'
  | 'HEALTH_CHECK_TIMEOUT'
  // General errors
  | 'INVALID_STATE'
  | 'OPERATION_FAILED';

/**
 * Standardized error for worker operations.
 *
 * @example
 * ```typescript
 * throw new WorkerError(
 *   'Worker crashed unexpectedly',
 *   'WORKER_CRASHED',
 *   { workerId: 'w-123', exitCode: 1 }
 * );
 *
 * // Catching and handling by code
 * try {
 *   await workerManager.acquireForTenant('tenant-a', 'controller-1');
 * } catch (error) {
 *   if (error instanceof WorkerError) {
 *     switch (error.code) {
 *       case 'MAX_WORKERS_REACHED':
 *         console.log('Worker limit reached, try again later');
 *         break;
 *       case 'LEASE_ALREADY_HELD':
 *         console.log('Another session has the lease');
 *         break;
 *     }
 *   }
 * }
 * ```
 */
export class WorkerError extends Error {
  /**
   * Error code for programmatic handling
   */
  readonly code: WorkerErrorCode;

  /**
   * Original error that caused this error (if any)
   */
  readonly cause?: Error;

  /**
   * Additional context for debugging
   */
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: WorkerErrorCode,
    context?: Record<string, unknown>,
    cause?: Error
  ) {
    super(message);
    this.name = 'WorkerError';
    this.code = code;
    this.cause = cause;
    this.context = context;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WorkerError);
    }
  }

  /**
   * Create a JSON-serializable representation of the error
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      cause: this.cause
        ? {
            name: this.cause.name,
            message: this.cause.message,
          }
        : undefined,
      stack: this.stack,
    };
  }

  /**
   * Type guard to check if an error is a WorkerError
   */
  static isWorkerError(error: unknown): error is WorkerError {
    return error instanceof WorkerError;
  }

  // ==================== Factory Methods ====================

  /**
   * Create error for worker not found
   */
  static workerNotFound(workerId: string, context?: Record<string, unknown>): WorkerError {
    return new WorkerError('Worker not found', 'WORKER_NOT_FOUND', { workerId, ...context });
  }

  /**
   * Create error for worker not running
   */
  static workerNotRunning(
    workerId: string,
    currentState: string,
    context?: Record<string, unknown>
  ): WorkerError {
    return new WorkerError(
      `Worker is not running (current state: ${currentState})`,
      'WORKER_NOT_RUNNING',
      { workerId, currentState, ...context }
    );
  }

  /**
   * Create error for worker crash
   */
  static workerCrashed(
    workerId: string,
    exitCode: number | null,
    signal: string | null,
    context?: Record<string, unknown>
  ): WorkerError {
    return new WorkerError(
      `Worker crashed (exit code: ${exitCode}, signal: ${signal})`,
      'WORKER_CRASHED',
      { workerId, exitCode, signal, ...context }
    );
  }

  /**
   * Create error for worker start failure
   */
  static workerStartFailed(
    workerId: string,
    cause: Error,
    context?: Record<string, unknown>
  ): WorkerError {
    return new WorkerError(
      `Failed to start worker: ${cause.message}`,
      'WORKER_START_FAILED',
      { workerId, ...context },
      cause
    );
  }

  /**
   * Create error for worker stop failure
   */
  static workerStopFailed(
    workerId: string,
    cause: Error,
    context?: Record<string, unknown>
  ): WorkerError {
    return new WorkerError(
      `Failed to stop worker: ${cause.message}`,
      'WORKER_STOP_FAILED',
      { workerId, ...context },
      cause
    );
  }

  /**
   * Create error for lease not found
   */
  static leaseNotFound(tenantId: string, context?: Record<string, unknown>): WorkerError {
    return new WorkerError('Lease not found for tenant', 'LEASE_NOT_FOUND', {
      tenantId,
      ...context,
    });
  }

  /**
   * Create error for lease not held by controller
   */
  static leaseNotHeld(
    tenantId: string,
    controllerId: string,
    actualControllerId: string,
    context?: Record<string, unknown>
  ): WorkerError {
    return new WorkerError('Lease is held by a different controller', 'LEASE_NOT_HELD', {
      tenantId,
      controllerId,
      actualControllerId,
      ...context,
    });
  }

  /**
   * Create error for expired lease
   */
  static leaseExpired(
    tenantId: string,
    expiredAt: number,
    context?: Record<string, unknown>
  ): WorkerError {
    return new WorkerError('Lease has expired', 'LEASE_EXPIRED', {
      tenantId,
      expiredAt,
      ...context,
    });
  }

  /**
   * Create error for lease already held
   */
  static leaseAlreadyHeld(
    tenantId: string,
    heldByControllerId: string,
    context?: Record<string, unknown>
  ): WorkerError {
    return new WorkerError('Lease is already held by another controller', 'LEASE_ALREADY_HELD', {
      tenantId,
      heldByControllerId,
      ...context,
    });
  }

  /**
   * Create error for port exhaustion
   */
  static portExhausted(
    portMin: number,
    portMax: number,
    context?: Record<string, unknown>
  ): WorkerError {
    return new WorkerError(`No available ports in range ${portMin}-${portMax}`, 'PORT_EXHAUSTED', {
      portMin,
      portMax,
      ...context,
    });
  }

  /**
   * Create error for max workers reached
   */
  static maxWorkersReached(
    maxWorkers: number,
    currentCount: number,
    context?: Record<string, unknown>
  ): WorkerError {
    return new WorkerError(
      `Maximum worker limit reached (${currentCount}/${maxWorkers})`,
      'MAX_WORKERS_REACHED',
      { maxWorkers, currentCount, ...context }
    );
  }

  /**
   * Create error for health check failure
   */
  static healthCheckFailed(
    workerId: string,
    cause: Error,
    context?: Record<string, unknown>
  ): WorkerError {
    return new WorkerError(
      `Health check failed: ${cause.message}`,
      'HEALTH_CHECK_FAILED',
      { workerId, ...context },
      cause
    );
  }

  /**
   * Create error for health check timeout
   */
  static healthCheckTimeout(
    workerId: string,
    timeoutMs: number,
    context?: Record<string, unknown>
  ): WorkerError {
    return new WorkerError(`Health check timed out after ${timeoutMs}ms`, 'HEALTH_CHECK_TIMEOUT', {
      workerId,
      timeoutMs,
      ...context,
    });
  }

  /**
   * Create error for invalid state transition
   */
  static invalidState(
    currentState: string,
    attemptedOperation: string,
    context?: Record<string, unknown>
  ): WorkerError {
    return new WorkerError(
      `Invalid operation "${attemptedOperation}" in state "${currentState}"`,
      'INVALID_STATE',
      { currentState, attemptedOperation, ...context }
    );
  }

  /**
   * Create error for generic operation failure
   */
  static operationFailed(
    operation: string,
    cause: Error,
    context?: Record<string, unknown>
  ): WorkerError {
    return new WorkerError(
      `Operation failed: ${operation} - ${cause.message}`,
      'OPERATION_FAILED',
      { operation, ...context },
      cause
    );
  }
}
