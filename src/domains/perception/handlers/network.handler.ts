/**
 * Network Handler
 *
 * Handles net_observe and net_get_response_body tools
 */

import type {
  NetObserveParams,
  NetObserveResponse,
  NetGetResponseBodyParams,
  NetGetResponseBodyResponse,
} from '../perception.types.js';
import type { NetworkEvent } from '../../../shared/types/index.js';

interface CdpBridge {
  executeDevToolsMethod<T>(method: string, params?: unknown): Promise<T>;
  getObservedNetworkEvents(): NetworkEvent[];
}

export class NetworkHandler {
  constructor(private readonly cdpBridge: CdpBridge) {}

  /**
   * Observe network events
   *
   * Returns an async iterable of network events matching the patterns
   */
  async observe(params: NetObserveParams): Promise<NetObserveResponse> {
    // Enable Network domain in CDP
    await this.cdpBridge.executeDevToolsMethod('Network.enable', {});

    // Create async iterable of network events
    const events = this.observeNetworkEvents(params.patterns);

    return { events };
  }

  /**
   * Get response body for a specific network request
   */
  async getResponseBody(params: NetGetResponseBodyParams): Promise<NetGetResponseBodyResponse> {
    const result = await this.cdpBridge.executeDevToolsMethod<NetGetResponseBodyResponse>(
      'Network.getResponseBody',
      {
        requestId: params.requestId,
      }
    );

    return result;
  }

  /**
   * Create an async iterable of network events
   */
  private async *observeNetworkEvents(patterns?: string[]): AsyncIterable<NetworkEvent> {
    // This is a simplified implementation
    // In production, you would:
    // 1. Set up event listeners on the CDP client
    // 2. Filter events by patterns
    // 3. Yield events as they arrive

    // For now, just yield any observed events
    const events = this.cdpBridge.getObservedNetworkEvents();

    for (const event of events) {
      // Filter by patterns if provided
      if (patterns && patterns.length > 0) {
        const matches = patterns.some((pattern) => {
          const regex = new RegExp(pattern);
          return regex.test(event.url);
        });

        if (!matches) {
          continue;
        }
      }

      await Promise.resolve();
      yield event;
    }
  }
}
