/**
 * Browser Tools Tests
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/unbound-method */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { Page, Locator } from 'playwright';
import type { SessionManager } from '../../../src/browser/session-manager.js';
import type { PageHandle } from '../../../src/browser/page-registry.js';
import type { BaseSnapshot } from '../../../src/snapshot/snapshot.types.js';
import type { compileSnapshot as CompileSnapshotType } from '../../../src/snapshot/snapshot-compiler.js';

// Mock modules at the top level (hoisted)
vi.mock('../../../src/browser/session-manager.js');
vi.mock('../../../src/snapshot/snapshot-compiler.js');

describe('BrowserTools', () => {
  // Mock instances - defined inside beforeEach
  let mockSessionManager: {
    launch: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    shutdown: ReturnType<typeof vi.fn>;
    createPage: ReturnType<typeof vi.fn>;
    adoptPage: ReturnType<typeof vi.fn>;
    getPage: ReturnType<typeof vi.fn>;
    closePage: ReturnType<typeof vi.fn>;
    navigateTo: ReturnType<typeof vi.fn>;
    getPageCount: ReturnType<typeof vi.fn>;
    touchPage: ReturnType<typeof vi.fn>;
    resolvePage: ReturnType<typeof vi.fn>;
    resolvePageOrCreate: ReturnType<typeof vi.fn>;
  };

  let mockPage: Page;
  let mockLocator: Locator;
  let mockCdp: { send: ReturnType<typeof vi.fn>; isActive: ReturnType<typeof vi.fn> };
  let mockPageHandle: PageHandle;

  // Import the module after mocking
  let browserTools: typeof import('../../../src/tools/browser-tools.js');
  let compileSnapshotMock: Mock<
    Parameters<typeof CompileSnapshotType>,
    ReturnType<typeof CompileSnapshotType>
  >;

  beforeEach(async () => {
    vi.resetModules();

    // Create mock CDP client
    mockCdp = {
      send: vi.fn(),
      isActive: vi.fn().mockReturnValue(true),
    };

    // Create mock locator
    mockLocator = {
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
    } as unknown as Locator;

    // Create mock page
    mockPage = {
      url: vi.fn().mockReturnValue('https://example.com'),
      title: vi.fn().mockResolvedValue('Example Domain'),
      viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
      getByRole: vi.fn().mockReturnValue(mockLocator),
      locator: vi.fn().mockReturnValue(mockLocator),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;

    // Create mock page handle
    mockPageHandle = {
      page_id: 'page-123',
      page: mockPage,
      cdp: mockCdp as unknown as PageHandle['cdp'],
      created_at: new Date(),
      url: 'https://example.com',
      title: 'Example Domain',
    };

    // Create mock session manager
    mockSessionManager = {
      launch: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      createPage: vi.fn().mockResolvedValue(mockPageHandle),
      adoptPage: vi.fn().mockResolvedValue(mockPageHandle),
      getPage: vi.fn().mockReturnValue(mockPageHandle),
      closePage: vi.fn().mockResolvedValue(true),
      navigateTo: vi.fn().mockResolvedValue(undefined),
      getPageCount: vi.fn().mockReturnValue(1),
      touchPage: vi.fn(),
      resolvePage: vi.fn().mockReturnValue(mockPageHandle),
      resolvePageOrCreate: vi.fn().mockResolvedValue(mockPageHandle),
    };

    // Mock the SessionManager module
    const sessionManagerModule = await import('../../../src/browser/session-manager.js');
    vi.mocked(sessionManagerModule.SessionManager).mockImplementation(
      () => mockSessionManager as unknown as SessionManager
    );

    // Mock compileSnapshot
    // Note: node_id is derived from backend_node_id for stability across snapshots
    const mockSnapshot: BaseSnapshot = {
      snapshot_id: 'snap-123',
      url: 'https://example.com',
      title: 'Example Domain',
      captured_at: new Date().toISOString(),
      viewport: { width: 1280, height: 720 },
      nodes: [
        {
          node_id: '12345', // Derived from backend_node_id
          backend_node_id: 12345, // CDP backendNodeId for direct clicking
          kind: 'link',
          label: 'More information...',
          where: { region: 'main' },
          layout: { bbox: { x: 100, y: 200, w: 150, h: 20 } },
          find: { primary: 'role=link[name="More information..."]' },
        },
      ],
      meta: { node_count: 1, interactive_count: 1 },
    };

    compileSnapshotMock = vi.fn<
      Parameters<typeof CompileSnapshotType>,
      ReturnType<typeof CompileSnapshotType>
    >(() => Promise.resolve(mockSnapshot));

    const snapshotCompilerModule = await import('../../../src/snapshot/snapshot-compiler.js');
    vi.mocked(snapshotCompilerModule.compileSnapshot).mockImplementation(compileSnapshotMock);

    // Import browser tools (which will use the mocked modules)
    browserTools = await import('../../../src/tools/browser-tools.js');

    // Initialize with our mock session manager
    browserTools.initializeTools(mockSessionManager as unknown as SessionManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('browserLaunch()', () => {
    it('should launch browser in launch mode', async () => {
      const result = await browserTools.browserLaunch({ mode: 'launch', headless: true });

      expect(mockSessionManager.launch).toHaveBeenCalledWith({ headless: true });
      expect(mockSessionManager.createPage).toHaveBeenCalled();
      expect(result.page_id).toBe('page-123');
      expect(result.mode).toBe('launched');
    });

    it('should connect to browser in connect mode', async () => {
      const result = await browserTools.browserLaunch({
        mode: 'connect',
        endpoint_url: 'http://127.0.0.1:9223',
      });

      expect(mockSessionManager.connect).toHaveBeenCalledWith({
        endpointUrl: 'http://127.0.0.1:9223',
      });
      expect(mockSessionManager.adoptPage).toHaveBeenCalledWith(0);
      expect(result.page_id).toBe('page-123');
      expect(result.mode).toBe('connected');
    });

    it('should create new page in connect mode when browser has no pages', async () => {
      // Simulate browser with 0 pages
      mockSessionManager.getPageCount.mockReturnValue(0);

      const result = await browserTools.browserLaunch({
        mode: 'connect',
        endpoint_url: 'http://127.0.0.1:9223',
      });

      expect(mockSessionManager.connect).toHaveBeenCalledWith({
        endpointUrl: 'http://127.0.0.1:9223',
      });
      // Should NOT call adoptPage since there are no pages
      expect(mockSessionManager.adoptPage).not.toHaveBeenCalled();
      // Should create a new page instead
      expect(mockSessionManager.createPage).toHaveBeenCalled();
      expect(result.page_id).toBe('page-123');
      expect(result.mode).toBe('connected');
    });

    it('should use default endpoint URL from env if not provided', async () => {
      // Set env vars for test
      const originalHost = process.env.CEF_BRIDGE_HOST;
      const originalPort = process.env.CEF_BRIDGE_PORT;
      process.env.CEF_BRIDGE_HOST = '192.168.1.100';
      process.env.CEF_BRIDGE_PORT = '9222';

      try {
        await browserTools.browserLaunch({ mode: 'connect' });

        expect(mockSessionManager.connect).toHaveBeenCalledWith({
          endpointUrl: 'http://192.168.1.100:9222',
        });
      } finally {
        // Restore env vars
        if (originalHost !== undefined) {
          process.env.CEF_BRIDGE_HOST = originalHost;
        } else {
          delete process.env.CEF_BRIDGE_HOST;
        }
        if (originalPort !== undefined) {
          process.env.CEF_BRIDGE_PORT = originalPort;
        } else {
          delete process.env.CEF_BRIDGE_PORT;
        }
      }
    });

    it('should return page_brief by default without factpack', async () => {
      const result = await browserTools.browserLaunch({ mode: 'launch', headless: true });

      // page_brief is always returned
      expect(result.page_brief).toBeDefined();
      expect(result.page_brief_tokens).toBeGreaterThan(0);
      // factpack is NOT returned by default
      expect(result.factpack).toBeUndefined();
    });

    it('should include factpack when include_factpack is true', async () => {
      const result = await browserTools.browserLaunch({
        mode: 'launch',
        headless: true,
        include_factpack: true,
      });

      expect(result.factpack).toBeDefined();
      expect(result.factpack!.meta.snapshot_id).toBe('snap-123');
      // page_brief should still be included
      expect(result.page_brief).toBeDefined();
    });
  });

  describe('browserNavigate()', () => {
    it('should navigate page to URL', async () => {
      const result = await browserTools.browserNavigate({
        page_id: 'page-123',
        url: 'https://example.com/page',
      });

      expect(mockSessionManager.navigateTo).toHaveBeenCalledWith(
        'page-123',
        'https://example.com/page'
      );
      expect(result.page_id).toBe('page-123');
      expect(result.title).toBe('Example Domain');
    });

    it('should throw error if page not found', async () => {
      mockSessionManager.resolvePageOrCreate.mockRejectedValue(
        new Error('Page not found: non-existent')
      );

      await expect(
        browserTools.browserNavigate({ page_id: 'non-existent', url: 'https://example.com' })
      ).rejects.toThrow('Page not found: non-existent');
    });

    it('should return page_brief by default without factpack', async () => {
      const result = await browserTools.browserNavigate({
        page_id: 'page-123',
        url: 'https://example.com/page',
      });

      // page_brief is always returned
      expect(result.page_brief).toBeDefined();
      expect(result.page_brief_tokens).toBeGreaterThan(0);
      // factpack is NOT returned by default
      expect(result.factpack).toBeUndefined();
    });

    it('should include factpack when include_factpack is true', async () => {
      const result = await browserTools.browserNavigate({
        page_id: 'page-123',
        url: 'https://example.com/page',
        include_factpack: true,
      });

      expect(result.factpack).toBeDefined();
      expect(result.factpack!.meta.snapshot_id).toBe('snap-123');
      // page_brief should still be included
      expect(result.page_brief).toBeDefined();
    });
  });

  describe('browserClose()', () => {
    it('should close specific page when page_id provided', async () => {
      const result = await browserTools.browserClose({ page_id: 'page-123' });

      expect(mockSessionManager.closePage).toHaveBeenCalledWith('page-123');
      expect(result.closed).toBe(true);
    });

    it('should shutdown entire session when no page_id', async () => {
      const result = await browserTools.browserClose({});

      expect(mockSessionManager.shutdown).toHaveBeenCalled();
      expect(result.closed).toBe(true);
    });
  });

  describe('snapshotCapture()', () => {
    it('should capture snapshot and return page_brief by default (no factpack)', async () => {
      const result = await browserTools.snapshotCapture({ page_id: 'page-123' });

      expect(compileSnapshotMock).toHaveBeenCalledWith(mockCdp, mockPage, 'page-123');
      expect(result.snapshot_id).toBe('snap-123');
      expect(result.url).toBe('https://example.com');
      expect(result.node_count).toBe(1);
      // page_brief is always returned
      expect(result.page_brief).toBeDefined();
      expect(result.page_brief_tokens).toBeGreaterThan(0);
      // factpack is NOT returned by default (opt-in)
      expect(result.factpack).toBeUndefined();
      // nodes are NOT returned by default (opt-in)
      expect(result.nodes).toBeUndefined();
    });

    it('should include factpack when include_factpack is true', async () => {
      const result = await browserTools.snapshotCapture({
        page_id: 'page-123',
        include_factpack: true,
      });

      expect(result.factpack).toBeDefined();
      expect(result.factpack!.meta.snapshot_id).toBe('snap-123');
      // page_brief should still be included
      expect(result.page_brief).toBeDefined();
    });

    it('should include nodes when include_nodes is true', async () => {
      const result = await browserTools.snapshotCapture({
        page_id: 'page-123',
        include_nodes: true,
      });

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes![0]).toEqual({
        node_id: '12345',
        kind: 'link',
        label: 'More information...',
        selector: 'role=link[name="More information..."]',
      });
    });

    it('should throw error if page not found', async () => {
      mockSessionManager.resolvePage.mockReturnValue(undefined);

      await expect(browserTools.snapshotCapture({ page_id: 'non-existent' })).rejects.toThrow(
        'Page not found: non-existent'
      );
    });
  });

  describe('actionClick()', () => {
    it('should click element by node_id using CDP backendNodeId', async () => {
      // Setup CDP mock for click sequence
      mockCdp.send
        .mockResolvedValueOnce(undefined) // DOM.scrollIntoViewIfNeeded
        .mockResolvedValueOnce({
          // DOM.getBoxModel - returns content quad coordinates
          model: {
            content: [100, 200, 250, 200, 250, 220, 100, 220], // x1,y1,x2,y2,x3,y3,x4,y4
          },
        })
        .mockResolvedValueOnce(undefined) // Input.dispatchMouseEvent (mousePressed)
        .mockResolvedValueOnce(undefined); // Input.dispatchMouseEvent (mouseReleased)

      // First capture a snapshot
      await browserTools.snapshotCapture({ page_id: 'page-123' });

      // Reset CDP mock calls after snapshot capture (which also uses CDP)
      mockCdp.send.mockClear();
      mockCdp.send
        .mockResolvedValueOnce(undefined) // DOM.scrollIntoViewIfNeeded
        .mockResolvedValueOnce({
          model: {
            content: [100, 200, 250, 200, 250, 220, 100, 220],
          },
        })
        .mockResolvedValueOnce(undefined) // Input.dispatchMouseEvent (mousePressed)
        .mockResolvedValueOnce(undefined); // Input.dispatchMouseEvent (mouseReleased)

      // Then click
      const result = await browserTools.actionClick({
        page_id: 'page-123',
        node_id: '12345',
      });

      // Verify CDP was used (not Playwright locators)
      expect(mockCdp.send).toHaveBeenCalledWith('DOM.scrollIntoViewIfNeeded', {
        backendNodeId: 12345,
      });
      expect(mockCdp.send).toHaveBeenCalledWith('DOM.getBoxModel', {
        backendNodeId: 12345,
      });
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mousePressed',
          button: 'left',
        })
      );
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mouseReleased',
          button: 'left',
        })
      );

      // Playwright locators should NOT be used
      expect(mockPage.getByRole).not.toHaveBeenCalled();
      expect(mockPage.locator).not.toHaveBeenCalled();

      expect(result.success).toBe(true);
      expect(result.node_id).toBe('12345');
      expect(result.clicked_element).toBe('More information...');
    });

    it('should throw error if no snapshot exists', async () => {
      await expect(
        browserTools.actionClick({ page_id: 'page-123', node_id: '12345' })
      ).rejects.toThrow('No snapshot for page');
    });

    it('should throw error if node not found in snapshot', async () => {
      // Capture snapshot
      await browserTools.snapshotCapture({ page_id: 'page-123' });

      await expect(
        browserTools.actionClick({ page_id: 'page-123', node_id: 'non-existent' })
      ).rejects.toThrow('Node non-existent not found in snapshot');
    });

    it('should throw error if page not found', async () => {
      mockSessionManager.resolvePage.mockReturnValue(undefined);

      await expect(
        browserTools.actionClick({ page_id: 'non-existent', node_id: '12345' })
      ).rejects.toThrow('Page not found: non-existent');
    });

    it('should click element using CDP backendNodeId instead of Playwright locator', async () => {
      // Mock a snapshot with backend_node_id (node_id is derived from backend_node_id)
      const mockSnapshotWithBackendId: BaseSnapshot = {
        snapshot_id: 'snap-456',
        url: 'https://example.com',
        title: 'Example Domain',
        captured_at: new Date().toISOString(),
        viewport: { width: 1280, height: 720 },
        nodes: [
          {
            node_id: '12345', // Derived from backend_node_id
            backend_node_id: 12345, // CDP backendNodeId - guaranteed unique
            kind: 'button',
            label: 'Yes',
            where: { region: 'main' },
            layout: { bbox: { x: 100, y: 200, w: 80, h: 40 } },
            find: { primary: 'role=button[name="Yes"]' }, // This would match multiple elements!
          },
          {
            node_id: '12346', // Derived from backend_node_id
            backend_node_id: 12346, // Different backendNodeId - unique
            kind: 'button',
            label: 'Yes',
            where: { region: 'dialog' },
            layout: { bbox: { x: 300, y: 400, w: 80, h: 40 } },
            find: { primary: 'role=button[name="Yes"]' }, // Same locator as first button!
          },
        ],
        meta: { node_count: 2, interactive_count: 2 },
      };

      // Override compileSnapshot mock for this test
      compileSnapshotMock.mockResolvedValueOnce(mockSnapshotWithBackendId);

      // Setup CDP mock to handle the click sequence
      mockCdp.send
        .mockResolvedValueOnce(undefined) // DOM.scrollIntoViewIfNeeded
        .mockResolvedValueOnce({
          // DOM.getBoxModel - returns content quad coordinates
          model: {
            content: [100, 200, 180, 200, 180, 240, 100, 240], // x1,y1,x2,y2,x3,y3,x4,y4
          },
        })
        .mockResolvedValueOnce(undefined) // Input.dispatchMouseEvent (mousePressed)
        .mockResolvedValueOnce(undefined); // Input.dispatchMouseEvent (mouseReleased)

      // Capture snapshot first
      await browserTools.snapshotCapture({ page_id: 'page-123' });

      // Click on first "Yes" button (node_id: '12345')
      const result = await browserTools.actionClick({
        page_id: 'page-123',
        node_id: '12345',
      });

      // Verify CDP was used with the correct backendNodeId (not Playwright locator)
      expect(mockCdp.send).toHaveBeenCalledWith('DOM.scrollIntoViewIfNeeded', {
        backendNodeId: 12345,
      });
      expect(mockCdp.send).toHaveBeenCalledWith('DOM.getBoxModel', {
        backendNodeId: 12345,
      });
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mousePressed',
          button: 'left',
        })
      );
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mouseReleased',
          button: 'left',
        })
      );

      // Verify Playwright locator was NOT used (since it would cause strict mode violation)
      expect(mockPage.getByRole).not.toHaveBeenCalled();
      expect(mockPage.locator).not.toHaveBeenCalled();

      expect(result.success).toBe(true);
      expect(result.node_id).toBe('12345');
      expect(result.clicked_element).toBe('Yes');
    });
  });

  describe('findElements()', () => {
    it('should find elements by kind', async () => {
      // First capture a snapshot
      await browserTools.snapshotCapture({ page_id: 'page-123' });

      const result = browserTools.findElements({
        page_id: 'page-123',
        kind: 'link',
      });

      expect(result.page_id).toBe('page-123');
      expect(result.snapshot_id).toBe('snap-123');
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]).toMatchObject({
        node_id: '12345',
        kind: 'link',
        label: 'More information...',
        selector: 'role=link[name="More information..."]',
        region: 'main',
        group_id: undefined,
        heading_context: undefined,
      });
      // Relevance score should be included
      expect(result.matches[0].relevance).toBeDefined();
      expect(typeof result.matches[0].relevance).toBe('number');
      expect(result.stats.total_matched).toBe(1);
    });

    it('should find elements by label', async () => {
      await browserTools.snapshotCapture({ page_id: 'page-123' });

      const result = browserTools.findElements({
        page_id: 'page-123',
        label: 'More information',
      });

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].label).toBe('More information...');
    });

    it('should find elements by region', async () => {
      await browserTools.snapshotCapture({ page_id: 'page-123' });

      const result = browserTools.findElements({
        page_id: 'page-123',
        region: 'main',
      });

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].region).toBe('main');
    });

    it('should return empty matches for non-matching filter', async () => {
      await browserTools.snapshotCapture({ page_id: 'page-123' });

      const result = browserTools.findElements({
        page_id: 'page-123',
        kind: 'button', // No buttons in the mock snapshot
      });

      expect(result.matches).toHaveLength(0);
      expect(result.stats.total_matched).toBe(0);
    });

    it('should throw error if no snapshot exists', () => {
      expect(() => browserTools.findElements({ page_id: 'page-123', kind: 'link' })).toThrow(
        'No snapshot for page page-123'
      );
    });

    it('should support label filter with exact mode', async () => {
      await browserTools.snapshotCapture({ page_id: 'page-123' });

      const result = browserTools.findElements({
        page_id: 'page-123',
        label: {
          text: 'More information...',
          mode: 'exact',
        },
      });

      expect(result.matches).toHaveLength(1);
    });

    it('should support multiple kinds', async () => {
      // Create a snapshot with multiple node types
      const multiNodeSnapshot: BaseSnapshot = {
        snapshot_id: 'snap-multi',
        url: 'https://example.com',
        title: 'Example',
        captured_at: new Date().toISOString(),
        viewport: { width: 1280, height: 720 },
        nodes: [
          {
            node_id: '1', // Derived from backend_node_id
            backend_node_id: 1,
            kind: 'button',
            label: 'Submit',
            where: { region: 'main' },
            layout: { bbox: { x: 0, y: 0, w: 100, h: 40 } },
            find: { primary: 'role=button[name="Submit"]' },
          },
          {
            node_id: '2', // Derived from backend_node_id
            backend_node_id: 2,
            kind: 'link',
            label: 'Home',
            where: { region: 'nav' },
            layout: { bbox: { x: 0, y: 0, w: 100, h: 40 } },
            find: { primary: 'role=link[name="Home"]' },
          },
          {
            node_id: '3', // Derived from backend_node_id
            backend_node_id: 3,
            kind: 'input',
            label: 'Email',
            where: { region: 'main' },
            layout: { bbox: { x: 0, y: 0, w: 200, h: 40 } },
            find: { primary: 'role=textbox[name="Email"]' },
          },
        ],
        meta: { node_count: 3, interactive_count: 3 },
      };

      compileSnapshotMock.mockResolvedValueOnce(multiNodeSnapshot);
      await browserTools.snapshotCapture({ page_id: 'page-123' });

      const result = browserTools.findElements({
        page_id: 'page-123',
        kind: ['button', 'link'],
      });

      expect(result.matches).toHaveLength(2);
      expect(result.matches.map((m) => m.kind).sort()).toEqual(['button', 'link']);
    });

    it('should respect limit parameter', async () => {
      // Create a snapshot with many nodes
      const manyNodesSnapshot: BaseSnapshot = {
        snapshot_id: 'snap-many',
        url: 'https://example.com',
        title: 'Example',
        captured_at: new Date().toISOString(),
        viewport: { width: 1280, height: 720 },
        nodes: Array.from({ length: 20 }, (_, i) => ({
          node_id: String(i), // Derived from backend_node_id
          backend_node_id: i,
          kind: 'link' as const,
          label: `Link ${i}`,
          where: { region: 'main' as const },
          layout: { bbox: { x: 0, y: i * 30, w: 100, h: 25 } },
          find: { primary: `role=link[name="Link ${i}"]` },
        })),
        meta: { node_count: 20, interactive_count: 20 },
      };

      compileSnapshotMock.mockResolvedValueOnce(manyNodesSnapshot);
      await browserTools.snapshotCapture({ page_id: 'page-123' });

      const result = browserTools.findElements({
        page_id: 'page-123',
        kind: 'link',
        limit: 5,
      });

      expect(result.matches).toHaveLength(5);
      expect(result.stats.total_matched).toBe(20);
    });
  });

  describe('getFactPack()', () => {
    it('should return factpack without page_brief by default', async () => {
      // First capture a snapshot
      await browserTools.snapshotCapture({ page_id: 'page-123' });

      const result = browserTools.getFactPack({ page_id: 'page-123' });

      expect(result.page_id).toBe('page-123');
      expect(result.snapshot_id).toBe('snap-123');
      expect(result.factpack).toBeDefined();
      expect(result.factpack.meta.snapshot_id).toBe('snap-123');
      // page_brief is NOT returned by default
      expect(result.page_brief).toBeUndefined();
      expect(result.page_brief_tokens).toBeUndefined();
    });

    it('should include page_brief when include_page_brief is true', async () => {
      // First capture a snapshot
      await browserTools.snapshotCapture({ page_id: 'page-123' });

      const result = browserTools.getFactPack({
        page_id: 'page-123',
        include_page_brief: true,
      });

      expect(result.factpack).toBeDefined();
      expect(result.page_brief).toBeDefined();
      expect(result.page_brief_tokens).toBeGreaterThan(0);
    });

    it('should throw error if no snapshot exists', () => {
      expect(() => browserTools.getFactPack({ page_id: 'page-123' })).toThrow(
        'No snapshot for page page-123'
      );
    });
  });
});
