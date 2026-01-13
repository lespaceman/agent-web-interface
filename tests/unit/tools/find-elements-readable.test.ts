/**
 * Find Elements Readable Tests
 *
 * Tests for the include_readable parameter in find_elements.
 */

import { describe, it, expect } from 'vitest';
import { isReadableNode, isStructuralNode } from '../../../src/snapshot/snapshot.types.js';
import type { ReadableNode, NodeKind } from '../../../src/snapshot/snapshot.types.js';
import { computeEid } from '../../../src/state/element-identity.js';

/**
 * Create a mock ReadableNode.
 */
function createMockNode(overrides: Partial<ReadableNode> = {}): ReadableNode {
  return {
    node_id: `n-${Math.random().toString(36).slice(2, 8)}`,
    backend_node_id: Math.floor(Math.random() * 10000),
    frame_id: 'frame-main',
    loader_id: 'loader-1',
    kind: 'button',
    label: 'Test Element',
    where: { region: 'main', group_path: [] },
    layout: { bbox: { x: 100, y: 100, w: 80, h: 40 }, screen_zone: 'above-fold' },
    state: { visible: true, enabled: true },
    ...overrides,
  };
}

describe('isReadableNode and isStructuralNode', () => {
  describe('isReadableNode', () => {
    it('should return true for readable kinds', () => {
      const readableKinds: NodeKind[] = [
        'heading',
        'paragraph',
        'text',
        'list',
        'listitem',
        'image',
        'media',
        'table',
      ];

      for (const kind of readableKinds) {
        const node = createMockNode({ kind });
        expect(isReadableNode(node)).toBe(true);
      }
    });

    it('should return false for interactive kinds', () => {
      const interactiveKinds: NodeKind[] = [
        'button',
        'link',
        'input',
        'textarea',
        'select',
        'checkbox',
        'radio',
      ];

      for (const kind of interactiveKinds) {
        const node = createMockNode({ kind });
        expect(isReadableNode(node)).toBe(false);
      }
    });
  });

  describe('isStructuralNode', () => {
    it('should return true for structural kinds', () => {
      const structuralKinds: NodeKind[] = ['form', 'dialog', 'navigation', 'section'];

      for (const kind of structuralKinds) {
        const node = createMockNode({ kind });
        expect(isStructuralNode(node)).toBe(true);
      }
    });

    it('should return false for non-structural kinds', () => {
      const nonStructuralKinds: NodeKind[] = ['button', 'heading', 'text', 'link'];

      for (const kind of nonStructuralKinds) {
        const node = createMockNode({ kind });
        expect(isStructuralNode(node)).toBe(false);
      }
    });
  });
});

describe('Readable EID Generation', () => {
  it('should generate stable semantic EID for readable nodes', () => {
    const textNode = createMockNode({
      kind: 'text',
      label: 'Cookie policy text',
      backend_node_id: 1234,
    });

    const eid1 = computeEid(textNode, 'main');
    const eid2 = computeEid(textNode, 'main');

    // Same node should produce same EID
    expect(eid1).toBe(eid2);
    // EID should be 12 hex characters
    expect(eid1).toMatch(/^[a-f0-9]{12}$/);
  });

  it('should generate different EIDs for nodes with different labels', () => {
    const node1 = createMockNode({ kind: 'heading', label: 'Privacy Policy' });
    const node2 = createMockNode({ kind: 'heading', label: 'Cookie Settings' });

    const eid1 = computeEid(node1, 'main');
    const eid2 = computeEid(node2, 'main');

    expect(eid1).not.toBe(eid2);
  });

  it('should generate different EIDs for same label in different layers', () => {
    const node = createMockNode({ kind: 'text', label: 'Privacy text' });

    const mainEid = computeEid(node, 'main');
    const modalEid = computeEid(node, 'modal');

    expect(mainEid).not.toBe(modalEid);
  });

  it('should generate rd- prefixed IDs for readable content', () => {
    const textNode = createMockNode({
      kind: 'text',
      label: 'Some readable content',
    });

    const baseEid = computeEid(textNode, 'main');
    const readableEid = `rd-${baseEid.substring(0, 10)}`;

    // Should be 13 chars: rd- prefix (3) + 10 hex chars
    expect(readableEid).toMatch(/^rd-[a-f0-9]{10}$/);
    expect(readableEid.length).toBe(13);
  });
});

describe('Find Elements include_readable behavior', () => {
  it('should identify interactive vs non-interactive nodes correctly', () => {
    const interactiveNode = createMockNode({ kind: 'button' });
    const readableNode = createMockNode({ kind: 'text' });
    const structuralNode = createMockNode({ kind: 'dialog' });

    // Interactive nodes should NOT be readable or structural
    expect(isReadableNode(interactiveNode)).toBe(false);
    expect(isStructuralNode(interactiveNode)).toBe(false);

    // Readable nodes should be readable but not structural
    expect(isReadableNode(readableNode)).toBe(true);
    expect(isStructuralNode(readableNode)).toBe(false);

    // Structural nodes should be structural but not readable
    expect(isReadableNode(structuralNode)).toBe(false);
    expect(isStructuralNode(structuralNode)).toBe(true);
  });

  it('should compute non-interactive status for EID generation', () => {
    const testCases = [
      { kind: 'button' as NodeKind, isNonInteractive: false },
      { kind: 'link' as NodeKind, isNonInteractive: false },
      { kind: 'input' as NodeKind, isNonInteractive: false },
      { kind: 'text' as NodeKind, isNonInteractive: true },
      { kind: 'heading' as NodeKind, isNonInteractive: true },
      { kind: 'paragraph' as NodeKind, isNonInteractive: true },
      { kind: 'dialog' as NodeKind, isNonInteractive: true },
      { kind: 'form' as NodeKind, isNonInteractive: true },
    ];

    for (const { kind, isNonInteractive } of testCases) {
      const node = createMockNode({ kind });
      const result = isReadableNode(node) || isStructuralNode(node);
      expect(result).toBe(isNonInteractive);
    }
  });
});
