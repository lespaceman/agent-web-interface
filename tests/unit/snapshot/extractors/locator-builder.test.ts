/**
 * Locator Builder Tests
 *
 * Tests for stable locator generation.
 */

import { describe, it, expect } from 'vitest';
import { buildLocators } from '../../../../src/snapshot/extractors/locator-builder.js';
import type { RawDomNode, RawAxNode } from '../../../../src/snapshot/extractors/types.js';

describe('Locator Builder', () => {
  describe('buildLocators', () => {
    it('should use data-testid as primary locator', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { 'data-testid': 'submit-button' },
      };

      const result = buildLocators(domNode, undefined, 'Submit');

      expect(result.primary).toBe('[data-testid="submit-button"]');
    });

    it('should use data-test as fallback test ID', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { 'data-test': 'submit-btn' },
      };

      const result = buildLocators(domNode, undefined, 'Submit');

      expect(result.primary).toBe('[data-test="submit-btn"]');
    });

    it('should use data-cy as fallback test ID', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { 'data-cy': 'submit' },
      };

      const result = buildLocators(domNode, undefined, 'Submit');

      expect(result.primary).toBe('[data-cy="submit"]');
    });

    it('should use role + name locator when no test ID', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        name: 'Submit Form',
      };

      const result = buildLocators(domNode, axNode, 'Submit Form');

      expect(result.primary).toBe('role=button[name="Submit Form"]');
    });

    it('should use CSS ID selector when available', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { id: 'submit-btn' },
      };

      const result = buildLocators(domNode, undefined, '');

      expect(result.primary).toBe('#submit-btn');
    });

    it('should use role-only locator when no name', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
      };

      const result = buildLocators(undefined, axNode, '');

      expect(result.primary).toBe('role=button');
    });

    it('should generate alternates when available', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { 'data-testid': 'submit-btn', id: 'submitButton', class: 'btn primary' },
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        name: 'Submit',
      };

      const result = buildLocators(domNode, axNode, 'Submit');

      expect(result.primary).toBe('[data-testid="submit-btn"]');
      expect(result.alternates).toBeDefined();
      expect(result.alternates?.length).toBeGreaterThan(0);
    });

    it('should escape special characters in locator values', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { 'data-testid': 'submit"button' },
      };

      const result = buildLocators(domNode, undefined, '');

      expect(result.primary).toBe('[data-testid="submit\\"button"]');
    });

    it('should handle link elements', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'A',
        nodeType: 1,
        attributes: { href: '/about' },
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'link',
        name: 'About Us',
      };

      const result = buildLocators(domNode, axNode, 'About Us');

      expect(result.primary).toBe('role=link[name="About Us"]');
    });

    it('should handle input elements', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'INPUT',
        nodeType: 1,
        attributes: { type: 'text', name: 'username', placeholder: 'Enter username' },
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'textbox',
        name: 'Enter username',
      };

      const result = buildLocators(domNode, axNode, 'Enter username');

      // Should use role=textbox with name
      expect(result.primary).toBe('role=textbox[name="Enter username"]');
    });

    it('should include name attribute as alternate for form inputs', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'INPUT',
        nodeType: 1,
        attributes: { type: 'text', name: 'email' },
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'textbox',
        name: 'Email',
      };

      const result = buildLocators(domNode, axNode, 'Email');

      expect(result.alternates).toContain('[name="email"]');
    });

    it('should build CSS class-based selector as alternate', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { class: 'btn-primary submit-action' },
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        name: 'Submit',
      };

      const result = buildLocators(domNode, axNode, 'Submit');

      // One of the alternates should use class
      expect(result.alternates?.some((alt) => alt.includes('.btn-primary'))).toBe(true);
    });

    it('should handle elements without any attributes', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        name: 'Click me',
      };

      const result = buildLocators(domNode, axNode, 'Click me');

      expect(result.primary).toBe('role=button[name="Click me"]');
    });

    it('should return generic locator as fallback', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'DIV',
        nodeType: 1,
      };

      const result = buildLocators(domNode, undefined, '');

      // Should return tag-based selector as last resort
      expect(result.primary).toBe('div');
    });

    it('should handle undefined inputs', () => {
      const result = buildLocators(undefined, undefined, '');

      expect(result.primary).toBe('*');
    });

    it('should build aria-label selector as alternate', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { 'aria-label': 'Close modal' },
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        name: 'Close modal',
      };

      const result = buildLocators(domNode, axNode, 'Close modal');

      expect(result.alternates).toContain('[aria-label="Close modal"]');
    });

    it('should not include empty alternates', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { 'data-testid': 'submit' },
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        name: 'Submit',
      };

      const result = buildLocators(domNode, axNode, 'Submit');

      // Alternates should not contain empty strings
      if (result.alternates) {
        expect(result.alternates.every((alt) => alt.length > 0)).toBe(true);
      }
    });
  });
});
