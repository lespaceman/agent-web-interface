/**
 * Readability Tools
 *
 * MCP tool handler for extracting clean, readable page content
 * using Mozilla's Readability.js (the engine behind Firefox Reader View).
 */

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { ReadPageInputSchema, type ReadPageOutput } from './tool-schemas.js';
import { getSessionManager, resolveExistingPage } from './tool-context.js';
import { buildReadPageResponse } from './response-builder.js';

/**
 * Extract the main readable content from the page.
 *
 * Uses Mozilla Readability (Firefox Reader View engine) to strip
 * navigation, ads, and clutter, returning clean text with metadata.
 */
export async function readPage(rawInput: unknown): Promise<ReadPageOutput> {
  const input = ReadPageInputSchema.parse(rawInput);

  const session = getSessionManager();
  const handle = resolveExistingPage(session, input.page_id);

  // Get full page HTML and URL
  const html = await handle.page.content();
  const url = handle.page.url();

  // Parse with JSDOM and extract with Readability
  const doc = new JSDOM(html, { url });
  try {
    const reader = new Readability(doc.window.document);
    const article = reader.parse();

    if (!article) {
      return '<result type="read_page"><error>Could not extract readable content from this page. The page may not have article-like content. Try using snapshot instead for structured page state.</error></result>';
    }

    return buildReadPageResponse({
      title: article.title ?? '',
      byline: article.byline ?? null,
      excerpt: article.excerpt ?? null,
      siteName: article.siteName ?? null,
      lang: article.lang ?? null,
      textContent: article.textContent ?? '',
      length: article.length ?? 0,
    });
  } finally {
    doc.window.close();
  }
}
