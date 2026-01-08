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

    describe('raw accessible name handling for role locators', () => {
      it('should use raw axNode.name for role locator (not normalized label)', () => {
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
          name: '  Submit  Form  ', // Raw name with extra whitespace
        };

        // Label is normalized version
        const result = buildLocators(domNode, axNode, 'Submit Form');

        // Role locator should use raw name from axNode.name, preserving whitespace
        expect(result.primary).toBe('role=button[name="  Submit  Form  "]');
      });

      it('should skip overlong accessible names in role locators', () => {
        const longName = 'A'.repeat(201);
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
          name: longName,
        };

        const result = buildLocators(domNode, axNode, 'normalized');

        // Overlong names should fall back to bare role locator
        expect(result.primary).toBe('role=button');
      });

      it('should skip oversized test-id values and fall back to role', () => {
        const longTestId = 'x'.repeat(201);
        const domNode: RawDomNode = {
          nodeId: 1,
          backendNodeId: 100,
          nodeName: 'BUTTON',
          nodeType: 1,
          attributes: { 'data-testid': longTestId },
        };

        const axNode: RawAxNode = {
          nodeId: 'ax-1',
          backendDOMNodeId: 100,
          role: 'button',
          name: 'Click Me',
        };

        const result = buildLocators(domNode, axNode, 'Click Me');

        expect(result.primary).toBe('role=button[name="Click Me"]');
      });

      it('should fall back to aria-label when axNode.name is missing', () => {
        const domNode: RawDomNode = {
          nodeId: 1,
          backendNodeId: 100,
          nodeName: 'BUTTON',
          nodeType: 1,
          attributes: { 'aria-label': 'Close Dialog' },
        };

        const axNode: RawAxNode = {
          nodeId: 'ax-1',
          backendDOMNodeId: 100,
          role: 'button',
          // No name property
        };

        const result = buildLocators(domNode, axNode, 'Close Dialog');

        expect(result.primary).toBe('role=button[name="Close Dialog"]');
      });

      it('should emit bare role locator when no name available', () => {
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
          // No name
        };

        const result = buildLocators(domNode, axNode, '');

        expect(result.primary).toBe('role=button');
      });

      it('should fall back to aria-label when axNode.name is empty string', () => {
        const domNode: RawDomNode = {
          nodeId: 1,
          backendNodeId: 100,
          nodeName: 'BUTTON',
          nodeType: 1,
          attributes: { 'aria-label': 'Close Dialog' },
        };

        const axNode: RawAxNode = {
          nodeId: 'ax-1',
          backendDOMNodeId: 100,
          role: 'button',
          name: '', // Empty string should trigger fallback
        };

        const result = buildLocators(domNode, axNode, 'Close Dialog');

        // Should fall back to aria-label, not emit bare role
        expect(result.primary).toBe('role=button[name="Close Dialog"]');
      });

      it('should fall back to aria-label when axNode.name is whitespace only', () => {
        const domNode: RawDomNode = {
          nodeId: 1,
          backendNodeId: 100,
          nodeName: 'BUTTON',
          nodeType: 1,
          attributes: { 'aria-label': 'Close Dialog' },
        };

        const axNode: RawAxNode = {
          nodeId: 'ax-1',
          backendDOMNodeId: 100,
          role: 'button',
          name: '   ', // Whitespace only should trigger fallback
        };

        const result = buildLocators(domNode, axNode, 'Close Dialog');

        // Should fall back to aria-label
        expect(result.primary).toBe('role=button[name="Close Dialog"]');
      });

      it('should normalize whitespace in aria-label fallback', () => {
        const domNode: RawDomNode = {
          nodeId: 1,
          backendNodeId: 100,
          nodeName: 'BUTTON',
          nodeType: 1,
          attributes: { 'aria-label': '  Close   Dialog  ' },
        };

        const axNode: RawAxNode = {
          nodeId: 'ax-1',
          backendDOMNodeId: 100,
          role: 'button',
          // No name - will use aria-label fallback
        };

        const result = buildLocators(domNode, axNode, 'Close Dialog');

        // aria-label should have whitespace normalized
        expect(result.primary).toBe('role=button[name="Close Dialog"]');
      });

      it('should fall back to bare role locator when name has control characters', () => {
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
          name: 'Line1\nLine2', // Name with newline
        };

        const result = buildLocators(domNode, axNode, 'Line1 Line2');

        // Control chars should not be embedded in role locator strings
        expect(result.primary).toBe('role=button');
      });

      it('should escape quotes and backslashes in role locator names', () => {
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
          name: 'Click "here" \\ now',
        };

        const result = buildLocators(domNode, axNode, 'Click here now');

        // Quotes and backslashes must be escaped to not break selector syntax
        expect(result.primary).toBe('role=button[name="Click \\"here\\" \\\\ now"]');
      });

      it('should prefer axNode.name over domNode aria-label', () => {
        const domNode: RawDomNode = {
          nodeId: 1,
          backendNodeId: 100,
          nodeName: 'BUTTON',
          nodeType: 1,
          attributes: { 'aria-label': 'DOM Label' },
        };

        const axNode: RawAxNode = {
          nodeId: 'ax-1',
          backendDOMNodeId: 100,
          role: 'button',
          name: 'AX Computed Name',
        };

        const result = buildLocators(domNode, axNode, 'AX Computed Name');

        // Should use axNode.name, not aria-label
        expect(result.primary).toBe('role=button[name="AX Computed Name"]');
      });
    });
  });
});
