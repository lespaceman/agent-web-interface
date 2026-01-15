/**
 * Mock Playwright for unit tests
 *
 * Provides mock implementations of Playwright Browser, BrowserContext,
 * Page, and CDPSession for testing without launching a real browser.
 */

import { vi, type Mock } from 'vitest';

/**
 * Mock Request - subset of Playwright Request interface used in tests
 */
export interface MockRequest {
  resourceType: Mock;
  url: Mock;
}

/**
 * Creates a mock Playwright Request
 */
export function createMockRequest(
  options: { resourceType?: string; url?: string } = {}
): MockRequest {
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
 * Mock Page
 */
export interface MockPage {
  url: Mock;
  title: Mock;
  goto: Mock;
  close: Mock;
  isClosed: Mock;
  waitForLoadState: Mock;
  evaluate: Mock;
  viewportSize: Mock;
  on: Mock;
  off: Mock;
}

/**
 * Mock BrowserContext
 */
export interface MockBrowserContext {
  newPage: Mock;
  newCDPSession: Mock;
  close: Mock;
  pages: Mock;
  storageState: Mock;
}

/**
 * Mock Browser
 */
export interface MockBrowser {
  newContext: Mock;
  close: Mock;
  isConnected: Mock;
  contexts: Mock;
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
  options: { url?: string; title?: string; viewport?: { width: number; height: number } } = {}
): MockPage {
  return {
    url: vi.fn().mockReturnValue(options.url ?? 'about:blank'),
    title: vi.fn().mockResolvedValue(options.title ?? ''),
    goto: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    viewportSize: vi.fn().mockReturnValue(options.viewport ?? { width: 1280, height: 720 }),
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
  emitRequest: (options?: { resourceType?: string; url?: string }) => MockRequest;
  /** Emit a 'requestfinished' event */
  emitRequestFinished: (request: MockRequest) => void;
  /** Emit a 'requestfailed' event */
  emitRequestFailed: (request: MockRequest) => void;
  /** Get all registered handlers for an event */
  getHandlers: (event: string) => Set<(arg: unknown) => void>;
}

/**
 * Creates a mock Page with working event emission.
 * Unlike createMockPage, this version actually tracks event listeners and
 * provides helper methods to emit events for testing.
 */
export function createMockPageWithEvents(
  options: { url?: string; title?: string; viewport?: { width: number; height: number } } = {}
): MockPageWithEvents {
  const listeners = new Map<string, Set<(arg: unknown) => void>>();

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
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    viewportSize: vi.fn().mockReturnValue(options.viewport ?? { width: 1280, height: 720 }),
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
      const request = createMockRequest(reqOptions);
      page.emitEvent('request', request);
      return request;
    },
    emitRequestFinished: (request: MockRequest) => {
      page.emitEvent('requestfinished', request);
    },
    emitRequestFailed: (request: MockRequest) => {
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
 * - `pages()` returns all pages in the array
 * - `newPage()` cycles through pages (creates new mock if exhausted)
 * - `newCDPSession()` creates a new CDP session per call
 */
export function createMockBrowserContext(
  options: {
    pages?: MockPage[];
    cdpSession?: MockCDPSession;
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

  // newCDPSession creates a fresh session each call (or uses provided one for first call)
  let cdpCallCount = 0;
  const newCDPSessionMock = vi.fn().mockImplementation(() => {
    if (cdpCallCount === 0 && options.cdpSession) {
      cdpCallCount++;
      return Promise.resolve(options.cdpSession);
    }
    cdpCallCount++;
    return Promise.resolve(createMockCDPSession());
  });

  return {
    newPage: newPageMock,
    newCDPSession: newCDPSessionMock,
    close: vi.fn().mockResolvedValue(undefined),
    pages: vi.fn().mockImplementation(() => pages),
    storageState: vi.fn().mockResolvedValue({ cookies: [], origins: [] }),
  };
}

/**
 * Creates a mock Browser with preconfigured context
 */
export function createMockBrowser(
  options: {
    contexts?: MockBrowserContext[];
  } = {}
): MockBrowser {
  const mockContext = options.contexts?.[0] ?? createMockBrowserContext();

  return {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    contexts: vi.fn().mockReturnValue(options.contexts ?? [mockContext]),
    on: vi.fn(),
    off: vi.fn(),
  };
}

/**
 * Mock chromium launcher
 */
export const mockChromium = {
  launch: vi.fn().mockResolvedValue(createMockBrowser()),
};

/**
 * Full mock setup for Playwright module
 * Use this with vi.mock('playwright', () => createPlaywrightMock())
 */
export function createPlaywrightMock() {
  return {
    chromium: mockChromium,
  };
}

/**
 * Reset all Playwright mocks
 */
export function resetPlaywrightMocks(): void {
  mockChromium.launch.mockClear();
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
  const page = createMockPage({ url: options.url, title: options.title });
  const context = createMockBrowserContext({ pages: [page], cdpSession });
  const browser = createMockBrowser({ contexts: [context] });

  return { browser, context, page, cdpSession };
}
