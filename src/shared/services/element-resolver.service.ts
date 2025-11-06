/**
 * Element Resolver Service
 *
 * Resolves LocatorHints to concrete ElementRefs by querying the DOM
 * and populating selectors, nodeIds, and metadata.
 *
 * FIXES: The stub implementation in browser-automation-mcp-server.ts:690-724
 * that returned incomplete ElementRefs without actually querying the DOM.
 */

import type { ElementRef, LocatorHint, Selectors, BBox } from '../types/index.js';
import type { SelectorBuilderService } from './selector-builder.service.js';

interface CdpBridge {
  executeDevToolsMethod<T>(method: string, params?: unknown): Promise<T>;
}

interface DomQueryResult {
  nodeId: number;
}

interface BoxModelResult {
  model: {
    content: number[];
    width: number;
    height: number;
  };
}

interface NodeAttributesResult {
  attributes: string[];
}

export class ElementResolverService {
  constructor(
    private readonly cdpBridge: CdpBridge,
    private readonly selectorBuilder: SelectorBuilderService
  ) {}

  /**
   * Resolve a LocatorHint to a concrete ElementRef
   *
   * This method:
   * 1. If already an ElementRef, validates and returns it
   * 2. Otherwise queries the DOM using the hint
   * 3. Populates all selectors (CSS, XPath, AX)
   * 4. Gets the nodeId for CDP operations
   * 5. Retrieves bbox, role, label, name
   */
  async resolve(hint: ElementRef | LocatorHint, frameId = 'main'): Promise<ElementRef> {
    // Write to file for debugging since stderr isn't visible through MCP
    try {
      await import('fs/promises').then((fs) =>
        fs.appendFile(
          '/tmp/mcp-debug.log',
          `[${new Date().toISOString()}] ElementResolver.resolve\n` +
            `  hint: ${JSON.stringify(hint, null, 2)}\n` +
            `  type: ${typeof hint}\n` +
            `  keys: ${JSON.stringify(Object.keys(hint || {}))}\n\n`
        )
      );
    } catch {
      /* ignore file write errors */
    }

    console.error('[ElementResolver.resolve] Received hint:', JSON.stringify(hint, null, 2));
    console.error('[ElementResolver.resolve] Hint type:', typeof hint);
    console.error('[ElementResolver.resolve] Hint keys:', Object.keys(hint || {}));

    // If already an ElementRef, validate and return
    if (this.isElementRef(hint)) {
      return this.validateElementRef(hint);
    }

    // Try to find element using provided hints
    const nodeId = await this.findNodeId(hint, frameId);
    if (!nodeId) {
      throw new Error(`Could not resolve element from hint: ${JSON.stringify(hint)}`);
    }

    // Build comprehensive selectors for the element
    const selectors = await this.buildSelectors(nodeId, hint, frameId);

    // Get bounding box
    const bbox = await this.getBoundingBox(nodeId);

    // Get accessibility metadata
    const metadata = await this.getAccessibilityMetadata(nodeId);

    return {
      frameId,
      nodeId,
      selectors,
      bbox,
      ...metadata,
    };
  }

  /**
   * Find the CDP nodeId for an element using various strategies
   */
  private async findNodeId(hint: LocatorHint, frameId: string): Promise<number | null> {
    // Strategy 1: Direct selector (CSS, XPath)
    if ('css' in hint && hint.css) {
      const result = await this.queryByCss(hint.css, frameId);
      if (result) return result;
    }

    if ('xpath' in hint && hint.xpath) {
      const result = await this.queryByXPath(hint.xpath, frameId);
      if (result) return result;
    }

    // Strategy 2: Accessibility attributes (role, label, name)
    if ('role' in hint || 'label' in hint || 'name' in hint) {
      const result = await this.queryByAccessibility(hint, frameId);
      if (result) return result;
    }

    // Strategy 3: Bounding box (find element at coordinates)
    if ('bbox' in hint && hint.bbox) {
      const result = await this.queryByBoundingBox(hint.bbox, frameId);
      if (result) return result;
    }

    return null;
  }

  /**
   * Query element by CSS selector
   */
  private async queryByCss(css: string, _frameId: string): Promise<number | null> {
    try {
      const result = await this.cdpBridge.executeDevToolsMethod<DomQueryResult>(
        'DOM.querySelector',
        {
          nodeId: await this.getDocumentNodeId(),
          selector: css,
        }
      );
      return result.nodeId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Query element by XPath
   */
  private async queryByXPath(xpath: string, _frameId: string): Promise<number | null> {
    try {
      // Use Runtime.evaluate to execute XPath
      const result = await this.cdpBridge.executeDevToolsMethod<{
        result: { objectId?: string };
      }>('Runtime.evaluate', {
        expression: `
          (function() {
            const result = document.evaluate(
              ${JSON.stringify(xpath)},
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            );
            return result.singleNodeValue;
          })()
        `,
        returnByValue: false,
      });

      if (result.result.objectId) {
        // Get nodeId from objectId
        const nodeInfo = await this.cdpBridge.executeDevToolsMethod<{ node: { nodeId: number } }>(
          'DOM.describeNode',
          { objectId: result.result.objectId }
        );
        return nodeInfo.node.nodeId;
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Query element by accessibility attributes (role, label, name)
   *
   * Uses the Accessibility tree API to find elements by their computed accessible
   * name and role, which is more reliable than DOM attribute matching.
   */
  private async queryByAccessibility(hint: LocatorHint, _frameId: string): Promise<number | null> {
    try {
      // First, get the full accessibility tree
      // CDP returns role and name as either string or {type, value} objects
      const axTree = await this.cdpBridge.executeDevToolsMethod<{
        nodes: {
          nodeId: string;
          role?: string | { type: string; value: string };
          name?: string | { type: string; value: string };
          backendDOMNodeId?: number;
        }[];
      }>('Accessibility.getFullAXTree', {});

      // Find matching node in accessibility tree
      for (const node of axTree.nodes) {
        let matches = true;

        // Check role match - extract string value from CDP format
        if ('role' in hint && hint.role) {
          const nodeRole = this.extractAxValue(node.role);
          if (!nodeRole || nodeRole !== hint.role) {
            matches = false;
          }
        }

        // Check name match (accessible name from ui_discover)
        if ('name' in hint && hint.name && matches) {
          const nodeName = this.extractAxValue(node.name);
          if (!nodeName || nodeName !== hint.name) {
            matches = false;
          }
        }

        // Check label match (similar to name)
        if ('label' in hint && hint.label && matches) {
          const nodeName = this.extractAxValue(node.name);
          if (!nodeName || nodeName !== hint.label) {
            matches = false;
          }
        }

        // If all conditions match, get the DOM nodeId
        if (matches && node.backendDOMNodeId) {
          // Push the node to get its nodeId
          const pushResult = await this.cdpBridge.executeDevToolsMethod<{
            nodeId: number;
          }>('DOM.pushNodeByBackendIdToFrontend', {
            backendNodeId: node.backendDOMNodeId,
          });
          return pushResult.nodeId;
        }
      }
    } catch {
      // Fallback to DOM-based query if accessibility tree is not available
      return this.queryByAccessibilityFallback(hint);
    }
    return null;
  }

  /**
   * Fallback method for accessibility queries using DOM attributes
   * Also handles nearText proximity matching
   */
  private async queryByAccessibilityFallback(hint: LocatorHint): Promise<number | null> {
    try {
      const conditions: string[] = [];

      if ('role' in hint && hint.role) {
        conditions.push(`element.getAttribute('role') === ${JSON.stringify(hint.role)}`);
      }

      if ('label' in hint && hint.label) {
        conditions.push(
          `(element.getAttribute('aria-label') === ${JSON.stringify(hint.label)} || element.textContent?.trim() === ${JSON.stringify(hint.label)})`
        );
      }

      if ('name' in hint && hint.name) {
        conditions.push(
          `(element.getAttribute('name') === ${JSON.stringify(hint.name)} || element.getAttribute('aria-label') === ${JSON.stringify(hint.name)})`
        );
      }

      if ('nearText' in hint && hint.nearText) {
        // Match elements that contain or are near the specified text
        conditions.push(
          `(element.textContent?.includes(${JSON.stringify(hint.nearText)}) || element.getAttribute('aria-label')?.includes(${JSON.stringify(hint.nearText)}))`
        );
      }

      // If no conditions, cannot proceed
      if (conditions.length === 0) {
        return null;
      }

      const expression = `
        (function() {
          const elements = Array.from(document.querySelectorAll('*'));
          return elements.find(element => ${conditions.join(' && ')});
        })()
      `;

      const result = await this.cdpBridge.executeDevToolsMethod<{
        result: { objectId?: string };
      }>('Runtime.evaluate', {
        expression,
        returnByValue: false,
      });

      if (result.result.objectId) {
        const nodeInfo = await this.cdpBridge.executeDevToolsMethod<{ node: { nodeId: number } }>(
          'DOM.describeNode',
          { objectId: result.result.objectId }
        );
        return nodeInfo.node.nodeId;
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Query element by bounding box (find element at center of bbox)
   */
  private async queryByBoundingBox(bbox: BBox, _frameId: string): Promise<number | null> {
    try {
      const centerX = bbox.x + bbox.w / 2;
      const centerY = bbox.y + bbox.h / 2;

      const result = await this.cdpBridge.executeDevToolsMethod<{
        result: { objectId?: string };
      }>('Runtime.evaluate', {
        expression: `document.elementFromPoint(${centerX}, ${centerY})`,
        returnByValue: false,
      });

      if (result.result.objectId) {
        const nodeInfo = await this.cdpBridge.executeDevToolsMethod<{ node: { nodeId: number } }>(
          'DOM.describeNode',
          { objectId: result.result.objectId }
        );
        return nodeInfo.node.nodeId;
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Build comprehensive selectors for an element
   */
  private async buildSelectors(
    nodeId: number,
    hint: LocatorHint,
    frameId: string
  ): Promise<Selectors> {
    // Start with any selectors provided in the hint
    const selectors: Selectors = {};

    if ('css' in hint && hint.css) {
      selectors.css = hint.css;
    }
    if ('xpath' in hint && hint.xpath) {
      selectors.xpath = hint.xpath;
    }
    if ('ax' in hint && hint.ax) {
      selectors.ax = hint.ax;
    }

    // Generate missing selectors using the selector builder
    const generated = await this.selectorBuilder.buildSelectors(nodeId, frameId);

    return {
      css: selectors.css ?? generated.css,
      xpath: selectors.xpath ?? generated.xpath,
      ax: selectors.ax ?? generated.ax,
    };
  }

  /**
   * Get bounding box for an element
   */
  private async getBoundingBox(nodeId: number): Promise<BBox | undefined> {
    try {
      const result = await this.cdpBridge.executeDevToolsMethod<BoxModelResult>('DOM.getBoxModel', {
        nodeId,
      });

      const quad = result.model.content;
      const x = Math.min(quad[0], quad[2], quad[4], quad[6]);
      const y = Math.min(quad[1], quad[3], quad[5], quad[7]);
      const w = result.model.width;
      const h = result.model.height;

      return { x, y, w, h };
    } catch {
      return undefined;
    }
  }

  /**
   * Get accessibility metadata (role, label, name)
   */
  private async getAccessibilityMetadata(
    nodeId: number
  ): Promise<{ role?: string; label?: string; name?: string }> {
    try {
      // Get element attributes
      const attrResult = await this.cdpBridge.executeDevToolsMethod<NodeAttributesResult>(
        'DOM.getAttributes',
        { nodeId }
      );

      const attributes = this.parseAttributes(attrResult.attributes);

      return {
        role: attributes.role ?? attributes['aria-role'],
        label: attributes['aria-label'] ?? attributes['aria-labelledby'],
        name: attributes.name ?? attributes['aria-name'],
      };
    } catch {
      return {};
    }
  }

  /**
   * Parse CDP attributes array to key-value pairs
   */
  private parseAttributes(attrs: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < attrs.length; i += 2) {
      result[attrs[i]] = attrs[i + 1];
    }
    return result;
  }

  /**
   * Get the document nodeId
   */
  private async getDocumentNodeId(): Promise<number> {
    const result = await this.cdpBridge.executeDevToolsMethod<{
      root: { nodeId: number };
    }>('DOM.getDocument', { depth: 0 });
    return result.root.nodeId;
  }

  /**
   * Validate that an ElementRef still exists in the DOM
   */
  private async validateElementRef(element: ElementRef): Promise<ElementRef> {
    // If we have a nodeId, verify it still exists
    if (element.nodeId) {
      try {
        await this.cdpBridge.executeDevToolsMethod('DOM.resolveNode', {
          nodeId: element.nodeId,
        });
        return element; // Node still exists
      } catch {
        // Node is stale, try to re-resolve using selectors
      }
    }

    // Try to re-resolve using selectors
    if (element.selectors.css || element.selectors.xpath) {
      return this.resolve(
        {
          css: element.selectors.css,
          xpath: element.selectors.xpath,
        },
        element.frameId
      );
    }

    return element;
  }

  /**
   * Extract string value from CDP accessibility value
   * CDP can return values as either string or {type, value} object
   */
  private extractAxValue(
    value: string | { type: string; value: string } | undefined
  ): string | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && 'value' in value) return value.value;
    return undefined;
  }

  /**
   * Type guard to check if a value is an ElementRef
   */
  private isElementRef(value: ElementRef | LocatorHint): value is ElementRef {
    return (value as ElementRef).selectors !== undefined;
  }
}
