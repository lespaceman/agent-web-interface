/**
 * Snapshot Compiler - Option Synthesis Tests
 *
 * Tests that <option> elements inside <select> dropdowns are surfaced
 * in semantic snapshots, even though they have zero-sized bounding boxes
 * and are often ignored in the AX tree.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SnapshotCompiler } from '../../../src/snapshot/snapshot-compiler.js';
import { createMockCdpClient, MockCdpClient } from '../../mocks/cdp-client.mock.js';
import type { Page } from 'puppeteer-core';
import { createMockPage } from '../../mocks/puppeteer.mock.js';

/**
 * Build a DOM tree containing a <select> with <option> children.
 * Each option has a text node child carrying its label.
 */
function buildSelectDom() {
  return {
    root: {
      nodeId: 1,
      backendNodeId: 1,
      nodeType: 9,
      nodeName: '#document',
      children: [
        {
          nodeId: 2,
          backendNodeId: 2,
          nodeType: 1,
          nodeName: 'HTML',
          children: [
            {
              nodeId: 3,
              backendNodeId: 3,
              nodeType: 1,
              nodeName: 'BODY',
              children: [
                {
                  nodeId: 10,
                  backendNodeId: 10,
                  nodeType: 1,
                  nodeName: 'SELECT',
                  attributes: ['name', 'color'],
                  children: [
                    {
                      nodeId: 11,
                      backendNodeId: 11,
                      nodeType: 1,
                      nodeName: 'OPTION',
                      attributes: ['value', 'red', 'selected', ''],
                      children: [
                        {
                          nodeId: 12,
                          backendNodeId: 12,
                          nodeType: 3,
                          nodeName: '#text',
                          nodeValue: 'Red',
                        },
                      ],
                    },
                    {
                      nodeId: 13,
                      backendNodeId: 13,
                      nodeType: 1,
                      nodeName: 'OPTION',
                      attributes: ['value', 'blue'],
                      children: [
                        {
                          nodeId: 14,
                          backendNodeId: 14,
                          nodeType: 3,
                          nodeName: '#text',
                          nodeValue: 'Blue',
                        },
                      ],
                    },
                    {
                      nodeId: 15,
                      backendNodeId: 15,
                      nodeType: 1,
                      nodeName: 'OPTION',
                      attributes: ['value', 'green', 'disabled', ''],
                      children: [
                        {
                          nodeId: 16,
                          backendNodeId: 16,
                          nodeType: 3,
                          nodeName: '#text',
                          nodeValue: 'Green',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/**
 * Build a DOM tree with <optgroup> containing nested <option> elements.
 */
function buildOptgroupDom() {
  return {
    root: {
      nodeId: 1,
      backendNodeId: 1,
      nodeType: 9,
      nodeName: '#document',
      children: [
        {
          nodeId: 2,
          backendNodeId: 2,
          nodeType: 1,
          nodeName: 'HTML',
          children: [
            {
              nodeId: 3,
              backendNodeId: 3,
              nodeType: 1,
              nodeName: 'BODY',
              children: [
                {
                  nodeId: 10,
                  backendNodeId: 10,
                  nodeType: 1,
                  nodeName: 'SELECT',
                  attributes: ['name', 'car'],
                  children: [
                    {
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'OPTGROUP',
                      attributes: ['label', 'Swedish Cars'],
                      children: [
                        {
                          nodeId: 21,
                          backendNodeId: 21,
                          nodeType: 1,
                          nodeName: 'OPTION',
                          attributes: ['value', 'volvo'],
                          children: [
                            {
                              nodeId: 22,
                              backendNodeId: 22,
                              nodeType: 3,
                              nodeName: '#text',
                              nodeValue: 'Volvo',
                            },
                          ],
                        },
                        {
                          nodeId: 23,
                          backendNodeId: 23,
                          nodeType: 1,
                          nodeName: 'OPTION',
                          attributes: ['value', 'saab'],
                          children: [
                            {
                              nodeId: 24,
                              backendNodeId: 24,
                              nodeType: 3,
                              nodeName: '#text',
                              nodeValue: 'Saab',
                            },
                          ],
                        },
                      ],
                    },
                    {
                      nodeId: 30,
                      backendNodeId: 30,
                      nodeType: 1,
                      nodeName: 'OPTGROUP',
                      attributes: ['label', 'German Cars'],
                      children: [
                        {
                          nodeId: 31,
                          backendNodeId: 31,
                          nodeType: 1,
                          nodeName: 'OPTION',
                          attributes: ['value', 'bmw'],
                          children: [
                            {
                              nodeId: 32,
                              backendNodeId: 32,
                              nodeType: 3,
                              nodeName: '#text',
                              nodeValue: 'BMW',
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/**
 * Build AX tree that includes the select but NOT option nodes
 * (simulating Chrome's behavior of ignoring option nodes when collapsed).
 */
function buildAxTreeWithSelect(includeOptions = false) {
  const nodes = [
    {
      nodeId: 'ax-1',
      backendDOMNodeId: 1,
      role: { value: 'WebArea' },
      name: { value: 'Test' },
      ignored: false,
    },
    {
      nodeId: 'ax-10',
      backendDOMNodeId: 10,
      role: { value: 'combobox' },
      name: { value: 'color' },
      ignored: false,
      properties: [{ name: 'focusable', value: { value: true } }],
    },
  ];

  if (includeOptions) {
    nodes.push(
      {
        nodeId: 'ax-11',
        backendDOMNodeId: 11,
        role: { value: 'option' },
        name: { value: 'Red' },
        ignored: false,
        properties: [{ name: 'selected', value: { value: true } }],
      } as (typeof nodes)[0],
      {
        nodeId: 'ax-13',
        backendDOMNodeId: 13,
        role: { value: 'option' },
        name: { value: 'Blue' },
        ignored: false,
        properties: [],
      } as (typeof nodes)[0]
    );
  }

  return { nodes };
}

function setupDefaultCdpResponses(mockCdp: MockCdpClient) {
  mockCdp.setResponse('DOM.getBoxModel', {
    model: {
      content: [100, 100, 200, 100, 200, 130, 100, 130],
      width: 100,
      height: 30,
    },
  });
  mockCdp.setResponse('CSS.getComputedStyleForNode', {
    computedStyle: [
      { name: 'display', value: 'block' },
      { name: 'visibility', value: 'visible' },
    ],
  });
  mockCdp.setResponse('Page.getFrameTree', {
    frameTree: {
      frame: { id: 'main-frame', loaderId: 'loader-1' },
    },
  });
}

describe('SnapshotCompiler - Option Synthesis', () => {
  let mockCdp: MockCdpClient;
  let mockPage: Page;

  beforeEach(() => {
    mockCdp = createMockCdpClient();
    mockPage = createMockPage({
      url: 'https://example.com/',
      title: 'Select Test',
    }) as unknown as Page;
    setupDefaultCdpResponses(mockCdp);
  });

  it('should include option nodes in snapshot for native select', async () => {
    mockCdp.setResponse('DOM.getDocument', buildSelectDom());
    mockCdp.setResponse('Accessibility.getFullAXTree', buildAxTreeWithSelect(false));

    const compiler = new SnapshotCompiler();
    const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

    const optionNodes = snapshot.nodes.filter((n) => n.kind === 'menuitem');
    expect(optionNodes.length).toBe(3);

    const labels = optionNodes.map((n) => n.label);
    expect(labels).toContain('Red');
    expect(labels).toContain('Blue');
    expect(labels).toContain('Green');
  });

  it('should include value attribute on option nodes', async () => {
    mockCdp.setResponse('DOM.getDocument', buildSelectDom());
    mockCdp.setResponse('Accessibility.getFullAXTree', buildAxTreeWithSelect(false));

    const compiler = new SnapshotCompiler({ include_values: true });
    const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

    const optionNodes = snapshot.nodes.filter((n) => n.kind === 'menuitem');
    const redOption = optionNodes.find((n) => n.label === 'Red');
    expect(redOption?.attributes?.value).toBe('red');
  });

  it('should mark selected option with selected state', async () => {
    mockCdp.setResponse('DOM.getDocument', buildSelectDom());
    mockCdp.setResponse('Accessibility.getFullAXTree', buildAxTreeWithSelect(false));

    const compiler = new SnapshotCompiler();
    const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

    const optionNodes = snapshot.nodes.filter((n) => n.kind === 'menuitem');
    const redOption = optionNodes.find((n) => n.label === 'Red');
    const blueOption = optionNodes.find((n) => n.label === 'Blue');

    expect(redOption?.state?.selected).toBe(true);
    expect(blueOption?.state?.selected).toBeUndefined();
  });

  it('should mark disabled option with enabled=false state', async () => {
    mockCdp.setResponse('DOM.getDocument', buildSelectDom());
    mockCdp.setResponse('Accessibility.getFullAXTree', buildAxTreeWithSelect(false));

    const compiler = new SnapshotCompiler();
    const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

    const optionNodes = snapshot.nodes.filter((n) => n.kind === 'menuitem');
    const greenOption = optionNodes.find((n) => n.label === 'Green');

    expect(greenOption?.state?.enabled).toBe(false);
  });

  it('should include options inside optgroup elements', async () => {
    mockCdp.setResponse('DOM.getDocument', buildOptgroupDom());
    mockCdp.setResponse('Accessibility.getFullAXTree', buildAxTreeWithSelect(false));

    const compiler = new SnapshotCompiler();
    const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

    const optionNodes = snapshot.nodes.filter((n) => n.kind === 'menuitem');
    expect(optionNodes.length).toBe(3);

    const labels = optionNodes.map((n) => n.label);
    expect(labels).toContain('Volvo');
    expect(labels).toContain('Saab');
    expect(labels).toContain('BMW');
  });

  it('should not duplicate options already present in AX tree', async () => {
    mockCdp.setResponse('DOM.getDocument', buildSelectDom());
    // AX tree includes Red and Blue options (but not Green)
    mockCdp.setResponse('Accessibility.getFullAXTree', buildAxTreeWithSelect(true));

    const compiler = new SnapshotCompiler();
    const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

    // Count how many option-like nodes exist for Red specifically
    const redOptions = snapshot.nodes.filter(
      (n) => n.label === 'Red' && (n.kind === 'menuitem' || n.backend_node_id === 11)
    );
    expect(redOptions.length).toBe(1);
  });

  it('should handle option with empty text', async () => {
    const dom = buildSelectDom();
    // Replace Blue option's text with empty
    const body = dom.root.children[0].children[0];
    const select = body.children[0];
    select.children[1] = {
      nodeId: 13,
      backendNodeId: 13,
      nodeType: 1,
      nodeName: 'OPTION',
      attributes: ['value', ''],
      children: [
        {
          nodeId: 14,
          backendNodeId: 14,
          nodeType: 3,
          nodeName: '#text',
          nodeValue: '',
        },
      ],
    };

    mockCdp.setResponse('DOM.getDocument', dom);
    mockCdp.setResponse('Accessibility.getFullAXTree', buildAxTreeWithSelect(false));

    const compiler = new SnapshotCompiler();
    const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

    // Should still include the option even with empty text (it has a value)
    // At minimum the other options should be present
    const optionNodes = snapshot.nodes.filter((n) => n.kind === 'menuitem');
    expect(optionNodes.length).toBeGreaterThanOrEqual(2);
  });

  it('should make option nodes visible despite zero bounding boxes', async () => {
    mockCdp.setResponse('DOM.getDocument', buildSelectDom());
    mockCdp.setResponse('Accessibility.getFullAXTree', buildAxTreeWithSelect(false));

    // Return zero bounding boxes for option nodes (OS-rendered)
    mockCdp.setResponse('DOM.getBoxModel', (params: Record<string, unknown> | undefined) => {
      const nodeId = params?.backendNodeId as number;
      if (nodeId === 11 || nodeId === 13 || nodeId === 15) {
        // Options have zero-size bbox
        return {
          model: {
            content: [0, 0, 0, 0, 0, 0, 0, 0],
            width: 0,
            height: 0,
          },
        };
      }
      return {
        model: {
          content: [100, 100, 200, 100, 200, 130, 100, 130],
          width: 100,
          height: 30,
        },
      };
    });

    const compiler = new SnapshotCompiler({ include_hidden: false });
    const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

    const optionNodes = snapshot.nodes.filter((n) => n.kind === 'menuitem');
    expect(optionNodes.length).toBe(3);

    // All options should be visible
    for (const opt of optionNodes) {
      expect(opt.state?.visible).not.toBe(false);
    }
  });
});
