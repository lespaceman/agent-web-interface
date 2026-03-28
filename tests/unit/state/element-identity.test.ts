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
  hashComponents,
  resolveEidCollision,
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

    it('should strip parenthesized counter patterns', () => {
      expect(normalizeAccessibleName('Cart (3)')).toBe('cart (#)');
      expect(normalizeAccessibleName('Notifications (42)')).toBe('notifications (#)');
    });

    it('should stabilize dynamic counters', () => {
      expect(normalizeAccessibleName('Cart (3)')).toBe(normalizeAccessibleName('Cart (4)'));
    });

    it('should strip trailing standalone numbers', () => {
      expect(normalizeAccessibleName('Page 3')).toBe('page #');
    });

    it('should preserve numbers that are part of names', () => {
      expect(normalizeAccessibleName('Boeing 747 Details')).toBe('boeing 747 details');
      expect(normalizeAccessibleName('v2.0')).toBe('v2.0');
      expect(normalizeAccessibleName('123 Main St')).toBe('123 main st');
    });

    it('should handle labels with no digits unchanged', () => {
      expect(normalizeAccessibleName('Submit Form')).toBe('submit form');
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

    it('should return empty string when no group_path', () => {
      const node = createNode({
        where: {
          region: 'main',
          group_path: [],
        },
        layout: {
          bbox: { x: 100, y: 100, w: 50, h: 30 },
          screen_zone: 'above-fold',
        },
      });
      const hint = computePositionHint(node);
      expect(hint).toBe('');
    });

    it('should not include viewport-dependent data (screen_zone, bbox)', () => {
      // Same element at different viewport positions should have same hint
      const nodeAtTop = createNode({
        where: {
          region: 'main',
          group_path: ['Products'],
        },
        layout: {
          bbox: { x: 100, y: 100, w: 50, h: 30 },
          screen_zone: 'above-fold',
        },
      });
      const nodeAtBottom = createNode({
        where: {
          region: 'main',
          group_path: ['Products'],
        },
        layout: {
          bbox: { x: 600, y: 800, w: 50, h: 30 },
          screen_zone: 'below-fold',
        },
      });
      expect(computePositionHint(nodeAtTop)).toBe(computePositionHint(nodeAtBottom));
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

    it('should generate same EID regardless of scroll position (viewport coordinates)', () => {
      // Simulate same element before and after scroll
      const nodeBeforeScroll = createNode({
        kind: 'button',
        label: 'Add to Cart',
        where: { region: 'main', group_path: ['Products'] },
        layout: { bbox: { x: 100, y: 200, w: 80, h: 40 }, screen_zone: 'top-center' },
      });

      const nodeAfterScroll = createNode({
        kind: 'button',
        label: 'Add to Cart',
        where: { region: 'main', group_path: ['Products'] },
        layout: { bbox: { x: 100, y: 600, w: 80, h: 40 }, screen_zone: 'bottom-center' },
      });

      // EID should be same - scroll should not affect identity
      expect(computeEid(nodeBeforeScroll)).toBe(computeEid(nodeAfterScroll));
    });
  });
});
