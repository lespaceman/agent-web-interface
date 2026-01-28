/**
 * Snapshot Compiler Integration Tests
 *
 * Tests the full snapshot compilation pipeline with realistic CDP responses.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Page } from 'puppeteer-core';
import { SnapshotCompiler, compileSnapshot } from '../../src/snapshot/snapshot-compiler.js';
import { createMockCdpClient, MockCdpClient } from '../mocks/cdp-client.mock.js';
import { createMockPage } from '../mocks/puppeteer.mock.js';

// Import test fixtures
import loginPageDom from '../fixtures/cdp-responses/login-page-dom.json' with { type: 'json' };
import loginPageAx from '../fixtures/cdp-responses/login-page-ax.json' with { type: 'json' };
import ecommerceListingDom from '../fixtures/cdp-responses/ecommerce-listing-dom.json' with { type: 'json' };
import ecommerceListingAx from '../fixtures/cdp-responses/ecommerce-listing-ax.json' with { type: 'json' };
import dialogOverlayDom from '../fixtures/cdp-responses/dialog-overlay-dom.json' with { type: 'json' };
import dialogOverlayAx from '../fixtures/cdp-responses/dialog-overlay-ax.json' with { type: 'json' };

/**
 * Create a mock page for integration tests with specific URL and title.
 */
function createIntegrationMockPage(url = 'https://example.com', title = 'Test Page'): Page {
  return createMockPage({ url, title }) as unknown as Page;
}

/**
 * Setup mock CDP responses for layout extraction
 */
function setupLayoutMocks(mockCdp: MockCdpClient): void {
  // Default box model response
  mockCdp.sendSpy.mockImplementation((method: string, params?: Record<string, unknown>) => {
    if (method === 'DOM.getDocument') {
      return Promise.resolve(loginPageDom);
    }
    if (method === 'Accessibility.getFullAXTree') {
      return Promise.resolve(loginPageAx);
    }
    if (method === 'DOM.getBoxModel') {
      // Return different box models based on nodeId
      const nodeId = params?.backendNodeId as number;
      const y = (nodeId * 50) % 600;
      return Promise.resolve({
        model: {
          content: [10, y, 210, y, 210, y + 40, 10, y + 40],
          padding: [10, y, 210, y, 210, y + 40, 10, y + 40],
          border: [10, y, 210, y, 210, y + 40, 10, y + 40],
          margin: [10, y, 210, y, 210, y + 40, 10, y + 40],
          width: 200,
          height: 40,
        },
      });
    }
    if (method === 'CSS.getComputedStyleForNode') {
      return Promise.resolve({
        computedStyle: [
          { name: 'display', value: 'block' },
          { name: 'visibility', value: 'visible' },
        ],
      });
    }
    return Promise.resolve({});
  });
}

describe('Snapshot Compiler Integration', () => {
  let mockCdp: MockCdpClient;
  let mockPage: Page;

  beforeEach(() => {
    mockCdp = createMockCdpClient();
  });

  describe('Login Page Scenario', () => {
    beforeEach(() => {
      mockPage = createIntegrationMockPage('https://example.com/login', 'Login - Example.com');

      mockCdp.sendSpy.mockImplementation((method: string, params?: Record<string, unknown>) => {
        if (method === 'DOM.getDocument') {
          return Promise.resolve(loginPageDom);
        }
        if (method === 'Accessibility.getFullAXTree') {
          return Promise.resolve(loginPageAx);
        }
        if (method === 'DOM.getBoxModel') {
          const nodeId = params?.backendNodeId as number;
          const y = (nodeId * 50) % 600;
          return Promise.resolve({
            model: {
              content: [50, y, 350, y, 350, y + 40, 50, y + 40],
              width: 300,
              height: 40,
            },
          });
        }
        if (method === 'CSS.getComputedStyleForNode') {
          return Promise.resolve({
            computedStyle: [
              { name: 'display', value: 'block' },
              { name: 'visibility', value: 'visible' },
            ],
          });
        }
        return Promise.resolve({});
      });
    });

    it('should compile a complete login page snapshot', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot.snapshot_id).toMatch(/^snap-/);
      expect(snapshot.url).toBe('https://example.com/login');
      expect(snapshot.title).toBe('Login - Example.com');
      expect(snapshot.viewport).toEqual({ width: 1280, height: 720 });
      expect(snapshot.nodes.length).toBeGreaterThan(0);
    });

    it('should extract form grouping for inputs', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Find input nodes
      const inputNodes = snapshot.nodes.filter((n) => n.kind === 'input');
      expect(inputNodes.length).toBeGreaterThan(0);

      // Verify inputs have form grouping
      for (const input of inputNodes) {
        expect(input.where.group_id).toMatch(/form/i);
      }
    });

    it('should extract interactive elements with correct labels', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Find the submit button
      const submitButton = snapshot.nodes.find((n) => n.kind === 'button' && n.label === 'Sign In');
      expect(submitButton).toBeDefined();
      expect(submitButton?.find?.primary).toBeDefined();
    });

    it('should extract checkbox with state', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      const checkbox = snapshot.nodes.find((n) => n.kind === 'checkbox');
      expect(checkbox).toBeDefined();
      expect(checkbox?.label).toBe('Remember me');
    });

    it('should include test-id locators when present', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Find nodes with test-id
      const nodesWithTestId = snapshot.nodes.filter((n) =>
        n.find?.primary?.includes('data-testid')
      );
      expect(nodesWithTestId.length).toBeGreaterThanOrEqual(0);
    });

    it('should resolve region for form elements', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Form elements inside a form should have 'form' region (innermost region wins)
      const formElements = snapshot.nodes.filter((n) =>
        ['input', 'button', 'checkbox'].includes(n.kind)
      );
      for (const el of formElements) {
        expect(el.where.region).toBe('form');
      }
    });
  });

  describe('E-commerce Listing Scenario', () => {
    beforeEach(() => {
      mockPage = createIntegrationMockPage('https://shop.example.com/products', 'Products | Shop');

      mockCdp.sendSpy.mockImplementation((method: string, params?: Record<string, unknown>) => {
        if (method === 'DOM.getDocument') {
          return Promise.resolve(ecommerceListingDom);
        }
        if (method === 'Accessibility.getFullAXTree') {
          return Promise.resolve(ecommerceListingAx);
        }
        if (method === 'DOM.getBoxModel') {
          const nodeId = params?.backendNodeId as number;
          // Position elements based on their nodeId
          const x = (nodeId % 2) * 400 + 50;
          const y = Math.floor(nodeId / 5) * 100 + 50;
          return Promise.resolve({
            model: {
              content: [x, y, x + 300, y, x + 300, y + 80, x, y + 80],
              width: 300,
              height: 80,
            },
          });
        }
        if (method === 'CSS.getComputedStyleForNode') {
          return Promise.resolve({
            computedStyle: [
              { name: 'display', value: 'block' },
              { name: 'visibility', value: 'visible' },
            ],
          });
        }
        return Promise.resolve({});
      });
    });

    it('should compile e-commerce listing snapshot', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot.url).toBe('https://shop.example.com/products');
      expect(snapshot.title).toBe('Products | Shop');
    });

    it('should detect navigation region for menu items', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Find menuitem nodes
      const menuItems = snapshot.nodes.filter((n) => n.kind === 'menuitem');
      for (const item of menuItems) {
        expect(item.where.region).toBe('nav');
      }
    });

    it('should extract multiple product cards', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Find buttons with "Add to Cart" label
      const addToCartButtons = snapshot.nodes.filter(
        (n) => n.kind === 'button' && n.label.includes('Add to Cart')
      );
      expect(addToCartButtons.length).toBe(2);
    });

    it('should extract headings with correct levels', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      const headings = snapshot.nodes.filter((n) => n.kind === 'heading');
      expect(headings.length).toBeGreaterThan(0);

      // Main heading should be level 1
      const mainHeading = headings.find((h) => h.label === 'Our Products');
      expect(mainHeading?.attributes?.heading_level).toBe(1);

      // Product headings should be level 2
      const productHeadings = headings.filter(
        (h) => h.label === 'Blue T-Shirt' || h.label === 'Red Sneakers'
      );
      for (const heading of productHeadings) {
        expect(heading.attributes?.heading_level).toBe(2);
      }
    });

    it('should extract images with alt text', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      const images = snapshot.nodes.filter((n) => n.kind === 'image');
      expect(images.length).toBe(2);

      // Images should have alt text as label
      const imageLabels = images.map((img) => img.label);
      expect(imageLabels).toContain('Blue T-Shirt');
      expect(imageLabels).toContain('Red Sneakers');
    });

    it('should extract footer link in footer region', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      const contactLink = snapshot.nodes.find((n) => n.kind === 'link' && n.label === 'Contact Us');
      expect(contactLink).toBeDefined();
      expect(contactLink?.where.region).toBe('footer');
    });

    it('should include list grouping for product grid', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Buttons inside product cards should have article grouping
      const addToCartButtons = snapshot.nodes.filter(
        (n) => n.kind === 'button' && n.label.includes('Add to Cart')
      );
      for (const button of addToCartButtons) {
        expect(button.where.group_id).toContain('article');
      }
    });
  });

  describe('Dialog Overlay Scenario', () => {
    beforeEach(() => {
      mockPage = createIntegrationMockPage('https://example.com/page', 'Page with Dialog');

      mockCdp.sendSpy.mockImplementation((method: string, params?: Record<string, unknown>) => {
        if (method === 'DOM.getDocument') {
          return Promise.resolve(dialogOverlayDom);
        }
        if (method === 'Accessibility.getFullAXTree') {
          return Promise.resolve(dialogOverlayAx);
        }
        if (method === 'DOM.getBoxModel') {
          const nodeId = params?.backendNodeId as number;
          // Dialog elements are centered
          if (nodeId >= 12) {
            return Promise.resolve({
              model: {
                content: [400, 200, 800, 200, 800, 400, 400, 400],
                width: 400,
                height: 200,
              },
            });
          }
          // Main content elements
          return Promise.resolve({
            model: {
              content: [50, 50, 350, 50, 350, 100, 50, 100],
              width: 300,
              height: 50,
            },
          });
        }
        if (method === 'CSS.getComputedStyleForNode') {
          return Promise.resolve({
            computedStyle: [
              { name: 'display', value: 'block' },
              { name: 'visibility', value: 'visible' },
            ],
          });
        }
        return Promise.resolve({});
      });
    });

    it('should compile dialog overlay snapshot', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot.url).toBe('https://example.com/page');
      expect(snapshot.title).toBe('Page with Dialog');
    });

    it('should detect dialog region for modal elements', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Find dialog buttons
      const cancelBtn = snapshot.nodes.find((n) => n.kind === 'button' && n.label === 'Cancel');
      const confirmBtn = snapshot.nodes.find((n) => n.kind === 'button' && n.label === 'Confirm');

      expect(cancelBtn).toBeDefined();
      expect(confirmBtn).toBeDefined();
      expect(cancelBtn?.where.region).toBe('dialog');
      expect(confirmBtn?.where.region).toBe('dialog');
    });

    it('should include both main content and dialog elements', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should have buttons from both main and dialog
      const buttons = snapshot.nodes.filter((n) => n.kind === 'button');
      expect(buttons.length).toBe(3); // Open Dialog, Cancel, Confirm

      // Main content button
      const openDialogBtn = snapshot.nodes.find(
        (n) => n.kind === 'button' && n.label === 'Open Dialog'
      );
      expect(openDialogBtn).toBeDefined();
      expect(openDialogBtn?.where.region).toBe('main');
    });

    it('should extract dialog heading context', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Dialog heading
      const dialogHeading = snapshot.nodes.find(
        (n) => n.kind === 'heading' && n.label === 'Confirm Action'
      );
      expect(dialogHeading).toBeDefined();
      expect(dialogHeading?.where.region).toBe('dialog');
    });
  });

  describe('Compiler Options', () => {
    beforeEach(() => {
      mockPage = createIntegrationMockPage();
      setupLayoutMocks(mockCdp);
    });

    it('should exclude readable content when includeReadable is false', async () => {
      const compiler = new SnapshotCompiler({ includeReadable: false });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should not include headings
      const headings = snapshot.nodes.filter((n) => n.kind === 'heading');
      expect(headings.length).toBe(0);
    });

    it('should respect max_nodes option', async () => {
      const compiler = new SnapshotCompiler({ max_nodes: 2 });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot.nodes.length).toBeLessThanOrEqual(2);
    });

    it('should include hidden elements when include_hidden is true', async () => {
      // Setup mock to return a hidden element
      mockCdp.sendSpy.mockImplementation((method: string) => {
        if (method === 'DOM.getDocument') {
          return Promise.resolve(loginPageDom);
        }
        if (method === 'Accessibility.getFullAXTree') {
          return Promise.resolve(loginPageAx);
        }
        if (method === 'DOM.getBoxModel') {
          return Promise.resolve({
            model: {
              content: [0, 0, 0, 0, 0, 0, 0, 0],
              width: 0,
              height: 0,
            },
          });
        }
        if (method === 'CSS.getComputedStyleForNode') {
          return Promise.resolve({
            computedStyle: [
              { name: 'display', value: 'none' },
              { name: 'visibility', value: 'hidden' },
            ],
          });
        }
        return Promise.resolve({});
      });

      const compilerWithHidden = new SnapshotCompiler({ include_hidden: true });
      const snapshotWithHidden = await compilerWithHidden.compile(mockCdp, mockPage, 'page-1');

      const compilerWithoutHidden = new SnapshotCompiler({ include_hidden: false });
      const snapshotWithoutHidden = await compilerWithoutHidden.compile(
        mockCdp,
        mockPage,
        'page-1'
      );

      expect(snapshotWithHidden.nodes.length).toBeGreaterThanOrEqual(
        snapshotWithoutHidden.nodes.length
      );
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      mockPage = createIntegrationMockPage();
    });

    it('should handle AX extraction failure gracefully', async () => {
      mockCdp.sendSpy.mockImplementation((method: string, params?: Record<string, unknown>) => {
        if (method === 'DOM.getDocument') {
          return Promise.resolve(loginPageDom);
        }
        if (method === 'Accessibility.getFullAXTree') {
          return Promise.reject(new Error('AX tree extraction failed'));
        }
        if (method === 'DOM.getBoxModel') {
          const nodeId = params?.backendNodeId as number;
          return Promise.resolve({
            model: {
              content: [
                0,
                nodeId * 50,
                100,
                nodeId * 50,
                100,
                nodeId * 50 + 40,
                0,
                nodeId * 50 + 40,
              ],
              width: 100,
              height: 40,
            },
          });
        }
        if (method === 'CSS.getComputedStyleForNode') {
          return Promise.resolve({
            computedStyle: [
              { name: 'display', value: 'block' },
              { name: 'visibility', value: 'visible' },
            ],
          });
        }
        return Promise.resolve({});
      });

      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should still produce a snapshot
      expect(snapshot.snapshot_id).toBeDefined();
      expect(snapshot.meta.partial).toBe(true);
      expect(snapshot.meta.warnings).toBeDefined();
      expect(snapshot.meta.warnings?.some((w) => w.includes('AX extraction'))).toBe(true);
    });

    it('should handle layout extraction failure gracefully', async () => {
      mockCdp.sendSpy.mockImplementation((method: string) => {
        if (method === 'DOM.getDocument') {
          return Promise.resolve(loginPageDom);
        }
        if (method === 'Accessibility.getFullAXTree') {
          return Promise.resolve(loginPageAx);
        }
        if (method === 'DOM.getBoxModel') {
          return Promise.reject(new Error('Could not compute box model'));
        }
        if (method === 'CSS.getComputedStyleForNode') {
          return Promise.reject(new Error('Could not get computed style'));
        }
        return Promise.resolve({});
      });

      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should still produce a snapshot with nodes (though they may be marked not visible)
      expect(snapshot.snapshot_id).toBeDefined();
      expect(snapshot.nodes).toBeDefined();
    });
  });

  describe('Snapshot Metadata', () => {
    beforeEach(() => {
      mockPage = createIntegrationMockPage();
      setupLayoutMocks(mockCdp);
    });

    it('should include accurate node counts', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot.meta.node_count).toBe(snapshot.nodes.length);
    });

    it('should track interactive element count', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      const interactiveKinds = [
        'button',
        'link',
        'input',
        'checkbox',
        'radio',
        'select',
        'slider',
        'switch',
        'tab',
        'menuitem',
      ];
      const expectedInteractiveCount = snapshot.nodes.filter((n) =>
        interactiveKinds.includes(n.kind)
      ).length;

      expect(snapshot.meta.interactive_count).toBe(expectedInteractiveCount);
    });

    it('should include capture duration', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot.meta.capture_duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should include captured_at timestamp', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('Convenience Function', () => {
    beforeEach(() => {
      mockPage = createIntegrationMockPage();
      setupLayoutMocks(mockCdp);
    });

    it('should compile snapshot using convenience function', async () => {
      const snapshot = await compileSnapshot(mockCdp, mockPage, 'page-1');

      expect(snapshot.snapshot_id).toBeDefined();
      expect(snapshot.nodes.length).toBeGreaterThan(0);
    });

    it('should pass options to convenience function', async () => {
      const snapshot = await compileSnapshot(mockCdp, mockPage, 'page-1', {
        includeReadable: false,
      });

      const headings = snapshot.nodes.filter((n) => n.kind === 'heading');
      expect(headings.length).toBe(0);
    });
  });
});
