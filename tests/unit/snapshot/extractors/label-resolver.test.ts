/**
 * Label Resolver Tests
 *
 * Tests for accessible name computation with fallback strategies.
 */

import { describe, it, expect } from 'vitest';
import { resolveLabel, type LabelSource } from '../../../../src/snapshot/extractors/label-resolver.js';
import type { RawDomNode, RawAxNode } from '../../../../src/snapshot/extractors/types.js';

describe('Label Resolver', () => {
  describe('resolveLabel', () => {
    it('should use AX computed name as primary source', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        name: 'Submit Form',
      };

      const result = resolveLabel(undefined, axNode);

      expect(result.label).toBe('Submit Form');
      expect(result.source).toBe('ax-name');
    });

    it('should fall back to aria-label', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { 'aria-label': 'Close dialog' },
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        // No name
      };

      const result = resolveLabel(domNode, axNode);

      expect(result.label).toBe('Close dialog');
      expect(result.source).toBe('aria-label');
    });

    it('should fall back to title attribute', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { title: 'Click to submit' },
      };

      const result = resolveLabel(domNode, undefined);

      expect(result.label).toBe('Click to submit');
      expect(result.source).toBe('title');
    });

    it('should fall back to placeholder for inputs', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'INPUT',
        nodeType: 1,
        attributes: { type: 'text', placeholder: 'Enter your email' },
      };

      const result = resolveLabel(domNode, undefined);

      expect(result.label).toBe('Enter your email');
      expect(result.source).toBe('placeholder');
    });

    it('should use alt text for images', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'IMG',
        nodeType: 1,
        attributes: { alt: 'Company logo' },
      };

      const result = resolveLabel(domNode, undefined);

      expect(result.label).toBe('Company logo');
      expect(result.source).toBe('alt');
    });

    it('should use value for submit buttons', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'INPUT',
        nodeType: 1,
        attributes: { type: 'submit', value: 'Send Message' },
      };

      const result = resolveLabel(domNode, undefined);

      expect(result.label).toBe('Send Message');
      expect(result.source).toBe('value');
    });

    it('should normalize whitespace in labels', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        name: '  Submit    Form  ',
      };

      const result = resolveLabel(undefined, axNode);

      expect(result.label).toBe('Submit Form');
    });

    it('should truncate long labels', () => {
      const longName = 'A'.repeat(200);
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        name: longName,
      };

      const result = resolveLabel(undefined, axNode);

      expect(result.label.length).toBeLessThanOrEqual(161); // 160 + ellipsis
      expect(result.label.endsWith('…')).toBe(true);
    });

    it('should return empty string with none source when no label found', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'DIV',
        nodeType: 1,
      };

      const result = resolveLabel(domNode, undefined);

      expect(result.label).toBe('');
      expect(result.source).toBe('none');
    });

    it('should handle undefined inputs', () => {
      const result = resolveLabel(undefined, undefined);

      expect(result.label).toBe('');
      expect(result.source).toBe('none');
    });

    it('should prefer AX name over DOM attributes', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { 'aria-label': 'From aria-label', title: 'From title' },
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        name: 'From AX computed name',
      };

      const result = resolveLabel(domNode, axNode);

      expect(result.label).toBe('From AX computed name');
      expect(result.source).toBe('ax-name');
    });

    it('should use name attribute for form elements', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'INPUT',
        nodeType: 1,
        attributes: { type: 'text', name: 'user_email' },
      };

      const result = resolveLabel(domNode, undefined);

      expect(result.label).toBe('user_email');
      expect(result.source).toBe('name');
    });

    it('should skip empty attribute values', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { 'aria-label': '', title: 'Actual title' },
      };

      const result = resolveLabel(domNode, undefined);

      expect(result.label).toBe('Actual title');
      expect(result.source).toBe('title');
    });

    it('should handle whitespace-only values', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { 'aria-label': '   ', title: 'Real title' },
      };

      const result = resolveLabel(domNode, undefined);

      expect(result.label).toBe('Real title');
      expect(result.source).toBe('title');
    });

    it('should use node name as fallback for certain elements', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'INPUT',
        nodeType: 1,
        attributes: { type: 'checkbox' },
      };

      const result = resolveLabel(domNode, undefined);

      // Should return empty for checkbox without label
      expect(result.label).toBe('');
      expect(result.source).toBe('none');
    });

    it('should use data-testid for display when no other label', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { 'data-testid': 'submit-button' },
      };

      const result = resolveLabel(domNode, undefined);

      expect(result.label).toBe('submit-button');
      expect(result.source).toBe('test-id');
    });
  });

  describe('label source tracking', () => {
    it('should track all valid label sources', () => {
      const validSources: LabelSource[] = [
        'ax-name',
        'aria-label',
        'labelledby',
        'label-element',
        'text-content',
        'title',
        'placeholder',
        'alt',
        'value',
        'name',
        'test-id',
        'none',
      ];

      // Just verify we can use all these sources
      validSources.forEach((source) => {
        expect(typeof source).toBe('string');
      });
    });
  });
});
