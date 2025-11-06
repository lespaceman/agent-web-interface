/**
 * DOM Tree Handler
 *
 * Handles dom_get_tree tool - extracts DOM tree structure
 */

import type { DomGetTreeParams, DomGetTreeResponse } from '../perception.types.js';
import type { DomTransformerService } from '../../../shared/services/index.js';

interface CdpBridge {
  executeDevToolsMethod<T>(method: string, params?: unknown): Promise<T>;
}

/**
 * CDP DOM Node structure (recursive)
 */
interface CdpDomNode {
  nodeId: number;
  nodeType: number;
  nodeName: string;
  localName: string;
  nodeValue: string;
  childNodeCount?: number;
  children?: CdpDomNode[];
  attributes?: string[];
}

interface CdpDomTreeResponse {
  root: CdpDomNode;
}

export class DomTreeHandler {
  constructor(
    private readonly cdpBridge: CdpBridge,
    private readonly domTransformer: DomTransformerService
  ) {}

  /**
   * Get DOM tree structure
   */
  async handle(params: DomGetTreeParams): Promise<DomGetTreeResponse> {
    const frameId = params.frameId ?? 'main';
    const depth = params.depth ?? -1; // -1 means infinite depth
    const visibleOnly = params.visibleOnly ?? false;

    // Limit the CDP depth to prevent excessive data transfer
    // Even if user requests -1 (infinite), cap it at a reasonable limit
    let cdpDepth = depth;
    if (depth === -1 || depth > 10) {
      cdpDepth = 10; // Cap at 10 levels for performance
    }

    // Call CDP to get the DOM tree with limited depth
    const cdpResponse = await this.cdpBridge.executeDevToolsMethod<CdpDomTreeResponse>(
      'DOM.getDocument',
      {
        depth: cdpDepth >= 0 ? cdpDepth + 1 : cdpDepth, // CDP depth is 0-based, +1 to include specified level
        pierce: true, // Pierce through shadow DOM and iframes
      }
    );

    // Transform CDP response to our DomTreeNode format
    const result = this.domTransformer.transform(cdpResponse, {
      frameId,
      depth,
      visibleOnly,
    });

    return result;
  }
}
