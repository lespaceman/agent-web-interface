/**
 * Layout Handler
 *
 * Handles layout_get_box_model and layout_is_visible tools
 */

import type {
  LayoutGetBoxModelParams,
  LayoutGetBoxModelResponse,
  LayoutIsVisibleParams,
  LayoutIsVisibleResponse,
} from '../perception.types.js';
import type {
  ElementResolverService,
  VisibilityCheckerService,
} from '../../../shared/services/index.js';
import type { BBox } from '../../../shared/types/index.js';

interface CdpBridge {
  executeDevToolsMethod<T>(method: string, params?: unknown): Promise<T>;
}

interface BoxModelResult {
  model: {
    content: number[];
    padding: number[];
    border: number[];
    margin: number[];
    width: number;
    height: number;
  };
}

export class LayoutHandler {
  constructor(
    private readonly cdpBridge: CdpBridge,
    private readonly elementResolver: ElementResolverService,
    private readonly visibilityChecker: VisibilityCheckerService
  ) {}

  /**
   * Get box model (bounding box and quads) for an element
   */
  async getBoxModel(params: LayoutGetBoxModelParams): Promise<LayoutGetBoxModelResponse> {
    // Resolve the target to an ElementRef with nodeId
    const element = await this.elementResolver.resolve(params.target);

    if (!element.nodeId) {
      throw new Error('Could not resolve element nodeId');
    }

    // Get box model from CDP
    const result = await this.cdpBridge.executeDevToolsMethod<BoxModelResult>('DOM.getBoxModel', {
      nodeId: element.nodeId,
    });

    // Extract quad and bbox
    const quad = result.model.content;
    const bbox = this.quadToBBox(quad);

    return {
      quad,
      bbox,
    };
  }

  /**
   * Check if an element is visible
   */
  async isVisible(params: LayoutIsVisibleParams): Promise<LayoutIsVisibleResponse> {
    // Resolve the target to an ElementRef with nodeId
    const element = await this.elementResolver.resolve(params.target);

    // Use visibility checker service
    const visible = await this.visibilityChecker.isVisible(element);

    return {
      visible,
    };
  }

  /**
   * Convert CDP quad to BBox
   */
  private quadToBBox(quad: number[]): BBox {
    const x = Math.min(quad[0], quad[2], quad[4], quad[6]);
    const y = Math.min(quad[1], quad[3], quad[5], quad[7]);
    const maxX = Math.max(quad[0], quad[2], quad[4], quad[6]);
    const maxY = Math.max(quad[1], quad[3], quad[5], quad[7]);
    const w = maxX - x;
    const h = maxY - y;

    return { x, y, w, h };
  }
}
