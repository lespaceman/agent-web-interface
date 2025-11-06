/**
 * DOM Transformer Service
 *
 * Transforms CDP DOM.getDocument responses into our DomTreeNode format
 *
 * FIXES: The stub implementation in browser-automation-mcp-server.ts:731-736
 * that returned { nodes: [] } without transforming the CDP response
 */

import type { DomTreeNode } from '../types/index.js';

/**
 * CDP DOM Node structure
 */
interface CdpDomNode {
  nodeId: number;
  nodeType: number; // 1=ELEMENT, 3=TEXT, 9=DOCUMENT, etc.
  nodeName: string;
  localName: string;
  nodeValue: string;
  childNodeCount?: number;
  children?: CdpDomNode[];
  attributes?: string[];
  documentURL?: string;
  baseURL?: string;
}

interface CdpDomTreeResponse {
  root: CdpDomNode;
}

export interface DomGetTreeParams {
  frameId?: string;
  depth?: number;
  visibleOnly?: boolean;
}

export interface DomGetTreeResponse {
  nodes: DomTreeNode[];
}

export class DomTransformerService {
  /**
   * Transform CDP DOM.getDocument response into our DomTreeNode format
   */
  transform(cdpResponse: CdpDomTreeResponse, params: DomGetTreeParams): DomGetTreeResponse {
    const nodes: DomTreeNode[] = [];
    const maxDepth = params.depth ?? -1; // -1 means infinite depth

    this.transformNode(cdpResponse.root, 0, maxDepth, nodes, params.visibleOnly ?? false);

    return { nodes };
  }

  /**
   * Recursively transform a CDP node and its children
   */
  private transformNode(
    cdpNode: CdpDomNode,
    currentDepth: number,
    maxDepth: number,
    nodes: DomTreeNode[],
    visibleOnly: boolean
  ): void {
    // For document nodes (nodeType === 9), just process children
    if (cdpNode.nodeType === 9) {
      if (cdpNode.children && cdpNode.children.length > 0) {
        for (const child of cdpNode.children) {
          this.transformNode(child, currentDepth, maxDepth, nodes, visibleOnly);
        }
      }
      return;
    }

    // Skip non-element nodes unless they're text nodes
    if (cdpNode.nodeType !== 1 && cdpNode.nodeType !== 3) {
      return;
    }

    // Check depth limit
    if (maxDepth >= 0 && currentDepth > maxDepth) {
      return;
    }

    // For element nodes (nodeType === 1)
    if (cdpNode.nodeType === 1) {
      const attributesArray = cdpNode.attributes ?? [];
      const attributesMap = this.parseAttributes(attributesArray);

      // Skip if visibleOnly is true and element has display:none or visibility:hidden
      if (visibleOnly && this.isHiddenByStyle(attributesMap)) {
        return;
      }

      const node: DomTreeNode = {
        id: `node-${cdpNode.nodeId}`,
        nodeId: cdpNode.nodeId,
        tag:
          cdpNode.localName && cdpNode.localName.length > 0
            ? cdpNode.localName
            : cdpNode.nodeName.toLowerCase(),
        attrs: attributesArray,
        children: [],
      };

      // Add text content if this is a leaf node with text
      const textContent = this.extractTextContent(cdpNode);
      if (textContent) {
        node.text = textContent;
      }

      // Recursively process children
      if (cdpNode.children && cdpNode.children.length > 0) {
        for (const child of cdpNode.children) {
          const childNodes: DomTreeNode[] = [];
          this.transformNode(child, currentDepth + 1, maxDepth, childNodes, visibleOnly);
          if (node.children) {
            node.children.push(...childNodes);
          }
        }
      }

      nodes.push(node);
    }
    // For text nodes (nodeType === 3)
    else if (cdpNode.nodeType === 3 && cdpNode.nodeValue) {
      const trimmedText = cdpNode.nodeValue.trim();
      if (trimmedText) {
        // Text nodes are represented as special nodes
        const textNode: DomTreeNode = {
          id: `text-${cdpNode.nodeId}`,
          tag: '#text',
          attrs: [],
          text: trimmedText,
          children: [],
        };
        nodes.push(textNode);
      }
    }
  }

  /**
   * Parse CDP attributes array [key1, value1, key2, value2, ...] to object
   */
  private parseAttributes(attrs: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < attrs.length; i += 2) {
      result[attrs[i]] = attrs[i + 1];
    }
    return result;
  }

  /**
   * Check if element is hidden by inline style
   */
  private isHiddenByStyle(attributes: Record<string, string>): boolean {
    const style = attributes.style || '';
    return (
      style.includes('display:none') ||
      style.includes('display: none') ||
      style.includes('visibility:hidden') ||
      style.includes('visibility: hidden')
    );
  }

  /**
   * Extract text content from immediate text children
   */
  private extractTextContent(cdpNode: CdpDomNode): string | undefined {
    if (!cdpNode.children || cdpNode.children.length === 0) {
      return undefined;
    }

    const textParts: string[] = [];

    for (const child of cdpNode.children) {
      if (child.nodeType === 3 && child.nodeValue) {
        const trimmed = child.nodeValue.trim();
        if (trimmed) {
          textParts.push(trimmed);
        }
      }
    }

    if (textParts.length === 0) {
      return undefined;
    }

    return textParts.join(' ');
  }

  /**
   * Flatten tree structure into array (breadth-first traversal)
   */
  flattenTree(nodes: DomTreeNode[]): DomTreeNode[] {
    const flattened: DomTreeNode[] = [];
    const queue: DomTreeNode[] = [...nodes];

    while (queue.length > 0) {
      const node = queue.shift()!;
      flattened.push(node);

      if (node.children && node.children.length > 0) {
        queue.push(...node.children);
      }
    }

    return flattened;
  }

  /**
   * Filter nodes by tag name
   */
  filterByTag(nodes: DomTreeNode[], tag: string): DomTreeNode[] {
    const results: DomTreeNode[] = [];

    for (const node of nodes) {
      if (node.tag === tag) {
        results.push(node);
      }
      if (node.children && node.children.length > 0) {
        results.push(...this.filterByTag(node.children, tag));
      }
    }

    return results;
  }

  /**
   * Find nodes by attribute
   */
  findByAttribute(nodes: DomTreeNode[], attrName: string, attrValue?: string): DomTreeNode[] {
    const results: DomTreeNode[] = [];

    for (const node of nodes) {
      // attrs is an array like [key1, value1, key2, value2, ...]
      if (node.attrs) {
        const index = node.attrs.indexOf(attrName);
        if (index !== -1) {
          if (attrValue !== undefined) {
            // Check if the value matches
            if (index + 1 < node.attrs.length && node.attrs[index + 1] === attrValue) {
              results.push(node);
            }
          } else {
            // Just checking if attribute exists
            results.push(node);
          }
        }
      }

      if (node.children && node.children.length > 0) {
        results.push(...this.findByAttribute(node.children, attrName, attrValue));
      }
    }

    return results;
  }
}
