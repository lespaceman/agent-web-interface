/**
 * Element Fusion Service
 *
 * Fuses DOM tree, Accessibility tree, and layout data to discover interactive elements
 *
 * FIXES: The stub implementation in browser-automation-mcp-server.ts:767
 * that returned Promise.resolve([])
 */

import type {
  ElementRef,
  AxTreeNode,
  DomTreeNode,
  LocatorHint,
  Selectors,
} from '../types/index.js';

/**
 * Interactive roles that should be discovered
 */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'checkbox',
  'switch',
  'tab',
  'slider',
  'spinbutton',
  'scrollbar',
]);

/**
 * Interactive tags that should be discovered
 */
const INTERACTIVE_TAGS = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'option',
  'details',
  'summary',
]);

interface ElementResolver {
  resolve(hint: ElementRef | LocatorHint, frameId?: string): Promise<ElementRef>;
}

interface SelectorBuilder {
  buildSelectors(nodeId: number, frameId: string): Promise<Selectors>;
}

export class ElementFusionService {
  constructor(
    private readonly elementResolver: ElementResolver,
    private readonly selectorBuilder: SelectorBuilder
  ) {}

  /**
   * Discover interactive elements by fusing DOM, AX, and layout trees
   */
  async discover(
    axTree: { nodes: AxTreeNode[] },
    domTree: { nodes: DomTreeNode[] },
    scope?: LocatorHint
  ): Promise<ElementRef[]> {
    const elements: ElementRef[] = [];

    // Strategy 1: Find elements from accessibility tree (most reliable for interactive elements)
    const axElements = await this.discoverFromAxTree(axTree.nodes);
    elements.push(...axElements);

    // Strategy 2: Find elements from DOM tree (catch elements not in AX tree)
    const domElements = await this.discoverFromDomTree(domTree.nodes);
    elements.push(...domElements);

    // Strategy 3: Deduplicate elements (same nodeId)
    const uniqueElements = this.deduplicateElements(elements);

    // Strategy 4: Filter by scope if provided
    const filteredElements = scope ? this.filterByScope(uniqueElements, scope) : uniqueElements;

    // Strategy 5: Enrich with layout information
    // TODO: Enrich with layout information (bounding boxes)
    // This requires access to CDP bridge which we don't have in this service
    return filteredElements;
  }

  /**
   * Discover interactive elements from accessibility tree
   */
  private async discoverFromAxTree(nodes: AxTreeNode[]): Promise<ElementRef[]> {
    const elements: ElementRef[] = [];

    for (const node of nodes) {
      // Check if this is an interactive role
      // Extract role as string (defensive check in case normalization failed)
      const role = this.extractRole(node.role);
      if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) {
        // Extract nodeId from the AX nodeId (format varies by implementation)
        const nodeId = this.extractNodeIdFromAxNode(node);
        if (!nodeId) continue;

        const element: ElementRef = {
          frameId: 'main',
          nodeId,
          selectors: await this.buildSelectorsForNode(nodeId),
          role,
          name: node.name,
        };

        elements.push(element);
      }
    }

    return elements;
  }

  /**
   * Discover interactive elements from DOM tree
   */
  private async discoverFromDomTree(nodes: DomTreeNode[]): Promise<ElementRef[]> {
    const elements: ElementRef[] = [];

    const traverse = async (node: DomTreeNode): Promise<void> => {
      // Check if this is an interactive tag
      if (INTERACTIVE_TAGS.has(node.tag.toLowerCase())) {
        const nodeId = this.extractNodeIdFromDomNode(node);
        if (nodeId) {
          const element: ElementRef = {
            frameId: 'main',
            nodeId,
            selectors: await this.buildSelectorsForNode(nodeId),
            role: this.getAttr(node, 'role'),
            label: this.getAttr(node, 'aria-label'),
            name: this.getAttr(node, 'name'),
          };

          elements.push(element);
        }
      }

      // Check for elements with click handlers (onclick, @click, etc.)
      const hasClickHandler = ['onclick', '@click', 'v-on:click', 'ng-click'].some(
        (attribute) => this.getAttr(node, attribute) !== undefined
      );

      if (hasClickHandler) {
        const nodeId = this.extractNodeIdFromDomNode(node);
        if (nodeId) {
          const roleAttr = this.getAttr(node, 'role');
          const element: ElementRef = {
            frameId: 'main',
            nodeId,
            selectors: await this.buildSelectorsForNode(nodeId),
            role: roleAttr && roleAttr.length > 0 ? roleAttr : 'clickable',
            label: this.getAttr(node, 'aria-label'),
            name: this.getAttr(node, 'name'),
          };

          elements.push(element);
        }
      }

      // Recursively process children
      if (node.children) {
        for (const child of node.children) {
          await traverse(child);
        }
      }
    };

    for (const node of nodes) {
      await traverse(node);
    }

    return elements;
  }

  /**
   * Extract CDP nodeId from AX node
   */
  private extractNodeIdFromAxNode(node: AxTreeNode): number | null {
    // Use backendDOMNodeId if available
    if (node.backendDOMNodeId) {
      return node.backendDOMNodeId;
    }

    // Fallback: try to parse nodeId
    if (node.nodeId) {
      const parsed = parseInt(node.nodeId, 10);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  /**
   * Extract CDP nodeId from DOM node - now directly available
   */
  private extractNodeIdFromDomNode(node: DomTreeNode): number | undefined {
    return node.nodeId;
  }

  /**
   * Legacy method - kept for compatibility
   */
  private extractNodeIdLegacy(node: DomTreeNode): number | null {
    // The node.id is in format "node-123" where 123 is the CDP nodeId
    const match = /^node-(\d+)$/.exec(node.id);
    if (match) {
      return parseInt(match[1], 10);
    }

    return null;
  }

  /**
   * Build selectors for a node
   */
  private async buildSelectorsForNode(nodeId: number): Promise<Selectors> {
    try {
      // Use the selector builder service
      return await this.selectorBuilder.buildSelectors(nodeId, 'main');
    } catch {
      return {};
    }
  }

  /**
   * Deduplicate elements by nodeId
   */
  private deduplicateElements(elements: ElementRef[]): ElementRef[] {
    const seen = new Set<number>();
    const unique: ElementRef[] = [];

    for (const element of elements) {
      if (element.nodeId && !seen.has(element.nodeId)) {
        seen.add(element.nodeId);
        unique.push(element);
      }
    }

    return unique;
  }

  /**
   * Filter elements by scope hint
   */
  private filterByScope(elements: ElementRef[], scope: LocatorHint): ElementRef[] {
    // If scope has role filter
    if ('role' in scope && scope.role) {
      return elements.filter((el) => el.role === scope.role);
    }

    // If scope has name filter
    if ('name' in scope && scope.name) {
      return elements.filter((el) => el.name === scope.name);
    }

    // If scope has label filter
    if ('label' in scope && scope.label) {
      return elements.filter((el) => el.label === scope.label);
    }

    // If scope has nearText, filter elements near that text
    if ('nearText' in scope && scope.nearText) {
      return this.filterByNearText(elements, scope.nearText);
    }

    return elements;
  }

  /**
   * Filter elements that are near specific text
   */
  private filterByNearText(elements: ElementRef[], text: string): ElementRef[] {
    // This is a simplified version - in production, you would:
    // 1. Find all text nodes containing the text
    // 2. Calculate distances to each element
    // 3. Return elements within a threshold distance

    // For now, just return elements that have matching label or name
    return elements.filter((el) => {
      const labelMatches = el.label?.includes(text) ?? false;
      const nameMatches = el.name?.includes(text) ?? false;
      const axMatches = el.selectors.ax?.includes(text) ?? false;
      return labelMatches || nameMatches || axMatches;
    });
  }

  /**
   * Parse CDP attributes array to object
   */
  private parseAttributes(attrs: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < attrs.length; i += 2) {
      result[attrs[i]] = attrs[i + 1];
    }
    return result;
  }

  /**
   * Get attribute value from DomTreeNode
   * attrs is an array like [key1, value1, key2, value2, ...]
   */
  private getAttr(node: DomTreeNode, attrName: string): string | undefined {
    if (!node.attrs) return undefined;
    const index = node.attrs.indexOf(attrName);
    if (index !== -1 && index + 1 < node.attrs.length) {
      return node.attrs[index + 1];
    }
    return undefined;
  }

  /**
   * Extract role as string (defensive check for CDP object structure)
   * CDP can sometimes return role as {type, value} even after normalization
   */
  private extractRole(role: unknown): string | undefined {
    if (!role) return undefined;
    if (typeof role === 'string') return role;
    // Handle {type, value} structure from CDP
    if (typeof role === 'object' && role !== null && 'value' in role) {
      const roleObj = role as { value: unknown };
      if (typeof roleObj.value === 'string') return roleObj.value;
    }
    return undefined;
  }
}
