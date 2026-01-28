/**
 * Page Registry
 *
 * Tracks active Puppeteer pages and their CDP sessions.
 * Provides a central registry for page lifecycle management.
 */

import type { Page } from 'puppeteer-core';
import type { CdpClient } from '../cdp/cdp-client.interface.js';
import { randomUUID } from 'crypto';

/**
 * Handle to a registered page with its CDP session
 */
export interface PageHandle {
  /** Unique identifier for this page */
  page_id: string;

  /** Puppeteer Page instance */
  page: Page;

  /** CDP client for this page */
  cdp: CdpClient;

  /** When the page was registered */
  created_at: Date;

  /** Current URL (may be stale) */
  url?: string;

  /** Page title (may be stale) */
  title?: string;
}

/**
 * Registry for tracking active pages
 */
export class PageRegistry {
  private readonly pages = new Map<string, PageHandle>();
  /** Most recently used page ID for default resolution */
  private mruPageId: string | null = null;

  /**
   * Register a new page with its CDP session
   *
   * @param page - Puppeteer Page instance
   * @param cdp - CDP client for the page
   * @returns PageHandle with unique page_id
   * @throws Error if page is already closed
   */
  register(page: Page, cdp: CdpClient): PageHandle {
    // Validate page is not closed (Puppeteer uses isClosed())
    if (page.isClosed()) {
      throw new Error('Cannot register a closed page');
    }

    const page_id = `page-${randomUUID()}`;

    const handle: PageHandle = {
      page_id,
      page,
      cdp,
      created_at: new Date(),
      url: page.url?.(),
    };

    this.pages.set(page_id, handle);
    this.mruPageId = page_id;

    return handle;
  }

  /**
   * Get a page handle by its ID
   *
   * @param page_id - The page identifier
   * @returns PageHandle if found, undefined otherwise
   */
  get(page_id: string): PageHandle | undefined {
    return this.pages.get(page_id);
  }

  /**
   * Remove a page from the registry
   *
   * @param page_id - The page identifier
   * @returns true if page was removed, false if not found
   */
  remove(page_id: string): boolean {
    const deleted = this.pages.delete(page_id);
    if (deleted && this.mruPageId === page_id) {
      // Transfer MRU to first remaining page, or null if empty
      const firstRemaining = this.pages.values().next().value;
      this.mruPageId = firstRemaining?.page_id ?? null;
    }
    return deleted;
  }

  /**
   * List all registered pages
   *
   * @returns Array of all PageHandle objects
   */
  list(): PageHandle[] {
    return Array.from(this.pages.values());
  }

  /**
   * Remove all pages from the registry
   */
  clear(): void {
    this.pages.clear();
    this.mruPageId = null;
  }

  /**
   * Get the number of registered pages
   *
   * @returns Current page count
   */
  size(): number {
    return this.pages.size;
  }

  /**
   * Check if a page is registered
   *
   * @param page_id - The page identifier
   * @returns true if page exists
   */
  has(page_id: string): boolean {
    return this.pages.has(page_id);
  }

  /**
   * Replace a page handle in the registry.
   *
   * Used for CDP session rebinding - keeps the same page_id but
   * updates the handle with a new CDP session.
   *
   * @param page_id - Page ID to replace
   * @param handle - New handle to store
   * @returns true if replaced, false if page_id not found
   */
  replace(page_id: string, handle: PageHandle): boolean {
    if (!this.pages.has(page_id)) {
      return false;
    }
    this.pages.set(page_id, handle);
    return true;
  }

  /**
   * Update metadata for a page
   *
   * @param page_id - The page identifier
   * @param metadata - Partial metadata to update
   * @returns true if updated, false if page not found
   */
  updateMetadata(page_id: string, metadata: Partial<Pick<PageHandle, 'url' | 'title'>>): boolean {
    const handle = this.pages.get(page_id);
    if (!handle) {
      return false;
    }

    if (metadata.url !== undefined) {
      handle.url = metadata.url;
    }
    if (metadata.title !== undefined) {
      handle.title = metadata.title;
    }

    return true;
  }

  /**
   * Find a handle by its Puppeteer Page instance
   *
   * @param page - Puppeteer Page instance to find
   * @returns PageHandle if found, undefined otherwise
   */
  findByPage(page: Page): PageHandle | undefined {
    return this.list().find((h) => h.page === page);
  }

  /**
   * Find all handles with a matching URL
   *
   * @param url - URL to search for
   * @returns Array of matching PageHandle objects
   */
  findByUrl(url: string): PageHandle[] {
    return this.list().filter((h) => h.url === url);
  }

  /**
   * Check if a page handle is still valid (page not closed, CDP active)
   *
   * Use this to detect stale handles before performing operations.
   *
   * @param page_id - The page identifier
   * @returns true if the handle exists and both page and CDP session are active
   */
  isValid(page_id: string): boolean {
    const handle = this.pages.get(page_id);
    if (!handle) {
      return false;
    }

    return !handle.page.isClosed() && handle.cdp.isActive();
  }

  /**
   * Touch a page to mark it as most recently used.
   *
   * @param page_id - The page identifier
   * @returns true if the page exists and was touched, false otherwise
   */
  touch(page_id: string): boolean {
    if (this.pages.has(page_id)) {
      this.mruPageId = page_id;
      return true;
    }
    return false;
  }

  /**
   * Get the most recently used page.
   *
   * Falls back to the first registered page if MRU is not set.
   *
   * @returns PageHandle for MRU page, or undefined if no pages
   */
  getMostRecent(): PageHandle | undefined {
    if (this.mruPageId && this.pages.has(this.mruPageId)) {
      return this.pages.get(this.mruPageId);
    }
    // Fallback to first page
    return this.pages.values().next().value;
  }
}
