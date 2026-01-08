/**
 * Region Resolver Tests
 *
 * Tests for semantic page region detection.
 */

import { describe, it, expect } from 'vitest';
import { resolveRegion } from '../../../../src/snapshot/extractors/region-resolver.js';
import type { RawDomNode, RawAxNode } from '../../../../src/snapshot/extractors/types.js';

describe('Region Resolver', () => {
  describe('resolveRegion', () => {
    it('should detect header from DOM tag', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'HEADER',
        nodeType: 1,
      };

      const result = resolveRegion(domNode, undefined, new Map());

      expect(result).toBe('header');
    });

    it('should detect nav from DOM tag', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'NAV',
        nodeType: 1,
      };

      const result = resolveRegion(domNode, undefined, new Map());

      expect(result).toBe('nav');
    });

    it('should detect main from DOM tag', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'MAIN',
        nodeType: 1,
      };

      const result = resolveRegion(domNode, undefined, new Map());

      expect(result).toBe('main');
    });

    it('should detect aside from DOM tag', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'ASIDE',
        nodeType: 1,
      };

      const result = resolveRegion(domNode, undefined, new Map());

      expect(result).toBe('aside');
    });

    it('should detect footer from DOM tag', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'FOOTER',
        nodeType: 1,
      };

      const result = resolveRegion(domNode, undefined, new Map());

      expect(result).toBe('footer');
    });

    it('should detect banner from AX role', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'banner',
      };

      const result = resolveRegion(undefined, axNode, new Map());

      expect(result).toBe('header');
    });

    it('should detect navigation from AX role', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'navigation',
      };

      const result = resolveRegion(undefined, axNode, new Map());

      expect(result).toBe('nav');
    });

    it('should detect main from AX role', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'main',
      };

      const result = resolveRegion(undefined, axNode, new Map());

      expect(result).toBe('main');
    });

    it('should detect complementary as aside', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'complementary',
      };

      const result = resolveRegion(undefined, axNode, new Map());

      expect(result).toBe('aside');
    });

    it('should detect contentinfo as footer', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'contentinfo',
      };

      const result = resolveRegion(undefined, axNode, new Map());

      expect(result).toBe('footer');
    });

    it('should detect dialog from AX role', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'dialog',
      };

      const result = resolveRegion(undefined, axNode, new Map());

      expect(result).toBe('dialog');
    });

    it('should detect dialog from DOM tag', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'DIALOG',
        nodeType: 1,
      };

      const result = resolveRegion(domNode, undefined, new Map());

      expect(result).toBe('dialog');
    });

    it('should detect search from AX role', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'search',
      };

      const result = resolveRegion(undefined, axNode, new Map());

      expect(result).toBe('search');
    });

    it('should detect form from DOM tag', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'FORM',
        nodeType: 1,
      };

      const result = resolveRegion(domNode, undefined, new Map());

      expect(result).toBe('form');
    });

    it('should detect form from AX role', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'form',
      };

      const result = resolveRegion(undefined, axNode, new Map());

      expect(result).toBe('form');
    });

    it('should traverse ancestors to find region', () => {
      // Create a tree: HEADER > DIV > BUTTON
      const headerNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'HEADER',
        nodeType: 1,
        childNodeIds: [200],
      };

      const divNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'DIV',
        nodeType: 1,
        parentId: 100,
        childNodeIds: [300],
      };

      const buttonNode: RawDomNode = {
        nodeId: 3,
        backendNodeId: 300,
        nodeName: 'BUTTON',
        nodeType: 1,
        parentId: 200,
      };

      const domTree = new Map<number, RawDomNode>([
        [100, headerNode],
        [200, divNode],
        [300, buttonNode],
      ]);

      const result = resolveRegion(buttonNode, undefined, domTree);

      expect(result).toBe('header');
    });

    it('should prefer innermost region for nested landmarks', () => {
      // Create a tree: MAIN > NAV > BUTTON
      const mainNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'MAIN',
        nodeType: 1,
        childNodeIds: [200],
      };

      const navNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'NAV',
        nodeType: 1,
        parentId: 100,
        childNodeIds: [300],
      };

      const buttonNode: RawDomNode = {
        nodeId: 3,
        backendNodeId: 300,
        nodeName: 'BUTTON',
        nodeType: 1,
        parentId: 200,
      };

      const domTree = new Map<number, RawDomNode>([
        [100, mainNode],
        [200, navNode],
        [300, buttonNode],
      ]);

      const result = resolveRegion(buttonNode, undefined, domTree);

      // Should find nav first (innermost)
      expect(result).toBe('nav');
    });

    it('should return unknown for elements outside landmarks', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'DIV',
        nodeType: 1,
      };

      const result = resolveRegion(domNode, undefined, new Map());

      expect(result).toBe('unknown');
    });

    it('should handle undefined inputs', () => {
      const result = resolveRegion(undefined, undefined, new Map());

      expect(result).toBe('unknown');
    });

    it('should detect role from DOM attribute', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'DIV',
        nodeType: 1,
        attributes: { role: 'navigation' },
      };

      const result = resolveRegion(domNode, undefined, new Map());

      expect(result).toBe('nav');
    });

    it('should prefer AX role over DOM role attribute', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'DIV',
        nodeType: 1,
        attributes: { role: 'main' },
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'navigation',
      };

      const result = resolveRegion(domNode, axNode, new Map());

      expect(result).toBe('nav');
    });

    it('should inherit footer region from ancestor with AX contentinfo role', () => {
      // Create a tree: DIV (contentinfo AX role) > UL > LI > A
      // The DIV has no footer tag or role attribute, only AX contentinfo role
      const footerDiv: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'DIV',
        nodeType: 1,
        childNodeIds: [200],
      };

      const listNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'UL',
        nodeType: 1,
        parentId: 100,
        childNodeIds: [300],
      };

      const listItemNode: RawDomNode = {
        nodeId: 3,
        backendNodeId: 300,
        nodeName: 'LI',
        nodeType: 1,
        parentId: 200,
        childNodeIds: [400],
      };

      const linkNode: RawDomNode = {
        nodeId: 4,
        backendNodeId: 400,
        nodeName: 'A',
        nodeType: 1,
        parentId: 300,
      };

      // The footer DIV has contentinfo AX role
      const footerAxNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'contentinfo',
      };

      const domTree = new Map<number, RawDomNode>([
        [100, footerDiv],
        [200, listNode],
        [300, listItemNode],
        [400, linkNode],
      ]);

      const axTree = new Map<number, RawAxNode>([[100, footerAxNode]]);

      // The link should inherit footer region from the DIV ancestor
      // Even though the DIV doesn't have FOOTER tag or role attribute
      const result = resolveRegion(linkNode, undefined, domTree, axTree);

      expect(result).toBe('footer');
    });

    it('should detect footer region from deeply nested element in footer', () => {
      // Create: FOOTER > DIV > DIV > DIV > BUTTON
      const footerNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'FOOTER',
        nodeType: 1,
        childNodeIds: [200],
      };

      const div1: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'DIV',
        nodeType: 1,
        parentId: 100,
        childNodeIds: [300],
      };

      const div2: RawDomNode = {
        nodeId: 3,
        backendNodeId: 300,
        nodeName: 'DIV',
        nodeType: 1,
        parentId: 200,
        childNodeIds: [400],
      };

      const div3: RawDomNode = {
        nodeId: 4,
        backendNodeId: 400,
        nodeName: 'DIV',
        nodeType: 1,
        parentId: 300,
        childNodeIds: [500],
      };

      const buttonNode: RawDomNode = {
        nodeId: 5,
        backendNodeId: 500,
        nodeName: 'BUTTON',
        nodeType: 1,
        parentId: 400,
      };

      const domTree = new Map<number, RawDomNode>([
        [100, footerNode],
        [200, div1],
        [300, div2],
        [400, div3],
        [500, buttonNode],
      ]);

      const result = resolveRegion(buttonNode, undefined, domTree);

      expect(result).toBe('footer');
    });
  });
});
