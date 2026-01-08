/**
 * Grouping Resolver Tests
 *
 * Tests for group hierarchy and heading context computation.
 */

import { describe, it, expect } from 'vitest';
import { resolveGrouping } from '../../../../src/snapshot/extractors/grouping-resolver.js';
import type {
  RawDomNode,
  RawAxNode,
  RawNodeData,
} from '../../../../src/snapshot/extractors/types.js';

describe('Grouping Resolver', () => {
  describe('resolveGrouping', () => {
    it('should detect form group', () => {
      const formNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'FORM',
        nodeType: 1,
        attributes: { id: 'login-form' },
        childNodeIds: [200],
      };

      const inputNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'INPUT',
        nodeType: 1,
        parentId: 100,
      };

      const domTree = new Map<number, RawDomNode>([
        [100, formNode],
        [200, inputNode],
      ]);

      const result = resolveGrouping(200, domTree, new Map(), []);

      expect(result.group_id).toBe('form-login-form');
    });

    it('should detect menu group from AX role', () => {
      const menuNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'UL',
        nodeType: 1,
        childNodeIds: [200],
      };

      const menuItemNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'LI',
        nodeType: 1,
        parentId: 100,
      };

      const menuAxNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'menu',
        name: 'Main Menu',
      };

      const domTree = new Map<number, RawDomNode>([
        [100, menuNode],
        [200, menuItemNode],
      ]);

      const axTree = new Map<number, RawAxNode>([[100, menuAxNode]]);

      const result = resolveGrouping(200, domTree, axTree, []);

      expect(result.group_id).toBe('menu-main-menu');
    });

    it('should detect card/article group', () => {
      const articleNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'ARTICLE',
        nodeType: 1,
        childNodeIds: [200],
      };

      const buttonNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'BUTTON',
        nodeType: 1,
        parentId: 100,
      };

      const domTree = new Map<number, RawDomNode>([
        [100, articleNode],
        [200, buttonNode],
      ]);

      const result = resolveGrouping(200, domTree, new Map(), []);

      expect(result.group_id).toContain('article');
    });

    it('should build group path from nested groups', () => {
      // Create: NAV > UL (menu) > LI > UL (submenu) > LI
      const navNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'NAV',
        nodeType: 1,
        attributes: { 'aria-label': 'Main' },
        childNodeIds: [200],
      };

      const mainMenuNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'UL',
        nodeType: 1,
        attributes: { 'aria-label': 'Categories' },
        parentId: 100,
        childNodeIds: [300],
      };

      const categoryNode: RawDomNode = {
        nodeId: 3,
        backendNodeId: 300,
        nodeName: 'LI',
        nodeType: 1,
        parentId: 200,
        childNodeIds: [400],
      };

      const subMenuNode: RawDomNode = {
        nodeId: 4,
        backendNodeId: 400,
        nodeName: 'UL',
        nodeType: 1,
        attributes: { 'aria-label': 'Shoes' },
        parentId: 300,
        childNodeIds: [500],
      };

      const itemNode: RawDomNode = {
        nodeId: 5,
        backendNodeId: 500,
        nodeName: 'LI',
        nodeType: 1,
        parentId: 400,
      };

      const domTree = new Map<number, RawDomNode>([
        [100, navNode],
        [200, mainMenuNode],
        [300, categoryNode],
        [400, subMenuNode],
        [500, itemNode],
      ]);

      const mainMenuAx: RawAxNode = {
        nodeId: 'ax-2',
        backendDOMNodeId: 200,
        role: 'menu',
        name: 'Categories',
      };

      const subMenuAx: RawAxNode = {
        nodeId: 'ax-4',
        backendDOMNodeId: 400,
        role: 'menu',
        name: 'Shoes',
      };

      const axTree = new Map<number, RawAxNode>([
        [200, mainMenuAx],
        [400, subMenuAx],
      ]);

      const result = resolveGrouping(500, domTree, axTree, []);

      expect(result.group_path).toBeDefined();
      expect(result.group_path?.length).toBeGreaterThanOrEqual(2);
    });

    it('should find heading context from preceding sibling', () => {
      const sectionNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'SECTION',
        nodeType: 1,
        childNodeIds: [200, 300],
      };

      const headingNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'H2',
        nodeType: 1,
        parentId: 100,
      };

      const buttonNode: RawDomNode = {
        nodeId: 3,
        backendNodeId: 300,
        nodeName: 'BUTTON',
        nodeType: 1,
        parentId: 100,
      };

      const domTree = new Map<number, RawDomNode>([
        [100, sectionNode],
        [200, headingNode],
        [300, buttonNode],
      ]);

      const headingAx: RawAxNode = {
        nodeId: 'ax-2',
        backendDOMNodeId: 200,
        role: 'heading',
        name: 'Contact Us',
        properties: [{ name: 'level', value: { type: 'integer', value: 2 } }],
      };

      const axTree = new Map<number, RawAxNode>([[200, headingAx]]);

      // All nodes including heading for context
      const allNodes: RawNodeData[] = [
        { backendNodeId: 200, domNode: headingNode, axNode: headingAx },
        { backendNodeId: 300, domNode: buttonNode },
      ];

      const result = resolveGrouping(300, domTree, axTree, allNodes);

      expect(result.heading_context).toBe('Contact Us');
    });

    it('should return undefined for no group', () => {
      const divNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'DIV',
        nodeType: 1,
        childNodeIds: [200],
      };

      const spanNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'SPAN',
        nodeType: 1,
        parentId: 100,
      };

      const domTree = new Map<number, RawDomNode>([
        [100, divNode],
        [200, spanNode],
      ]);

      const result = resolveGrouping(200, domTree, new Map(), []);

      expect(result.group_id).toBeUndefined();
    });

    it('should handle empty trees', () => {
      const result = resolveGrouping(100, new Map(), new Map(), []);

      expect(result).toEqual({});
    });

    it('should detect list group', () => {
      const listNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'UL',
        nodeType: 1,
        attributes: { 'aria-label': 'Options' },
        childNodeIds: [200],
      };

      const listItemNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'LI',
        nodeType: 1,
        parentId: 100,
      };

      const listAx: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'list',
        name: 'Options',
      };

      const domTree = new Map<number, RawDomNode>([
        [100, listNode],
        [200, listItemNode],
      ]);

      const axTree = new Map<number, RawAxNode>([[100, listAx]]);

      const result = resolveGrouping(200, domTree, axTree, []);

      expect(result.group_id).toBe('list-options');
    });

    it('should detect fieldset group', () => {
      const fieldsetNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'FIELDSET',
        nodeType: 1,
        childNodeIds: [150, 200],
      };

      const legendNode: RawDomNode = {
        nodeId: 15,
        backendNodeId: 150,
        nodeName: 'LEGEND',
        nodeType: 1,
        parentId: 100,
        nodeValue: 'Personal Info',
      };

      const inputNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'INPUT',
        nodeType: 1,
        parentId: 100,
      };

      const fieldsetAx: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'group',
        name: 'Personal Info',
      };

      const domTree = new Map<number, RawDomNode>([
        [100, fieldsetNode],
        [150, legendNode],
        [200, inputNode],
      ]);

      const axTree = new Map<number, RawAxNode>([[100, fieldsetAx]]);

      const result = resolveGrouping(200, domTree, axTree, []);

      expect(result.group_id).toContain('group');
    });

    it('should detect tablist group', () => {
      const tablistNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'DIV',
        nodeType: 1,
        attributes: { role: 'tablist' },
        childNodeIds: [200],
      };

      const tabNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { role: 'tab' },
        parentId: 100,
      };

      const tablistAx: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'tablist',
        name: 'Settings Tabs',
      };

      const domTree = new Map<number, RawDomNode>([
        [100, tablistNode],
        [200, tabNode],
      ]);

      const axTree = new Map<number, RawAxNode>([[100, tablistAx]]);

      const result = resolveGrouping(200, domTree, axTree, []);

      expect(result.group_id).toBe('tablist-settings-tabs');
    });
  });

  describe('semantic group_id naming', () => {
    it('should slugify group names', () => {
      const navNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'NAV',
        nodeType: 1,
        attributes: { 'aria-label': 'Shop and Learn' },
        childNodeIds: [200],
      };

      const linkNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'A',
        nodeType: 1,
        parentId: 100,
      };

      const navAx: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'navigation',
        name: 'Shop and Learn',
      };

      const domTree = new Map<number, RawDomNode>([
        [100, navNode],
        [200, linkNode],
      ]);

      const axTree = new Map<number, RawAxNode>([[100, navAx]]);

      const result = resolveGrouping(200, domTree, axTree, []);

      // Should be slugified: "Shop and Learn" → "shop-and-learn"
      expect(result.group_id).toBe('navigation-shop-and-learn');
    });

    it('should slugify names with special characters', () => {
      const menuNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'UL',
        nodeType: 1,
        childNodeIds: [200],
      };

      const itemNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'LI',
        nodeType: 1,
        parentId: 100,
      };

      const menuAx: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'menu',
        name: "Women's & Kids' Apparel",
      };

      const domTree = new Map<number, RawDomNode>([
        [100, menuNode],
        [200, itemNode],
      ]);

      const axTree = new Map<number, RawAxNode>([[100, menuAx]]);

      const result = resolveGrouping(200, domTree, axTree, []);

      // Should be slugified and cleaned: "Women's & Kids' Apparel" → "womens-kids-apparel"
      expect(result.group_id).toBe('menu-womens-kids-apparel');
    });

    it('should use heading context as fallback for unnamed groups', () => {
      const sectionNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'SECTION',
        nodeType: 1,
        childNodeIds: [150, 200],
      };

      const headingNode: RawDomNode = {
        nodeId: 15,
        backendNodeId: 150,
        nodeName: 'H2',
        nodeType: 1,
        parentId: 100,
      };

      const listNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'UL',
        nodeType: 1,
        parentId: 100,
        childNodeIds: [300],
      };

      const itemNode: RawDomNode = {
        nodeId: 3,
        backendNodeId: 300,
        nodeName: 'LI',
        nodeType: 1,
        parentId: 200,
      };

      const headingAx: RawAxNode = {
        nodeId: 'ax-15',
        backendDOMNodeId: 150,
        role: 'heading',
        name: 'Featured Products',
      };

      // List has NO name - should fallback to heading context
      const listAx: RawAxNode = {
        nodeId: 'ax-2',
        backendDOMNodeId: 200,
        role: 'list',
        // No name!
      };

      const domTree = new Map<number, RawDomNode>([
        [100, sectionNode],
        [150, headingNode],
        [200, listNode],
        [300, itemNode],
      ]);

      const axTree = new Map<number, RawAxNode>([
        [150, headingAx],
        [200, listAx],
      ]);

      const allNodes: RawNodeData[] = [
        { backendNodeId: 150, domNode: headingNode, axNode: headingAx },
        { backendNodeId: 200, domNode: listNode, axNode: listAx },
        { backendNodeId: 300, domNode: itemNode },
      ];

      const result = resolveGrouping(300, domTree, axTree, allNodes);

      // Should use heading context "Featured Products" as fallback
      expect(result.group_id).toBe('list-featured-products');
    });

    it('should handle empty names gracefully', () => {
      const listNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'UL',
        nodeType: 1,
        childNodeIds: [200],
      };

      const itemNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'LI',
        nodeType: 1,
        parentId: 100,
      };

      // Name is empty string
      const listAx: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'list',
        name: '',
      };

      const domTree = new Map<number, RawDomNode>([
        [100, listNode],
        [200, itemNode],
      ]);

      const axTree = new Map<number, RawAxNode>([[100, listAx]]);

      const result = resolveGrouping(200, domTree, axTree, []);

      // Should fallback to nodeId since name is empty
      expect(result.group_id).toBe('list-100');
    });

    it('should truncate very long slugified names', () => {
      const menuNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'UL',
        nodeType: 1,
        childNodeIds: [200],
      };

      const itemNode: RawDomNode = {
        nodeId: 2,
        backendNodeId: 200,
        nodeName: 'LI',
        nodeType: 1,
        parentId: 100,
      };

      const menuAx: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'menu',
        name: 'This Is A Very Long Menu Name That Should Be Truncated To Keep IDs Reasonable',
      };

      const domTree = new Map<number, RawDomNode>([
        [100, menuNode],
        [200, itemNode],
      ]);

      const axTree = new Map<number, RawAxNode>([[100, menuAx]]);

      const result = resolveGrouping(200, domTree, axTree, []);

      // Should be truncated to reasonable length
      expect(result.group_id!.length).toBeLessThanOrEqual(60);
      expect(result.group_id).toContain('menu-');
    });
  });
});
