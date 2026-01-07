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
import type { extractSnapshot as ExtractSnapshotType } from '../../../src/snapshot/snapshot-extractor.js';

// Mock modules at the top level (hoisted)
vi.mock('../../../src/browser/session-manager.js');
vi.mock('../../../src/snapshot/snapshot-extractor.js');

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
  };

  let mockPage: Page;
  let mockLocator: Locator;
  let mockCdp: { send: ReturnType<typeof vi.fn>; isActive: ReturnType<typeof vi.fn> };
  let mockPageHandle: PageHandle;

  // Import the module after mocking
  let browserTools: typeof import('../../../src/tools/browser-tools.js');
  let extractSnapshotMock: Mock<Parameters<typeof ExtractSnapshotType>, ReturnType<typeof ExtractSnapshotType>>;

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
    };

    // Mock the SessionManager module
    const sessionManagerModule = await import('../../../src/browser/session-manager.js');
    vi.mocked(sessionManagerModule.SessionManager).mockImplementation(
      () => mockSessionManager as unknown as SessionManager
    );

    // Mock extractSnapshot
    const mockSnapshot: BaseSnapshot = {
      snapshot_id: 'snap-123',
      url: 'https://example.com',
      title: 'Example Domain',
      captured_at: new Date().toISOString(),
      viewport: { width: 1280, height: 720 },
      nodes: [
        {
          node_id: 'n1',
          kind: 'link',
          label: 'More information...',
          where: { region: 'main' },
          layout: { bbox: { x: 100, y: 200, w: 150, h: 20 } },
          find: { primary: 'role=link[name="More information..."]' },
        },
      ],
      meta: { node_count: 1, interactive_count: 1 },
    };

    extractSnapshotMock = vi.fn<Parameters<typeof ExtractSnapshotType>, ReturnType<typeof ExtractSnapshotType>>(
      () => Promise.resolve(mockSnapshot)
    );

    const snapshotExtractorModule = await import('../../../src/snapshot/snapshot-extractor.js');
    vi.mocked(snapshotExtractorModule.extractSnapshot).mockImplementation(extractSnapshotMock);

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
  });

  describe('browserNavigate()', () => {
    it('should navigate page to URL', async () => {
      const result = await browserTools.browserNavigate({
        page_id: 'page-123',
        url: 'https://example.com/page',
      });

      expect(mockSessionManager.navigateTo).toHaveBeenCalledWith('page-123', 'https://example.com/page');
      expect(result.page_id).toBe('page-123');
      expect(result.title).toBe('Example Domain');
    });

    it('should throw error if page not found', async () => {
      mockSessionManager.getPage.mockReturnValue(undefined);

      await expect(
        browserTools.browserNavigate({ page_id: 'non-existent', url: 'https://example.com' })
      ).rejects.toThrow('Page not found: non-existent');
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
    it('should capture snapshot and return node summaries', async () => {
      const result = await browserTools.snapshotCapture({ page_id: 'page-123' });

      expect(extractSnapshotMock).toHaveBeenCalledWith(mockCdp, mockPage, 'page-123');
      expect(result.snapshot_id).toBe('snap-123');
      expect(result.url).toBe('https://example.com');
      expect(result.node_count).toBe(1);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toEqual({
        node_id: 'n1',
        kind: 'link',
        label: 'More information...',
        selector: 'role=link[name="More information..."]',
      });
    });

    it('should throw error if page not found', async () => {
      mockSessionManager.getPage.mockReturnValue(undefined);

      await expect(browserTools.snapshotCapture({ page_id: 'non-existent' })).rejects.toThrow(
        'Page not found: non-existent'
      );
    });
  });

  describe('actionClick()', () => {
    it('should click element by node_id', async () => {
      // First capture a snapshot
      await browserTools.snapshotCapture({ page_id: 'page-123' });

      // Then click
      const result = await browserTools.actionClick({
        page_id: 'page-123',
        node_id: 'n1',
      });

      expect(mockPage.getByRole).toHaveBeenCalledWith('link', { name: 'More information...' });
      expect(mockLocator.click).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.node_id).toBe('n1');
      expect(result.clicked_element).toBe('More information...');
    });

    it('should throw error if no snapshot exists', async () => {
      await expect(
        browserTools.actionClick({ page_id: 'page-123', node_id: 'n1' })
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
      mockSessionManager.getPage.mockReturnValue(undefined);

      await expect(
        browserTools.actionClick({ page_id: 'non-existent', node_id: 'n1' })
      ).rejects.toThrow('Page not found: non-existent');
    });
  });
});
