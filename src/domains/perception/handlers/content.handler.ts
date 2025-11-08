/**
 * Content Handler
 *
 * Handles content_extract_main and content_to_text tools
 */

import type {
  ContentExtractMainParams,
  ContentExtractMainResponse,
  ContentToTextParams,
  ContentToTextResponse,
} from '../perception.types.js';

interface CdpBridge {
  executeDevToolsMethod<T>(method: string, params?: unknown): Promise<T>;
}

export class ContentHandler {
  constructor(private readonly cdpBridge: CdpBridge) {}

  /**
   * Extract content from the page
   * Returns 'text' field to match ContentGetTextOutputSchema
   */
  async extract(params: {
    selector?: string;
    format?: 'text' | 'html' | 'markdown';
  }): Promise<{ text: string }> {
    const selector = params.selector ?? 'body';
    const format = params.format ?? 'text';

    // Get the element by selector
    const result = await this.cdpBridge.executeDevToolsMethod<{
      nodeId?: number;
    }>('DOM.querySelector', {
      nodeId: await this.getDocumentNodeId(),
      selector,
    });

    if (!result.nodeId) {
      return { text: '' };
    }

    // Get the outer HTML
    const html = await this.cdpBridge.executeDevToolsMethod<{ outerHTML?: string }>(
      'DOM.getOuterHTML',
      {
        nodeId: result.nodeId,
      }
    );

    const sourceHtml = html.outerHTML ?? '';

    // Format the content
    let text = '';
    if (format === 'text') {
      text = this.htmlToText(sourceHtml, 'html-text');
      if (!text) {
        text = await this.getInnerText(selector);
      }
    } else if (format === 'html') {
      text = sourceHtml;
    } else if (format === 'markdown') {
      // PLACEHOLDER: Would convert HTML to markdown
      text = this.htmlToText(sourceHtml, 'html-text');
    }

    return { text };
  }

  /**
   * Extract main content from the page using Readability-like algorithm
   */
  async extractMain(params: ContentExtractMainParams): Promise<ContentExtractMainResponse> {
    // Get page HTML
    const html = await this.cdpBridge.executeDevToolsMethod<{ outerHTML?: string }>(
      'DOM.getOuterHTML',
      {
        nodeId: 1, // document node
      }
    );

    const sourceHtml = html.outerHTML ?? '';

    // Run through content extraction algorithm
    const mode = params.mode ?? 'readability';
    const result = this.extractMainContent(sourceHtml, mode);

    return result;
  }

  /**
   * Convert HTML to plain text
   */
  toText(params: ContentToTextParams): Promise<ContentToTextResponse> {
    const mode = params.mode ?? 'html-text';
    const text = this.htmlToText(params.html, mode);

    return Promise.resolve({ text });
  }

  /**
   * Extract main content using Readability or similar algorithm
   *
   * PLACEHOLDER: In production, integrate @mozilla/readability or trafilatura
   */
  private extractMainContent(
    html: string,
    _mode: 'readability' | 'trafilatura'
  ): ContentExtractMainResponse {
    // This is a placeholder implementation
    // In production, you would:
    // 1. Use @mozilla/readability for JavaScript implementation
    // 2. Use trafilatura Python library via subprocess
    // 3. Implement custom content extraction algorithm

    // For now, use a simple heuristic
    const result = this.simpleContentExtraction(html);

    return result;
  }

  /**
   * Simple content extraction heuristic (placeholder)
   */
  private simpleContentExtraction(html: string): ContentExtractMainResponse {
    // Extract title
    const titleMatch = /<title>(.*?)<\/title>/i.exec(html);
    const title = titleMatch?.[1] ?? '';

    // Extract meta description as excerpt
    const descRegex = /<meta\s+name=["']description["']\s+content=["'](.*?)["']/i;
    const descMatch = descRegex.exec(html);
    const excerpt = descMatch?.[1] ?? '';

    // Extract main content (very simplified - just get <main>, <article>, or <body>)
    let content = '';
    let textContent = '';

    const mainMatch =
      /<main[^>]*>([\s\S]*?)<\/main>/i.exec(html) ??
      /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html) ??
      /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);

    if (mainMatch) {
      content = mainMatch[1];
      textContent = this.htmlToText(content, 'html-text');
    }

    return {
      title,
      excerpt,
      content,
      textContent,
    };
  }

  /**
   * Convert HTML to plain text
   */
  private htmlToText(html: string, mode: 'inscriptis' | 'html-text'): string {
    if (mode === 'inscriptis') {
      // PLACEHOLDER: Would use inscriptis library
      return this.stripHtmlTags(html);
    }

    // Simple HTML stripping
    return this.stripHtmlTags(html);
  }

  /**
   * Strip HTML tags and decode entities
   */
  private stripHtmlTags(html: string): string {
    return (
      html
        // Remove script and style tags
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        // Remove HTML tags
        .replace(/<[^>]+>/g, ' ')
        // Decode common HTML entities
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim()
    );
  }

  /**
   * Fallback to the element's innerText for selector-specific extraction
   */
  private async getInnerText(selector: string): Promise<string> {
    try {
      const result = await this.cdpBridge.executeDevToolsMethod<{
        result: { value?: string };
      }>('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`,
        returnByValue: true,
      });
      return result.result.value ?? '';
    } catch {
      return '';
    }
  }

  /**
   * Get the document nodeId
   */
  private async getDocumentNodeId(): Promise<number> {
    const result = await this.cdpBridge.executeDevToolsMethod<{
      root: { nodeId: number };
    }>('DOM.getDocument', { depth: 0 });
    return result.root.nodeId;
  }
}
