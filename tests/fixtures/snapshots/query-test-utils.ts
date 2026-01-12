/**
 * Query Engine Test Utilities
 *
 * Helper functions for creating test nodes and snapshots.
 */

import { expect } from 'vitest';
import type {
  ReadableNode,
  BaseSnapshot,
  NodeKind,
  SemanticRegion,
} from '../../../src/snapshot/snapshot.types.js';
import type { FindElementsResponse } from '../../../src/query/types/query.types.js';

// Counter for generating unique backend node IDs in tests
let testBackendNodeIdCounter = 10000;

/**
 * Create a minimal ReadableNode for testing
 */
export function createTestNode(overrides: Partial<ReadableNode> = {}): ReadableNode {
  return {
    node_id: 'test-node',
    backend_node_id: testBackendNodeIdCounter++,
    frame_id: 'test-frame-id',
    loader_id: 'test-loader-id',
    kind: 'generic',
    label: 'Test',
    where: { region: 'main' },
    layout: { bbox: { x: 0, y: 0, w: 100, h: 100 } },
    ...overrides,
  };
}

/**
 * Create a minimal BaseSnapshot for testing
 */
export function createTestSnapshot(nodes: ReadableNode[] = []): BaseSnapshot {
  return {
    snapshot_id: 'test-snapshot',
    url: 'https://example.com',
    title: 'Test Page',
    captured_at: new Date().toISOString(),
    viewport: { width: 1280, height: 720 },
    nodes,
    meta: {
      node_count: nodes.length,
      interactive_count: nodes.filter((n) => isInteractiveKind(n.kind)).length,
    },
  };
}

/**
 * Create an empty snapshot for edge case testing
 */
export function createEmptySnapshot(): BaseSnapshot {
  return createTestSnapshot([]);
}

/**
 * Create a button node
 */
export function createButtonNode(
  label: string,
  overrides: Partial<ReadableNode> = {}
): ReadableNode {
  return createTestNode({
    node_id: `button-${label.toLowerCase().replace(/\s+/g, '-')}`,
    kind: 'button',
    label,
    state: { visible: true, enabled: true },
    ...overrides,
  });
}

/**
 * Create an input node
 */
export function createInputNode(
  label: string,
  inputType = 'text',
  overrides: Partial<ReadableNode> = {}
): ReadableNode {
  return createTestNode({
    node_id: `input-${label.toLowerCase().replace(/\s+/g, '-')}`,
    kind: 'input',
    label,
    state: { visible: true, enabled: true },
    attributes: { input_type: inputType },
    ...overrides,
  });
}

/**
 * Create a link node
 */
export function createLinkNode(label: string, overrides: Partial<ReadableNode> = {}): ReadableNode {
  return createTestNode({
    node_id: `link-${label.toLowerCase().replace(/\s+/g, '-')}`,
    kind: 'link',
    label,
    state: { visible: true, enabled: true },
    attributes: { href: '#' },
    ...overrides,
  });
}

/**
 * Create a heading node
 */
export function createHeadingNode(
  label: string,
  level = 1,
  overrides: Partial<ReadableNode> = {}
): ReadableNode {
  return createTestNode({
    node_id: `heading-${label.toLowerCase().replace(/\s+/g, '-')}`,
    kind: 'heading',
    label,
    attributes: { heading_level: level },
    ...overrides,
  });
}

/**
 * Create a node in a specific region
 */
export function createNodeInRegion(
  region: SemanticRegion,
  overrides: Partial<ReadableNode> = {}
): ReadableNode {
  return createTestNode({
    node_id: `node-in-${region}`,
    where: { region },
    ...overrides,
  });
}

/**
 * Create a node in a specific group
 */
export function createNodeInGroup(
  groupId: string,
  overrides: Partial<ReadableNode> = {}
): ReadableNode {
  return createTestNode({
    node_id: `node-in-group-${groupId}`,
    where: { region: 'main', group_id: groupId },
    ...overrides,
  });
}

/**
 * Create a node with heading context
 */
export function createNodeWithHeadingContext(
  headingContext: string,
  overrides: Partial<ReadableNode> = {}
): ReadableNode {
  return createTestNode({
    node_id: `node-under-${headingContext.toLowerCase().replace(/\s+/g, '-')}`,
    where: { region: 'main', heading_context: headingContext },
    ...overrides,
  });
}

/**
 * Create multiple nodes with incrementing IDs
 */
export function createMultipleNodes(
  count: number,
  template: Partial<ReadableNode> = {}
): ReadableNode[] {
  return Array.from({ length: count }, (_, i) =>
    createTestNode({
      node_id: `node-${i + 1}`,
      label: `Node ${i + 1}`,
      ...template,
    })
  );
}

/**
 * Assert that response contains expected node IDs
 */
export function expectMatchedNodeIds(
  response: FindElementsResponse,
  expectedNodeIds: string[]
): void {
  const actualIds = response.matches.map((m) => m.node.node_id);
  expect(actualIds).toEqual(expectedNodeIds);
}

/**
 * Assert that response contains nodes with expected IDs (order-independent)
 */
export function expectMatchedNodeIdsUnordered(
  response: FindElementsResponse,
  expectedNodeIds: string[]
): void {
  const actualIds = response.matches.map((m) => m.node.node_id).sort();
  expect(actualIds).toEqual([...expectedNodeIds].sort());
}

/**
 * Check if a node kind is interactive
 */
function isInteractiveKind(kind: NodeKind): boolean {
  const interactiveKinds: NodeKind[] = [
    'link',
    'button',
    'input',
    'textarea',
    'select',
    'combobox',
    'checkbox',
    'radio',
    'switch',
    'slider',
    'tab',
    'menuitem',
  ];
  return interactiveKinds.includes(kind);
}
