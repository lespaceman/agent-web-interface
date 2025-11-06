/**
 * UI Discovery Handler
 *
 * Handles ui_discover tool - discovers interactive elements
 * FIXES the stub implementation that returned empty arrays
 */

import type { UiDiscoverParams, UiDiscoverResponse } from '../perception.types.js';
import type { ElementFusionService } from '../../../shared/services/index.js';
import type { DomTreeHandler } from './dom-tree.handler.js';
import type { AxTreeHandler } from './ax-tree.handler.js';

export class UiDiscoverHandler {
  constructor(
    private readonly domTreeHandler: DomTreeHandler,
    private readonly axTreeHandler: AxTreeHandler,
    private readonly elementFusion: ElementFusionService
  ) {}

  /**
   * Discover interactive elements by fusing DOM + AX + layout data
   */
  async handle(params: UiDiscoverParams): Promise<UiDiscoverResponse> {
    // Step 1: Get DOM tree
    const domTree = await this.domTreeHandler.handle({
      frameId: 'main',
      depth: -1, // Full tree
      visibleOnly: false,
    });

    // Step 2: Get accessibility tree
    const axTree = await this.axTreeHandler.handle({
      frameId: 'main',
    });

    // Step 3: Fuse trees and discover interactive elements
    const elements = await this.elementFusion.discover(axTree, domTree, params.scope);

    return {
      elements,
    };
  }
}
