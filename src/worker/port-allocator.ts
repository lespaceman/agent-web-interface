/**
 * Port Allocator
 *
 * Manages allocation and release of ports for Chrome CDP endpoints.
 * Tracks which ports are in use and provides the next available port.
 */

import { createServer } from 'net';
import type { PortRange } from './types.js';
import { WorkerError } from './errors/index.js';

/**
 * Configuration for PortAllocator
 */
export interface PortAllocatorConfig {
  /** Minimum port number (inclusive) */
  min: number;
  /** Maximum port number (inclusive) */
  max: number;
}

/**
 * Manages port allocation for Chrome CDP endpoints.
 *
 * @example
 * ```typescript
 * const allocator = new PortAllocator({ min: 9300, max: 9399 });
 *
 * const port1 = allocator.allocate();  // 9300
 * const port2 = allocator.allocate();  // 9301
 *
 * allocator.release(port1);            // Return 9300 to pool
 * const port3 = allocator.allocate();  // 9300 (reused)
 * ```
 */
export class PortAllocator {
  private readonly min: number;
  private readonly max: number;
  private readonly allocatedPorts = new Set<number>();

  constructor(config: PortAllocatorConfig) {
    if (config.min > config.max) {
      throw new Error(`Invalid port range: min (${config.min}) > max (${config.max})`);
    }
    if (config.min < 1 || config.max > 65535) {
      throw new Error(`Port range must be between 1 and 65535`);
    }
    this.min = config.min;
    this.max = config.max;
  }

  /**
   * Get the port range configuration
   */
  get portRange(): PortRange {
    return { min: this.min, max: this.max };
  }

  /**
   * Get the number of currently allocated ports
   */
  get allocatedCount(): number {
    return this.allocatedPorts.size;
  }

  /**
   * Get the total capacity (max possible allocations)
   */
  get capacity(): number {
    return this.max - this.min + 1;
  }

  /**
   * Allocate the next available port.
   *
   * @returns The allocated port number
   * @throws WorkerError with PORT_EXHAUSTED if no ports are available
   */
  allocate(): number {
    for (let port = this.min; port <= this.max; port++) {
      if (!this.allocatedPorts.has(port)) {
        this.allocatedPorts.add(port);
        return port;
      }
    }

    throw WorkerError.portExhausted(this.min, this.max, {
      allocatedCount: this.allocatedPorts.size,
      capacity: this.capacity,
    });
  }

  /**
   * Release a previously allocated port back to the pool.
   *
   * @param port - The port number to release
   * @returns true if the port was released, false if it wasn't allocated
   */
  release(port: number): boolean {
    return this.allocatedPorts.delete(port);
  }

  /**
   * Check if a specific port is currently allocated.
   *
   * @param port - The port number to check
   * @returns true if the port is allocated
   */
  isAllocated(port: number): boolean {
    return this.allocatedPorts.has(port);
  }

  /**
   * Check if a port is available for use by attempting to bind to it.
   * This verifies that no other process is using the port.
   *
   * @param port - The port number to check
   * @returns Promise that resolves to true if the port is available
   */
  async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();

      server.once('error', () => {
        resolve(false);
      });

      server.once('listening', () => {
        server.close(() => {
          resolve(true);
        });
      });

      server.listen(port, '127.0.0.1');
    });
  }

  /**
   * Allocate a port that is verified to be available on the system.
   * This is slower than allocate() but ensures the port can actually be used.
   *
   * @returns Promise that resolves to the allocated port number
   * @throws WorkerError with PORT_EXHAUSTED if no available ports are found
   */
  async allocateVerified(): Promise<number> {
    for (let port = this.min; port <= this.max; port++) {
      if (!this.allocatedPorts.has(port)) {
        // Reserve port before async check to prevent race condition
        this.allocatedPorts.add(port);
        const available = await this.isPortAvailable(port);
        if (available) {
          return port;
        }
        // Release if port is not actually available on the system
        this.allocatedPorts.delete(port);
      }
    }

    throw WorkerError.portExhausted(this.min, this.max, {
      allocatedCount: this.allocatedPorts.size,
      capacity: this.capacity,
      verified: true,
    });
  }

  /**
   * Get all currently allocated ports.
   *
   * @returns Array of allocated port numbers
   */
  getAllocatedPorts(): number[] {
    return Array.from(this.allocatedPorts).sort((a, b) => a - b);
  }

  /**
   * Reset the allocator, releasing all ports.
   */
  reset(): void {
    this.allocatedPorts.clear();
  }
}
