/**
 * Mock Puppeteer for unit tests
 *
 * Provides mock implementations of Puppeteer Browser, BrowserContext,
 * Page, and CDPSession for testing without launching a real browser.
 */

import { vi, type Mock } from 'vitest';

/**
 * Mock HTTPRequest - subset of Puppeteer HTTPRequest interface used in tests
 */
export interface MockHTTPRequest {
  resourceType: Mock;
  url: Mock;
}

/**
 * Creates a mock Puppeteer HTTPRequest
 */
export function createMockHTTPRequest(
  options: { resourceType?: string; url?: string } = {}
): MockHTTPRequest {
  return {
    resourceType: vi.fn().mockReturnValue(options.resourceType ?? 'fetch'),
    url: vi.fn().mockReturnValue(options.url ?? 'https://example.com/api'),
  };
}

/**
 * Mock CDPSession
 */
export interface MockCDPSession {
  send: Mock;
  on: Mock;
  off: Mock;
  detach: Mock;
}

/**
 * Mock Page - Puppeteer-specific API
 */
export interface MockPage {
  url: Mock;
  title: Mock;
  goto: Mock;
  close: Mock;
  isClosed: Mock;
  evaluate: Mock;
  viewport: Mock; // Puppeteer uses viewport() instead of viewportSize()
  createCDPSession: Mock; // Puppeteer creates CDP session from Page
  cookies: Mock;
  on: Mock;
  off: Mock;
}

/**
 * Mock BrowserContext - Puppeteer-specific API
 */
export interface MockBrowserContext {
  newPage: Mock;
  close: Mock;
  pages: Mock; // Returns Promise in Puppeteer
}

/**
 * Mock Browser - Puppeteer-specific API
 */
export interface MockBrowser {
  close: Mock;
  disconnect: Mock; // Puppeteer-specific: disconnect without closing
  connected: boolean; // Puppeteer uses property, not method
  browserContexts: Mock; // Puppeteer uses browserContexts() instead of contexts()
  defaultBrowserContext: Mock;
  on: Mock;
  off: Mock;
}

/**
 * Creates a mock CDPSession
 */
export function createMockCDPSession(): MockCDPSession {
  return {
    send: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
    off: vi.fn(),
    detach: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Creates a mock Page
 */
export function createMockPage(
  options: {
    url?: string;
    title?: string;
    viewport?: { width: number; height: number };
    cdpSession?: MockCDPSession;
  } = {}
): MockPage {
  const cdpSession = options.cdpSession ?? createMockCDPSession();

  return {
    url: vi.fn().mockReturnValue(options.url ?? 'about:blank'),
    title: vi.fn().mockResolvedValue(options.title ?? ''),
    goto: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
    evaluate: vi.fn().mockResolvedValue(undefined),
    viewport: vi.fn().mockReturnValue(options.viewport ?? { width: 1280, height: 720 }),
    createCDPSession: vi.fn().mockResolvedValue(cdpSession),
    cookies: vi.fn().mockResolvedValue([]),
    on: vi.fn(),
    off: vi.fn(),
  };
}

/**
 * Extended mock Page with working event emission for testing event-driven code.
 * Use this when testing code that listens to page events (request, requestfinished, etc.)
 */
export interface MockPageWithEvents extends MockPage {
  /** Emit any event to registered listeners */
  emitEvent: (event: string, data: unknown) => void;
  /** Emit a 'request' event with a mock request */
  emitRequest: (options?: { resourceType?: string; url?: string }) => MockHTTPRequest;
  /** Emit a 'requestfinished' event */
  emitRequestFinished: (request: MockHTTPRequest) => void;
  /** Emit a 'requestfailed' event */
  emitRequestFailed: (request: MockHTTPRequest) => void;
  /** Get all registered handlers for an event */
  getHandlers: (event: string) => Set<(arg: unknown) => void>;
}

/**
 * Creates a mock Page with working event emission.
 * Unlike createMockPage, this version actually tracks event listeners and
 * provides helper methods to emit events for testing.
 */
export function createMockPageWithEvents(
  options: {
    url?: string;
    title?: string;
    viewport?: { width: number; height: number };
    cdpSession?: MockCDPSession;
  } = {}
): MockPageWithEvents {
  const listeners = new Map<string, Set<(arg: unknown) => void>>();
  const cdpSession = options.cdpSession ?? createMockCDPSession();

  const getOrCreateListenerSet = (event: string): Set<(arg: unknown) => void> => {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    return listeners.get(event)!;
  };

  const page: MockPageWithEvents = {
    url: vi.fn().mockReturnValue(options.url ?? 'about:blank'),
    title: vi.fn().mockResolvedValue(options.title ?? ''),
    goto: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
    evaluate: vi.fn().mockResolvedValue(undefined),
    viewport: vi.fn().mockReturnValue(options.viewport ?? { width: 1280, height: 720 }),
    createCDPSession: vi.fn().mockResolvedValue(cdpSession),
    cookies: vi.fn().mockResolvedValue([]),
    on: vi.fn((event: string, handler: (arg: unknown) => void) => {
      getOrCreateListenerSet(event).add(handler);
    }),
    off: vi.fn((event: string, handler: (arg: unknown) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    emitEvent: (event: string, data: unknown) => {
      listeners.get(event)?.forEach((handler) => handler(data));
    },
    emitRequest: (reqOptions?: { resourceType?: string; url?: string }) => {
      const request = createMockHTTPRequest(reqOptions);
      page.emitEvent('request', request);
      return request;
    },
    emitRequestFinished: (request: MockHTTPRequest) => {
      page.emitEvent('requestfinished', request);
    },
    emitRequestFailed: (request: MockHTTPRequest) => {
      page.emitEvent('requestfailed', request);
    },
    getHandlers: (event: string) => {
      return listeners.get(event) ?? new Set();
    },
  };

  return page;
}

/**
 * Creates a mock BrowserContext with preconfigured page and CDP session.
 *
 * For multi-page scenarios:
 * - `pages()` returns Promise of all pages (Puppeteer async)
 * - `newPage()` cycles through pages (creates new mock if exhausted)
 */
export function createMockBrowserContext(
  options: {
    pages?: MockPage[];
  } = {}
): MockBrowserContext {
  const initialPages = options.pages ?? [createMockPage()];
  const pages = [...initialPages];
  let newPageIndex = 0;

  // newPage cycles through provided pages, then creates new ones
  const newPageMock = vi.fn().mockImplementation(() => {
    if (newPageIndex < initialPages.length) {
      return Promise.resolve(initialPages[newPageIndex++]);
    }
    // Create a new page if we've exhausted the initial set
    const newPage = createMockPage();
    pages.push(newPage);
    return Promise.resolve(newPage);
  });

  return {
    newPage: newPageMock,
    close: vi.fn().mockResolvedValue(undefined),
    // Puppeteer's pages() returns Promise
    pages: vi.fn().mockImplementation(() => Promise.resolve(pages)),
  };
}

/**
 * Creates a mock Browser with preconfigured context
 */
export function createMockBrowser(
  options: {
    contexts?: MockBrowserContext[];
    connected?: boolean;
  } = {}
): MockBrowser {
  const mockContext = options.contexts?.[0] ?? createMockBrowserContext();

  return {
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(), // Puppeteer's disconnect is sync
    connected: options.connected ?? true, // Property, not method
    browserContexts: vi.fn().mockReturnValue(options.contexts ?? [mockContext]),
    defaultBrowserContext: vi.fn().mockReturnValue(mockContext),
    on: vi.fn(),
    off: vi.fn(),
  };
}

/**
 * Mock puppeteer default export
 */
export const mockPuppeteer = {
  launch: vi.fn().mockResolvedValue(createMockBrowser()),
  connect: vi.fn().mockResolvedValue(createMockBrowser()),
};

/**
 * Full mock setup for Puppeteer module
 * Use this with vi.mock('puppeteer-core', () => createPuppeteerMock())
 */
export function createPuppeteerMock() {
  return {
    default: mockPuppeteer,
  };
}

/**
 * Reset all Puppeteer mocks
 */
export function resetPuppeteerMocks(): void {
  mockPuppeteer.launch.mockClear();
  mockPuppeteer.connect.mockClear();
}

/**
 * Helper to create a complete mock setup with linked Browser -> Context -> Page -> CDPSession
 */
export interface LinkedMocks {
  browser: MockBrowser;
  context: MockBrowserContext;
  page: MockPage;
  cdpSession: MockCDPSession;
}

export function createLinkedMocks(
  options: {
    url?: string;
    title?: string;
  } = {}
): LinkedMocks {
  const cdpSession = createMockCDPSession();
  const page = createMockPage({ url: options.url, title: options.title, cdpSession });
  const context = createMockBrowserContext({ pages: [page] });
  const browser = createMockBrowser({ contexts: [context] });

  return { browser, context, page, cdpSession };
}

// Re-export for backwards compatibility during migration
export { MockHTTPRequest as MockRequest, createMockHTTPRequest as createMockRequest };
