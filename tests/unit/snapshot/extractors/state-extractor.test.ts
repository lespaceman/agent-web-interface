/**
 * State Extractor Tests
 *
 * Tests for interactive element state extraction.
 */

import { describe, it, expect } from 'vitest';
import { extractState } from '../../../../src/snapshot/extractors/state-extractor.js';
import type { RawDomNode, RawAxNode, NodeLayoutInfo } from '../../../../src/snapshot/extractors/types.js';

describe('State Extractor', () => {
  describe('extractState', () => {
    it('should extract basic visible and enabled state', () => {
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
      };

      const layout: NodeLayoutInfo = {
        bbox: { x: 10, y: 20, w: 100, h: 50 },
        isVisible: true,
      };

      const state = extractState(domNode, axNode, layout);

      expect(state.visible).toBe(true);
      expect(state.enabled).toBe(true);
    });

    it('should extract checked state from AX properties', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'INPUT',
        nodeType: 1,
        attributes: { type: 'checkbox' },
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'checkbox',
        properties: [
          { name: 'checked', value: { type: 'tristate', value: 'true' } },
        ],
      };

      const layout: NodeLayoutInfo = {
        bbox: { x: 10, y: 20, w: 20, h: 20 },
        isVisible: true,
      };

      const state = extractState(domNode, axNode, layout);

      expect(state.checked).toBe(true);
    });

    it('should extract unchecked state', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'checkbox',
        properties: [
          { name: 'checked', value: { type: 'tristate', value: 'false' } },
        ],
      };

      const state = extractState(undefined, axNode, undefined);

      expect(state.checked).toBe(false);
    });

    it('should extract mixed/indeterminate checked state', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'checkbox',
        properties: [
          { name: 'checked', value: { type: 'tristate', value: 'mixed' } },
        ],
      };

      const state = extractState(undefined, axNode, undefined);

      // Mixed state should be represented as undefined or a specific value
      // For simplicity, we treat it as neither true nor false
      expect(state.checked).toBeUndefined();
    });

    it('should extract disabled state from AX properties', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        properties: [
          { name: 'disabled', value: { type: 'boolean', value: true } },
        ],
      };

      const state = extractState(undefined, axNode, undefined);

      expect(state.enabled).toBe(false);
    });

    it('should extract disabled state from DOM attribute', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { disabled: '' },
      };

      const state = extractState(domNode, undefined, undefined);

      expect(state.enabled).toBe(false);
    });

    it('should extract aria-disabled from DOM', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { 'aria-disabled': 'true' },
      };

      const state = extractState(domNode, undefined, undefined);

      expect(state.enabled).toBe(false);
    });

    it('should extract expanded state', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        properties: [
          { name: 'expanded', value: { type: 'boolean', value: true } },
        ],
      };

      const state = extractState(undefined, axNode, undefined);

      expect(state.expanded).toBe(true);
    });

    it('should extract selected state', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'tab',
        properties: [
          { name: 'selected', value: { type: 'boolean', value: true } },
        ],
      };

      const state = extractState(undefined, axNode, undefined);

      expect(state.selected).toBe(true);
    });

    it('should extract focused state', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'textbox',
        properties: [
          { name: 'focused', value: { type: 'boolean', value: true } },
        ],
      };

      const state = extractState(undefined, axNode, undefined);

      expect(state.focused).toBe(true);
    });

    it('should extract required state from DOM', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'INPUT',
        nodeType: 1,
        attributes: { required: '' },
      };

      const state = extractState(domNode, undefined, undefined);

      expect(state.required).toBe(true);
    });

    it('should extract required state from aria-required', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'INPUT',
        nodeType: 1,
        attributes: { 'aria-required': 'true' },
      };

      const state = extractState(domNode, undefined, undefined);

      expect(state.required).toBe(true);
    });

    it('should extract invalid state from AX', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'textbox',
        properties: [
          { name: 'invalid', value: { type: 'token', value: 'true' } },
        ],
      };

      const state = extractState(undefined, axNode, undefined);

      expect(state.invalid).toBe(true);
    });

    it('should extract invalid state from aria-invalid', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'INPUT',
        nodeType: 1,
        attributes: { 'aria-invalid': 'true' },
      };

      const state = extractState(domNode, undefined, undefined);

      expect(state.invalid).toBe(true);
    });

    it('should extract readonly state from DOM', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'INPUT',
        nodeType: 1,
        attributes: { readonly: '' },
      };

      const state = extractState(domNode, undefined, undefined);

      expect(state.readonly).toBe(true);
    });

    it('should extract readonly state from aria-readonly', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'INPUT',
        nodeType: 1,
        attributes: { 'aria-readonly': 'true' },
      };

      const state = extractState(domNode, undefined, undefined);

      expect(state.readonly).toBe(true);
    });

    it('should prioritize AX properties over DOM attributes', () => {
      // AX says enabled, DOM has disabled attribute
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { disabled: '' },
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        // No disabled property in AX
        properties: [],
      };

      const layout: NodeLayoutInfo = {
        bbox: { x: 10, y: 20, w: 100, h: 50 },
        isVisible: true,
      };

      const state = extractState(domNode, axNode, layout);

      // DOM disabled should still be respected when AX doesn't specify
      expect(state.enabled).toBe(false);
    });

    it('should derive visibility from layout', () => {
      const layout: NodeLayoutInfo = {
        bbox: { x: 10, y: 20, w: 100, h: 50 },
        isVisible: false,
        display: 'none',
      };

      const state = extractState(undefined, undefined, layout);

      expect(state.visible).toBe(false);
    });

    it('should handle all undefined inputs gracefully', () => {
      const state = extractState(undefined, undefined, undefined);

      expect(state.visible).toBe(true); // Default visible
      expect(state.enabled).toBe(true); // Default enabled
      expect(state.checked).toBeUndefined();
      expect(state.expanded).toBeUndefined();
      expect(state.selected).toBeUndefined();
    });

    it('should handle boolean value from AX properties', () => {
      const axNode: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'checkbox',
        properties: [
          { name: 'checked', value: { type: 'boolean', value: true } },
        ],
      };

      const state = extractState(undefined, axNode, undefined);

      expect(state.checked).toBe(true);
    });
  });
});
