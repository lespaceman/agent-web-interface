/**
 * Extractor Types Tests
 *
 * Tests for type validation helpers and context creation utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  createExtractorContext,
  isValidRawDomNode,
  isValidRawAxNode,
  isValidNodeLayoutInfo,
  type RawDomNode,
  type RawAxNode,
  type NodeLayoutInfo,
  type ExtractorContext,
} from '../../../../src/snapshot/extractors/types.js';
import { createMockCdpClient } from '../../../mocks/cdp-client.mock.js';

describe('Extractor Types', () => {
  describe('createExtractorContext', () => {
    it('should create a context with all required properties', () => {
      const cdp = createMockCdpClient();
      const viewport = { width: 1280, height: 720 };
      const options = { include_hidden: false };

      const ctx = createExtractorContext(cdp, viewport, options);

      expect(ctx).toEqual({
        cdp,
        viewport,
        options,
      });
    });

    it('should create a context with default options', () => {
      const cdp = createMockCdpClient();
      const viewport = { width: 1920, height: 1080 };

      const ctx = createExtractorContext(cdp, viewport);

      expect(ctx.cdp).toBe(cdp);
      expect(ctx.viewport).toEqual(viewport);
      expect(ctx.options).toEqual({});
    });
  });

  describe('RawDomNode validation', () => {
    it('should validate a correct RawDomNode', () => {
      const node: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'DIV',
        nodeType: 1,
      };

      expect(isValidRawDomNode(node)).toBe(true);
    });

    it('should validate a RawDomNode with all optional fields', () => {
      const node: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'BUTTON',
        nodeType: 1,
        attributes: { id: 'submit-btn', class: 'btn primary' },
        childNodeIds: [2, 3, 4],
        shadowRootType: 'open',
        frameId: 'frame-123',
        parentId: 0,
      };

      expect(isValidRawDomNode(node)).toBe(true);
    });

    it('should reject node without nodeId', () => {
      const node = {
        backendNodeId: 100,
        nodeName: 'DIV',
        nodeType: 1,
      } as RawDomNode;

      expect(isValidRawDomNode(node)).toBe(false);
    });

    it('should reject node without backendNodeId', () => {
      const node = {
        nodeId: 1,
        nodeName: 'DIV',
        nodeType: 1,
      } as RawDomNode;

      expect(isValidRawDomNode(node)).toBe(false);
    });

    it('should reject node without nodeName', () => {
      const node = {
        nodeId: 1,
        backendNodeId: 100,
        nodeType: 1,
      } as RawDomNode;

      expect(isValidRawDomNode(node)).toBe(false);
    });

    it('should reject null or undefined', () => {
      expect(isValidRawDomNode(null as unknown as RawDomNode)).toBe(false);
      expect(isValidRawDomNode(undefined as unknown as RawDomNode)).toBe(false);
    });
  });

  describe('RawAxNode validation', () => {
    it('should validate a correct RawAxNode', () => {
      const node: RawAxNode = {
        nodeId: 'ax-1',
      };

      expect(isValidRawAxNode(node)).toBe(true);
    });

    it('should validate a RawAxNode with all optional fields', () => {
      const node: RawAxNode = {
        nodeId: 'ax-1',
        backendDOMNodeId: 100,
        role: 'button',
        name: 'Submit',
        properties: [
          { name: 'focusable', value: { type: 'boolean', value: true } },
        ],
        ignored: false,
        childIds: ['ax-2', 'ax-3'],
      };

      expect(isValidRawAxNode(node)).toBe(true);
    });

    it('should reject node without nodeId', () => {
      const node = {
        role: 'button',
      } as RawAxNode;

      expect(isValidRawAxNode(node)).toBe(false);
    });

    it('should reject null or undefined', () => {
      expect(isValidRawAxNode(null as unknown as RawAxNode)).toBe(false);
      expect(isValidRawAxNode(undefined as unknown as RawAxNode)).toBe(false);
    });
  });

  describe('NodeLayoutInfo validation', () => {
    it('should validate a correct NodeLayoutInfo', () => {
      const layout: NodeLayoutInfo = {
        bbox: { x: 10, y: 20, w: 100, h: 50 },
        isVisible: true,
      };

      expect(isValidNodeLayoutInfo(layout)).toBe(true);
    });

    it('should validate a NodeLayoutInfo with all optional fields', () => {
      const layout: NodeLayoutInfo = {
        bbox: { x: 10, y: 20, w: 100, h: 50 },
        display: 'block',
        visibility: 'visible',
        isVisible: true,
        screenZone: 'top-center',
      };

      expect(isValidNodeLayoutInfo(layout)).toBe(true);
    });

    it('should reject layout without bbox', () => {
      const layout = {
        isVisible: true,
      } as NodeLayoutInfo;

      expect(isValidNodeLayoutInfo(layout)).toBe(false);
    });

    it('should reject layout without isVisible', () => {
      const layout = {
        bbox: { x: 10, y: 20, w: 100, h: 50 },
      } as NodeLayoutInfo;

      expect(isValidNodeLayoutInfo(layout)).toBe(false);
    });

    it('should reject null or undefined', () => {
      expect(isValidNodeLayoutInfo(null as unknown as NodeLayoutInfo)).toBe(false);
      expect(isValidNodeLayoutInfo(undefined as unknown as NodeLayoutInfo)).toBe(false);
    });
  });

  describe('Type exports', () => {
    it('should export all required types', () => {
      // This test verifies that all types can be imported
      const ctx: ExtractorContext = {
        cdp: createMockCdpClient(),
        viewport: { width: 1280, height: 720 },
        options: {},
      };

      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 100,
        nodeName: 'DIV',
        nodeType: 1,
      };

      const axNode: RawAxNode = {
        nodeId: 'ax-1',
      };

      const layout: NodeLayoutInfo = {
        bbox: { x: 0, y: 0, w: 100, h: 100 },
        isVisible: true,
      };

      expect(ctx).toBeDefined();
      expect(domNode).toBeDefined();
      expect(axNode).toBeDefined();
      expect(layout).toBeDefined();
    });
  });
});
