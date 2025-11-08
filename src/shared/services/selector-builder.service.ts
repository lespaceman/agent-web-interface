/**
 * Selector Builder Service
 *
 * Generates CSS, XPath, and accessibility selectors for DOM elements
 */

import type { Selectors } from '../types/index.js';

interface CdpBridge {
  executeDevToolsMethod<T>(method: string, params?: unknown): Promise<T>;
}

interface NodeDescription {
  node: {
    nodeId: number;
    nodeName: string;
    localName: string;
    attributes?: string[];
  };
}

export class SelectorBuilderService {
  constructor(private readonly cdpBridge: CdpBridge) {}

  /**
   * Build comprehensive selectors for a given node
   */
  async buildSelectors(nodeId: number, _frameId: string): Promise<Selectors> {
    const [css, xpath, ax] = await Promise.all([
      this.buildCssSelector(nodeId),
      this.buildXPathSelector(nodeId),
      this.buildAccessibilitySelector(nodeId),
    ]);

    return { css, xpath, ax };
  }

  /**
   * Build a CSS selector for an element
   * Strategy: Use ID if available, otherwise build a path using classes/nth-child
   */
  private async buildCssSelector(nodeId: number): Promise<string | undefined> {
    try {
      const nodeInfo = await this.getNodeDescription(nodeId);
      const attributes = this.parseAttributes(nodeInfo.node.attributes ?? []);

      // Strategy 1: Use ID (most specific)
      if (attributes.id) {
        return `#${attributes.id}`;
      }

      // Strategy 2: Use unique class combination
      if (attributes.class) {
        const classes = attributes.class.split(/\s+/).filter(Boolean);
        if (classes.length > 0) {
          const classSelector = `.${classes.join('.')}`;
          const isUnique = await this.isSelectorUnique(classSelector);
          if (isUnique) {
            return classSelector;
          }
        }
      }

      // Strategy 3: Build a path using tag names and nth-child
      const path = await this.buildCssPath(nodeId);
      return path;
    } catch {
      return undefined;
    }
  }

  /**
   * Build a CSS path using tag names and nth-child
   */
  private async buildCssPath(nodeId: number): Promise<string> {
    const segments: string[] = [];
    let currentNodeId = nodeId;

    try {
      while (currentNodeId) {
        const nodeInfo = await this.getNodeDescription(currentNodeId);
        const tagName = nodeInfo.node.localName.toLowerCase();

        // Get the nth-child position
        const position = await this.getNthChildPosition(currentNodeId);

        if (tagName === 'html') {
          segments.unshift('html');
          break;
        }

        if (position > 1) {
          segments.unshift(`${tagName}:nth-child(${position})`);
        } else {
          segments.unshift(tagName);
        }

        // Get parent node
        const parent = await this.getParentNode(currentNodeId);
        if (!parent) break;
        currentNodeId = parent;
      }

      return segments.join(' > ');
    } catch {
      return 'body';
    }
  }

  /**
   * Build an XPath selector for an element
   */
  private async buildXPathSelector(nodeId: number): Promise<string | undefined> {
    try {
      const segments: string[] = [];
      let currentNodeId = nodeId;

      while (currentNodeId) {
        const nodeInfo = await this.getNodeDescription(currentNodeId);
        const tagName = nodeInfo.node.localName.toLowerCase();
        const attributes = this.parseAttributes(nodeInfo.node.attributes ?? []);

        // Use ID if available
        if (attributes.id) {
          segments.unshift(`//*[@id="${attributes.id}"]`);
          break;
        }

        // Get position among siblings
        const position = await this.getNthChildPosition(currentNodeId);

        if (tagName === 'html') {
          segments.unshift('/html');
          break;
        }

        segments.unshift(`/${tagName}[${position}]`);

        // Get parent node
        const parent = await this.getParentNode(currentNodeId);
        if (!parent) break;
        currentNodeId = parent;
      }

      return segments.join('');
    } catch {
      return undefined;
    }
  }

  /**
   * Build an accessibility selector (role-based)
   */
  private async buildAccessibilitySelector(nodeId: number): Promise<string | undefined> {
    try {
      const nodeInfo = await this.getNodeDescription(nodeId);
      const attributes = this.parseAttributes(nodeInfo.node.attributes ?? []);

      const role = attributes.role ?? attributes['aria-role'];
      const label = attributes['aria-label'];
      const name = attributes.name;

      if (role && label) {
        return `role=${role}[label="${label}"]`;
      }
      if (role && name) {
        return `role=${role}[name="${name}"]`;
      }
      if (role) {
        return `role=${role}`;
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Get node description from CDP
   */
  private async getNodeDescription(nodeId: number): Promise<NodeDescription> {
    return this.cdpBridge.executeDevToolsMethod<NodeDescription>('DOM.describeNode', {
      nodeId,
    });
  }

  /**
   * Get parent node ID
   */
  private async getParentNode(nodeId: number): Promise<number | null> {
    try {
      const resolved = await this.cdpBridge.executeDevToolsMethod<{
        object: { objectId?: string };
      }>('DOM.resolveNode', { nodeId });
      const objectId = resolved.object?.objectId;
      if (!objectId) {
        return null;
      }

      const parentResult = await this.cdpBridge.executeDevToolsMethod<{
        result: { objectId?: string };
      }>('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: 'function() { return this.parentElement; }',
        returnByValue: false,
      });

      const parentObjectId = parentResult.result.objectId;
      if (!parentObjectId) {
        return null;
      }

      const parentNode = await this.cdpBridge.executeDevToolsMethod<{
        node: { nodeId: number };
      }>('DOM.describeNode', {
        objectId: parentObjectId,
      });

      return parentNode.node.nodeId;
    } catch {
      return null;
    }
  }

  /**
   * Get the nth-child position of a node among its siblings
   */
  private async getNthChildPosition(nodeId: number): Promise<number> {
    try {
      const resolved = await this.cdpBridge.executeDevToolsMethod<{
        object: { objectId?: string };
      }>('DOM.resolveNode', { nodeId });
      const objectId = resolved.object?.objectId;
      if (!objectId) return 1;

      const result = await this.cdpBridge.executeDevToolsMethod<{
        result: { value?: number };
      }>('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `
          function() {
            if (!this.parentElement) {
              return 1;
            }
            const siblings = Array.from(this.parentElement.children).filter(
              (child) => child.tagName === this.tagName
            );
            const index = siblings.indexOf(this);
            return index === -1 ? 1 : index + 1;
          }
        `,
        returnByValue: true,
      });

      return result.result.value ?? 1;
    } catch {
      return 1;
    }
  }

  /**
   * Check if a CSS selector uniquely identifies a single element
   */
  private async isSelectorUnique(selector: string): Promise<boolean> {
    try {
      const result = await this.cdpBridge.executeDevToolsMethod<{
        result: { value?: number };
      }>('Runtime.evaluate', {
        expression: `document.querySelectorAll(${JSON.stringify(selector)}).length`,
        returnByValue: true,
      });

      return result.result.value === 1;
    } catch {
      return false;
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
}
