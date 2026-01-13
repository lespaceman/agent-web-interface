/**
 * Element Identity Tests
 *
 * Tests for stable semantic element ID (EID) generation.
 */

import { describe, it, expect } from 'vitest';
import {
  computeEid,
  normalizeAccessibleName,
  computeLandmarkPath,
  computePositionHint,
  computeNthOfType,
  hashComponents,
  resolveEidCollision,
  buildElementIdentity,
} from '../../../src/state/element-identity.js';
import type { ReadableNode } from '../../../src/snapshot/snapshot.types.js';

/**
 * Factory to create a minimal ReadableNode for testing.
 */
function createNode(overrides: Partial<ReadableNode> = {}): ReadableNode {
  return {
    node_id: 'n1',
    backend_node_id: 100,
    frame_id: 'frame-main',
    loader_id: 'loader-1',
    kind: 'button',
    label: 'Submit',
    where: {
      region: 'main',
      group_path: [],
    },
    layout: {
      bbox: { x: 100, y: 200, w: 80, h: 40 },
      screen_zone: 'above-fold',
    },
    ...overrides,
  };
}

describe('Element Identity', () => {
  describe('normalizeAccessibleName', () => {
    it('should trim whitespace', () => {
      expect(normalizeAccessibleName('  Hello World  ')).toBe('hello world');
    });

    it('should lowercase text', () => {
      expect(normalizeAccessibleName('SUBMIT FORM')).toBe('submit form');
    });

    it('should collapse multiple spaces', () => {
      expect(normalizeAccessibleName('Hello    World')).toBe('hello world');
    });

    it('should handle tabs and newlines', () => {
      expect(normalizeAccessibleName('Hello\t\nWorld')).toBe('hello world');
    });

    it('should cap length at 100 characters', () => {
      const longText = 'a'.repeat(150);
      expect(normalizeAccessibleName(longText)).toHaveLength(100);
    });

    it('should handle empty string', () => {
      expect(normalizeAccessibleName('')).toBe('');
    });

    it('should handle unicode characters', () => {
      expect(normalizeAccessibleName('Café  Résumé')).toBe('café résumé');
    });
  });

  describe('computeLandmarkPath', () => {
    it('should return region/path format', () => {
      const node = createNode({
        where: {
          region: 'nav',
          group_path: ['Menu', 'Products'],
        },
      });
      expect(computeLandmarkPath(node)).toBe('nav/Menu/Products');
    });

    it('should handle empty group_path', () => {
      const node = createNode({
        where: {
          region: 'main',
          group_path: [],
        },
      });
      expect(computeLandmarkPath(node)).toBe('main/');
    });

    it('should handle undefined group_path', () => {
      const node = createNode({
        where: {
          region: 'footer',
        },
      });
      expect(computeLandmarkPath(node)).toBe('footer/');
    });

    it('should handle undefined region', () => {
      const node = createNode({
        where: {} as ReadableNode['where'],
      });
      expect(computeLandmarkPath(node)).toBe('unknown/');
    });
  });

  describe('computePositionHint', () => {
    it('should include screen zone', () => {
      const node = createNode({
        layout: {
          bbox: { x: 100, y: 100, w: 50, h: 30 },
          screen_zone: 'above-fold',
        },
      });
      const hint = computePositionHint(node);
      expect(hint).toContain('above-fold');
    });

    it('should include last group from group_path', () => {
      const node = createNode({
        where: {
          region: 'main',
          group_path: ['Products', 'Electronics'],
        },
        layout: {
          bbox: { x: 100, y: 100, w: 50, h: 30 },
          screen_zone: 'above-fold',
        },
      });
      const hint = computePositionHint(node);
      expect(hint).toContain('Electronics');
    });

    it('should compute TL quadrant for top-left position', () => {
      const node = createNode({
        layout: {
          bbox: { x: 100, y: 100, w: 50, h: 30 },
          screen_zone: 'above-fold',
        },
      });
      const hint = computePositionHint(node);
      expect(hint).toContain('TL');
    });

    it('should compute TR quadrant for top-right position', () => {
      const node = createNode({
        layout: {
          bbox: { x: 600, y: 100, w: 50, h: 30 },
          screen_zone: 'above-fold',
        },
      });
      const hint = computePositionHint(node);
      expect(hint).toContain('TR');
    });

    it('should compute BL quadrant for bottom-left position', () => {
      const node = createNode({
        layout: {
          bbox: { x: 100, y: 500, w: 50, h: 30 },
          screen_zone: 'below-fold',
        },
      });
      const hint = computePositionHint(node);
      expect(hint).toContain('BL');
    });

    it('should compute BR quadrant for bottom-right position', () => {
      const node = createNode({
        layout: {
          bbox: { x: 600, y: 500, w: 50, h: 30 },
          screen_zone: 'below-fold',
        },
      });
      const hint = computePositionHint(node);
      expect(hint).toContain('BR');
    });

    it('should handle unknown screen zone', () => {
      const node = createNode({
        layout: {
          bbox: { x: 100, y: 100, w: 50, h: 30 },
          screen_zone: undefined,
        },
      });
      const hint = computePositionHint(node);
      expect(hint).toContain('unknown');
    });
  });

  describe('computeNthOfType', () => {
    it('should return 1 for above-fold', () => {
      const node = createNode({
        layout: {
          bbox: { x: 100, y: 100, w: 50, h: 30 },
          screen_zone: 'above-fold',
        },
      });
      expect(computeNthOfType(node)).toBe(1);
    });

    it('should return 2 for below-fold', () => {
      const node = createNode({
        layout: {
          bbox: { x: 100, y: 100, w: 50, h: 30 },
          screen_zone: 'below-fold',
        },
      });
      expect(computeNthOfType(node)).toBe(2);
    });

    it('should return 0 for other zones', () => {
      const node = createNode({
        layout: {
          bbox: { x: 100, y: 100, w: 50, h: 30 },
          screen_zone: 'top-center',
        },
      });
      expect(computeNthOfType(node)).toBe(0);
    });

    it('should return 0 for undefined zone', () => {
      const node = createNode({
        layout: {
          bbox: { x: 100, y: 100, w: 50, h: 30 },
        },
      });
      expect(computeNthOfType(node)).toBe(0);
    });
  });

  describe('hashComponents', () => {
    it('should return 12-character hex string', () => {
      const hash = hashComponents(['button', 'submit', 'main']);
      expect(hash).toMatch(/^[0-9a-f]{12}$/);
    });

    it('should be deterministic', () => {
      const hash1 = hashComponents(['button', 'submit', 'main']);
      const hash2 = hashComponents(['button', 'submit', 'main']);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = hashComponents(['button', 'submit', 'main']);
      const hash2 = hashComponents(['button', 'cancel', 'main']);
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty array', () => {
      const hash = hashComponents([]);
      expect(hash).toMatch(/^[0-9a-f]{12}$/);
    });

    it('should handle empty strings', () => {
      const hash = hashComponents(['', '', '']);
      expect(hash).toMatch(/^[0-9a-f]{12}$/);
    });
  });

  describe('computeEid', () => {
    it('should generate stable EID for same node', () => {
      const node = createNode();
      const eid1 = computeEid(node);
      const eid2 = computeEid(node);
      expect(eid1).toBe(eid2);
    });

    it('should generate different EIDs for different labels', () => {
      const node1 = createNode({ label: 'Submit' });
      const node2 = createNode({ label: 'Cancel' });
      expect(computeEid(node1)).not.toBe(computeEid(node2));
    });

    it('should generate different EIDs for different kinds', () => {
      const node1 = createNode({ kind: 'button' });
      const node2 = createNode({ kind: 'link' });
      expect(computeEid(node1)).not.toBe(computeEid(node2));
    });

    it('should generate different EIDs for different regions', () => {
      const node1 = createNode({ where: { region: 'header', group_path: [] } });
      const node2 = createNode({ where: { region: 'footer', group_path: [] } });
      expect(computeEid(node1)).not.toBe(computeEid(node2));
    });

    it('should use role attribute if present', () => {
      const nodeWithRole = createNode({
        attributes: { role: 'menuitem' },
      });
      const nodeWithoutRole = createNode();
      expect(computeEid(nodeWithRole)).not.toBe(computeEid(nodeWithoutRole));
    });

    it('should include href for links', () => {
      const link1 = createNode({
        kind: 'link',
        attributes: { href: '/products' },
      });
      const link2 = createNode({
        kind: 'link',
        attributes: { href: '/about' },
      });
      expect(computeEid(link1)).not.toBe(computeEid(link2));
    });

    it('should use explicit layer when provided', () => {
      const node = createNode();
      const eidMain = computeEid(node, 'main');
      const eidModal = computeEid(node, 'modal');
      expect(eidMain).not.toBe(eidModal);
    });

    it('should derive layer from dialog region', () => {
      const dialogNode = createNode({
        where: { region: 'dialog', group_path: [] },
      });
      const mainNode = createNode({
        where: { region: 'main', group_path: [] },
      });
      // Both nodes have same label/kind but different derived layers
      expect(computeEid(dialogNode)).not.toBe(computeEid(mainNode));
    });

    it('should return 12-character hex string', () => {
      const node = createNode();
      const eid = computeEid(node);
      expect(eid).toMatch(/^[0-9a-f]{12}$/);
    });

    it('should generate different EIDs for elements in different shadow roots', () => {
      // Two identical buttons but in different shadow roots
      const nodeInShadow1 = createNode({
        label: 'Click',
        kind: 'button',
        find: {
          primary: 'button',
          shadow_path: ['shadow-host-123'],
        },
      });
      const nodeInShadow2 = createNode({
        label: 'Click',
        kind: 'button',
        find: {
          primary: 'button',
          shadow_path: ['shadow-host-456'],
        },
      });
      const nodeNotInShadow = createNode({
        label: 'Click',
        kind: 'button',
      });

      const eid1 = computeEid(nodeInShadow1);
      const eid2 = computeEid(nodeInShadow2);
      const eid3 = computeEid(nodeNotInShadow);

      // All three should be different
      expect(eid1).not.toBe(eid2);
      expect(eid1).not.toBe(eid3);
      expect(eid2).not.toBe(eid3);
    });

    it('should handle nested shadow roots', () => {
      const nodeNestedShadow = createNode({
        label: 'Submit',
        find: {
          primary: 'button',
          shadow_path: ['outer-host', 'inner-host'],
        },
      });
      const nodeSingleShadow = createNode({
        label: 'Submit',
        find: {
          primary: 'button',
          shadow_path: ['outer-host'],
        },
      });

      expect(computeEid(nodeNestedShadow)).not.toBe(computeEid(nodeSingleShadow));
    });
  });

  describe('resolveEidCollision', () => {
    it('should return base EID if not in set', () => {
      const existingEids = new Set<string>();
      const resolved = resolveEidCollision('abc123def456', existingEids);
      expect(resolved).toBe('abc123def456');
    });

    it('should append -2 for first collision', () => {
      const existingEids = new Set(['abc123def456']);
      const resolved = resolveEidCollision('abc123def456', existingEids);
      expect(resolved).toBe('abc123def456-2');
    });

    it('should append -3 for second collision', () => {
      const existingEids = new Set(['abc123def456', 'abc123def456-2']);
      const resolved = resolveEidCollision('abc123def456', existingEids);
      expect(resolved).toBe('abc123def456-3');
    });

    it('should handle many collisions', () => {
      const existingEids = new Set([
        'abc123def456',
        'abc123def456-2',
        'abc123def456-3',
        'abc123def456-4',
        'abc123def456-5',
      ]);
      const resolved = resolveEidCollision('abc123def456', existingEids);
      expect(resolved).toBe('abc123def456-6');
    });

    it('should not modify base EID in place', () => {
      const baseEid = 'abc123def456';
      const existingEids = new Set([baseEid]);
      resolveEidCollision(baseEid, existingEids);
      // Original should be unchanged
      expect(existingEids.has('abc123def456')).toBe(true);
      expect(existingEids.has('abc123def456-2')).toBe(false);
    });
  });

  describe('buildElementIdentity', () => {
    it('should build complete identity object', () => {
      const node = createNode({
        kind: 'button',
        label: 'Submit Form',
        where: {
          region: 'main',
          group_path: ['Login', 'Actions'],
        },
        layout: {
          bbox: { x: 100, y: 100, w: 50, h: 30 },
          screen_zone: 'above-fold',
        },
        attributes: { role: 'button' },
      });

      const identity = buildElementIdentity(node, 'abc123def456', 'main', 5);

      expect(identity.eid).toBe('abc123def456');
      expect(identity.role).toBe('button');
      expect(identity.name).toBe('Submit Form');
      expect(identity.landmarkPath).toEqual(['Login', 'Actions']);
      expect(identity.nthOfType).toBe(1); // above-fold
      expect(identity.layer).toBe('main');
      expect(identity.lastSeenStep).toBe(5);
    });

    it('should use kind when role not present', () => {
      const node = createNode({
        kind: 'input',
        label: 'Email',
      });

      const identity = buildElementIdentity(node, 'abc123def456', 'main', 1);
      expect(identity.role).toBe('input');
    });

    it('should include href for links', () => {
      const node = createNode({
        kind: 'link',
        label: 'Home',
        attributes: { href: '/home' },
      });

      const identity = buildElementIdentity(node, 'abc123def456', 'main', 1);
      expect(identity.href).toBe('/home');
    });

    it('should handle missing href', () => {
      const node = createNode({
        kind: 'button',
        label: 'Submit',
      });

      const identity = buildElementIdentity(node, 'abc123def456', 'main', 1);
      expect(identity.href).toBeUndefined();
    });

    it('should copy group_path array', () => {
      const originalPath = ['Products', 'Electronics'];
      const node = createNode({
        where: {
          region: 'main',
          group_path: originalPath,
        },
      });

      const identity = buildElementIdentity(node, 'abc123def456', 'main', 1);

      // Should be a copy, not same reference
      expect(identity.landmarkPath).toEqual(originalPath);
      expect(identity.landmarkPath).not.toBe(originalPath);
    });
  });

  describe('EID Stability', () => {
    it('should generate same EID for semantically equivalent nodes', () => {
      // Simulate same element across two snapshots
      const nodeSnapshot1 = createNode({
        node_id: 'n1', // Different node_id
        backend_node_id: 100, // Different backend_node_id
        kind: 'button',
        label: 'Add to Cart',
        where: { region: 'main', group_path: ['Products'] },
        layout: { bbox: { x: 100, y: 200, w: 80, h: 40 }, screen_zone: 'above-fold' },
      });

      const nodeSnapshot2 = createNode({
        node_id: 'n42', // Different node_id
        backend_node_id: 200, // Different backend_node_id
        kind: 'button',
        label: 'Add to Cart',
        where: { region: 'main', group_path: ['Products'] },
        layout: { bbox: { x: 100, y: 200, w: 80, h: 40 }, screen_zone: 'above-fold' },
      });

      // EID should be same because semantic components match
      expect(computeEid(nodeSnapshot1)).toBe(computeEid(nodeSnapshot2));
    });

    it('should differentiate elements with same label but different positions', () => {
      const button1 = createNode({
        label: 'Delete',
        where: { region: 'main', group_path: ['Row 1'] },
        layout: { bbox: { x: 100, y: 100, w: 50, h: 30 }, screen_zone: 'above-fold' },
      });

      const button2 = createNode({
        label: 'Delete',
        where: { region: 'main', group_path: ['Row 2'] },
        layout: { bbox: { x: 100, y: 200, w: 50, h: 30 }, screen_zone: 'above-fold' },
      });

      // Should be different due to different group_path
      expect(computeEid(button1)).not.toBe(computeEid(button2));
    });
  });
});
