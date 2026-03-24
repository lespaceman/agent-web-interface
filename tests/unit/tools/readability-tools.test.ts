/**
 * Readability Tools Tests
 *
 * Tests for the read_page tool that extracts clean readable content
 * using Mozilla Readability.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readPage } from '../../../src/tools/readability-tools.js';
import { buildReadPageResponse } from '../../../src/tools/response-builder.js';
import { createTestToolContext } from '../../helpers/test-tool-context.js';
import type { ToolContext } from '../../../src/tools/tool-context.types.js';

// ============================================================================
// buildReadPageResponse Tests
// ============================================================================

describe('buildReadPageResponse', () => {
  it('should return XML with all metadata fields when present', () => {
    const article = {
      title: 'Test Article',
      byline: 'John Doe',
      excerpt: 'A brief summary of the article.',
      siteName: 'Example Blog',
      lang: 'en',
      textContent: 'This is the main article content.',
      length: 32,
    };

    const result = buildReadPageResponse(article);

    expect(result).toContain('<result type="read_page">');
    expect(result).toContain('title="Test Article"');
    expect(result).toContain('byline="John Doe"');
    expect(result).toContain('excerpt="A brief summary of the article."');
    expect(result).toContain('site_name="Example Blog"');
    expect(result).toContain('lang="en"');
    expect(result).toContain('<content length="32">');
    expect(result).toContain('This is the main article content.');
    expect(result).toContain('</content>');
    expect(result).toContain('</result>');
  });

  it('should omit optional metadata fields when null', () => {
    const article = {
      title: 'Minimal Article',
      byline: null,
      excerpt: null,
      siteName: null,
      lang: null,
      textContent: 'Content only.',
      length: 13,
    };

    const result = buildReadPageResponse(article);

    expect(result).toContain('title="Minimal Article"');
    expect(result).not.toContain('byline=');
    expect(result).not.toContain('excerpt=');
    expect(result).not.toContain('site_name=');
    expect(result).not.toContain('lang=');
    expect(result).toContain('Content only.');
  });

  it('should escape XML special characters in content and metadata', () => {
    const article = {
      title: 'Tom & Jerry <Adventures>',
      byline: '"Author" & Co.',
      excerpt: null,
      siteName: null,
      lang: null,
      textContent: 'Use <div> & "quotes" in HTML.',
      length: 28,
    };

    const result = buildReadPageResponse(article);

    expect(result).toContain('title="Tom &amp; Jerry &lt;Adventures&gt;"');
    // xmlAttr uses single-quote wrapping when value contains double quotes
    expect(result).toContain('byline=\'"Author" &amp; Co.\'');
    expect(result).toContain('Use &lt;div&gt; &amp; &quot;quotes&quot; in HTML.');
  });

  it('should trim whitespace from text content', () => {
    const article = {
      title: 'Whitespace Test',
      byline: null,
      excerpt: null,
      siteName: null,
      lang: null,
      textContent: '\n\n  Trimmed content here.  \n\n',
      length: 22,
    };

    const result = buildReadPageResponse(article);

    expect(result).toContain('Trimmed content here.');
    expect(result).not.toContain('\n\n  Trimmed');
  });
});

// ============================================================================
// readPage handler Tests
// ============================================================================

describe('readPage handler', () => {
  let ctx: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createTestToolContext();
  });

  function setupMockPage(html: string, url: string, pageId = 'page-1') {
    const mockPage = {
      content: vi.fn().mockResolvedValue(html),
      url: vi.fn().mockReturnValue(url),
    };
    const mockHandle = {
      page_id: pageId,
      page: mockPage,
      cdp: { isActive: () => true },
    };
    ctx.getSessionManager = vi.fn().mockReturnValue({});
    ctx.resolveExistingPage = vi.fn().mockReturnValue(mockHandle);
    return { mockPage, mockHandle };
  }

  it('should extract readable content from article HTML', async () => {
    setupMockPage(
      `<html>
        <head><title>Test Article</title></head>
        <body>
          <nav>Navigation links here</nav>
          <article>
            <h1>Test Article</h1>
            <p>This is the first paragraph of a long article that contains enough
            content for Readability to detect it as the main content. We need to
            make sure there is sufficient text here for the algorithm to work
            properly. Let us add several more sentences to ensure this works.
            The algorithm needs a reasonable amount of content to determine what
            is the main article body versus navigation and sidebar content.</p>
            <p>Second paragraph with more substantial content to help Readability
            identify this as the primary content area. Articles typically have
            multiple paragraphs that go into detail about the subject matter.
            This additional text helps the extraction algorithm perform well.</p>
          </article>
          <footer>Footer content</footer>
        </body>
      </html>`,
      'https://example.com/article'
    );

    const result = await readPage({}, ctx);

    expect(result).toContain('<result type="read_page">');
    expect(result).toContain('Test Article');
    expect(result).toContain('<content');
  });

  it('should return error when Readability cannot extract content', async () => {
    // An empty page with no meaningful content causes Readability to return null
    setupMockPage('<html><head></head><body></body></html>', 'https://example.com/app');

    const result = await readPage({}, ctx);

    expect(result).toContain('<error>');
    expect(result).toContain('Could not extract readable content');
    expect(result).toContain('snapshot');
  });

  it('should pass page_id to resolveExistingPage', async () => {
    setupMockPage('<html><body>short</body></html>', 'https://example.com', 'custom-page');

    await readPage({ page_id: 'custom-page' }, ctx);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(ctx.resolveExistingPage).toHaveBeenCalledWith('custom-page');
  });

  it('should default to MRU page when page_id is omitted', async () => {
    setupMockPage('<html><body>short</body></html>', 'https://example.com');

    await readPage({}, ctx);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(ctx.resolveExistingPage).toHaveBeenCalledWith(undefined);
  });
});
