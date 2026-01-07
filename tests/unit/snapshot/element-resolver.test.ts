/**
 * Element Resolver Tests
 */

/* eslint-disable @typescript-eslint/unbound-method */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveLocator, parseLocatorString } from '../../../src/snapshot/element-resolver.js';
import type { ReadableNode } from '../../../src/snapshot/snapshot.types.js';
import type { Page, Locator } from 'playwright';

describe('ElementResolver', () => {
  describe('parseLocatorString()', () => {
    it('should parse role-only locator', () => {
      const result = parseLocatorString('role=button');
      expect(result).toEqual({ type: 'role', role: 'button', name: undefined });
    });

    it('should parse role with name locator', () => {
      const result = parseLocatorString('role=button[name="Submit"]');
      expect(result).toEqual({ type: 'role', role: 'button', name: 'Submit' });
    });

    it('should parse role with name containing special characters', () => {
      const result = parseLocatorString('role=link[name="More info..."]');
      expect(result).toEqual({ type: 'role', role: 'link', name: 'More info...' });
    });

    it('should parse role with single quoted name', () => {
      const result = parseLocatorString("role=textbox[name='Email']");
      expect(result).toEqual({ type: 'role', role: 'textbox', name: 'Email' });
    });

    it('should return css type for non-role selectors', () => {
      const result = parseLocatorString('button.primary');
      expect(result).toEqual({ type: 'css', selector: 'button.primary' });
    });

    it('should return css type for aria-label selectors', () => {
      const result = parseLocatorString('[aria-label="Submit"]');
      expect(result).toEqual({ type: 'css', selector: '[aria-label="Submit"]' });
    });
  });

  describe('resolveLocator()', () => {
    let mockPage: Page;
    let mockLocator: Locator;

    beforeEach(() => {
      mockLocator = {
        click: vi.fn(),
        fill: vi.fn(),
      } as unknown as Locator;

      mockPage = {
        getByRole: vi.fn().mockReturnValue(mockLocator),
        locator: vi.fn().mockReturnValue(mockLocator),
      } as unknown as Page;
    });

    function createTestNode(selector: string): ReadableNode {
      return {
        node_id: 'node-1',
        kind: 'button',
        label: 'Test',
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 100, h: 30 } },
        find: { primary: selector },
      };
    }

    it('should use getByRole for role=X locators', () => {
      const node = createTestNode('role=button');
      const locator = resolveLocator(mockPage, node);

      expect(mockPage.getByRole).toHaveBeenCalledWith('button', {});
      expect(locator).toBe(mockLocator);
    });

    it('should use getByRole with name for role=X[name="Y"] locators', () => {
      const node = createTestNode('role=button[name="Submit"]');
      const locator = resolveLocator(mockPage, node);

      expect(mockPage.getByRole).toHaveBeenCalledWith('button', { name: 'Submit' });
      expect(locator).toBe(mockLocator);
    });

    it('should use page.locator for CSS selectors', () => {
      const node = createTestNode('button.primary');
      const locator = resolveLocator(mockPage, node);

      expect(mockPage.locator).toHaveBeenCalledWith('button.primary');
      expect(locator).toBe(mockLocator);
    });

    it('should throw error if node has no locator', () => {
      const node: ReadableNode = {
        node_id: 'node-1',
        kind: 'button',
        label: 'Test',
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 100, h: 30 } },
        // No find property
      };

      expect(() => resolveLocator(mockPage, node)).toThrow('Node node-1 has no locator');
    });

    it('should handle empty primary locator', () => {
      const node = createTestNode('');

      expect(() => resolveLocator(mockPage, node)).toThrow('Node node-1 has no locator');
    });
  });
});
