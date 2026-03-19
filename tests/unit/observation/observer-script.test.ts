/**
 * Observer Script Tests
 *
 * Tests for the browser-side DOM observation script, specifically the text extraction
 * logic that should exclude CSS and JavaScript content.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OBSERVATION_OBSERVER_SCRIPT } from '../../../src/observation/observer-script.js';

describe('OBSERVATION_OBSERVER_SCRIPT', () => {
  describe('getCleanTextContent', () => {
    let getCleanTextContent: (el: Element, maxLength: number) => string;

    beforeEach(() => {
      // Execute the script to make getCleanTextContent available
      // We extract just the getCleanTextContent function for isolated testing
      //
      // WARNING: This implementation must be kept in sync with observer-script.ts
      // See "sync validation" tests below that verify key aspects match the source.
      const extractedFunction = `
        const EXCLUDED_TEXT_TAGS = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'SVG']);

        function getCleanTextContent(el, maxLength) {
          if (EXCLUDED_TEXT_TAGS.has(el.tagName.toUpperCase())) {
            return '';
          }

          const walker = document.createTreeWalker(el, 4, { // NodeFilter.SHOW_TEXT = 4
            acceptNode: function(node) {
              let parent = node.parentElement;
              while (parent && parent !== el) {
                if (EXCLUDED_TEXT_TAGS.has(parent.tagName.toUpperCase())) {
                  return 2; // FILTER_REJECT
                }
                parent = parent.parentElement;
              }
              return 1; // FILTER_ACCEPT
            }
          });

          const textParts = [];
          let totalLength = 0;
          let node;

          while ((node = walker.nextNode()) && totalLength < maxLength) {
            const text = node.nodeValue;
            if (text) {
              const trimmed = text.trim();
              if (trimmed) {
                textParts.push(trimmed);
                totalLength += trimmed.length;
              }
            }
          }

          return textParts.join(' ').substring(0, maxLength);
        }

        window.__testGetCleanTextContent = getCleanTextContent;
      `;

      eval(extractedFunction);

      getCleanTextContent = (
        window as unknown as { __testGetCleanTextContent: typeof getCleanTextContent }
      ).__testGetCleanTextContent;
    });

    it('should extract text content from simple elements', () => {
      const div = document.createElement('div');
      div.textContent = 'Hello world';

      const result = getCleanTextContent(div, 100);
      expect(result).toBe('Hello world');
    });

    it('should exclude style tag content', () => {
      const div = document.createElement('div');
      div.innerHTML = `
        <span>Hello world</span>
        <style>.some-class { color: red; }</style>
      `;

      const result = getCleanTextContent(div, 100);
      expect(result).toBe('Hello world');
      expect(result).not.toContain('.some-class');
      expect(result).not.toContain('color');
    });

    it('should exclude script tag content', () => {
      const div = document.createElement('div');
      div.innerHTML = `
        <p>Important message</p>
        <script>console.log('executed');</script>
      `;

      const result = getCleanTextContent(div, 100);
      expect(result).toBe('Important message');
      expect(result).not.toContain('console');
      expect(result).not.toContain('executed');
    });

    it('should exclude noscript tag content', () => {
      const div = document.createElement('div');
      div.innerHTML = `
        <span>Main content</span>
        <noscript>JavaScript is disabled</noscript>
      `;

      const result = getCleanTextContent(div, 100);
      expect(result).toBe('Main content');
      expect(result).not.toContain('JavaScript is disabled');
    });

    it('should exclude template tag content', () => {
      const div = document.createElement('div');
      div.innerHTML = `
        <span>Visible content</span>
        <template>Template content</template>
      `;

      const result = getCleanTextContent(div, 100);
      expect(result).toBe('Visible content');
      expect(result).not.toContain('Template content');
    });

    it('should exclude SVG text content', () => {
      const div = document.createElement('div');
      div.innerHTML = '<span>Regular text</span>';
      // Create SVG element properly for jsdom
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const svgText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      svgText.textContent = 'SVG text';
      svg.appendChild(svgText);
      div.appendChild(svg);

      const result = getCleanTextContent(div, 100);
      expect(result).toBe('Regular text');
      expect(result).not.toContain('SVG text');
    });

    it('should handle CSS-in-JS injected styles (original bug)', () => {
      // This is the exact scenario from the bug report
      const div = document.createElement('div');
      div.innerHTML = `
        <span>harleen deol retired out</span>
        <style>.MagqMc .ZFiwCf{background-color:#fff;border:1px solid #dadce0}</style>
      `;

      const result = getCleanTextContent(div, 200);
      expect(result).toBe('harleen deol retired out');
      expect(result).not.toContain('MagqMc');
      expect(result).not.toContain('background-color');
      expect(result).not.toContain('#fff');
    });

    it('should handle nested style tags inside other elements', () => {
      const div = document.createElement('div');
      div.innerHTML = `
        <div>
          <span>First text</span>
          <div>
            <style>.nested { display: none; }</style>
            <span>Second text</span>
          </div>
        </div>
      `;

      const result = getCleanTextContent(div, 100);
      expect(result).toBe('First text Second text');
      expect(result).not.toContain('.nested');
      expect(result).not.toContain('display');
    });

    it('should handle multiple excluded tags', () => {
      const div = document.createElement('div');
      div.innerHTML = `
        <span>Clean text</span>
        <style>.css { color: blue; }</style>
        <script>var x = 1;</script>
        <noscript>No JS</noscript>
      `;

      const result = getCleanTextContent(div, 100);
      expect(result).toBe('Clean text');
    });

    it('should respect maxLength parameter', () => {
      const div = document.createElement('div');
      div.textContent = 'This is a very long text that should be truncated';

      const result = getCleanTextContent(div, 20);
      expect(result.length).toBeLessThanOrEqual(20);
      expect(result).toBe('This is a very long ');
    });

    it('should return empty string for style elements', () => {
      const style = document.createElement('style');
      style.textContent = '.class { color: red; }';

      const result = getCleanTextContent(style, 100);
      expect(result).toBe('');
    });

    it('should return empty string for script elements', () => {
      const script = document.createElement('script');
      script.textContent = 'console.log("test");';

      const result = getCleanTextContent(script, 100);
      expect(result).toBe('');
    });

    it('should join text from multiple text nodes with spaces', () => {
      const div = document.createElement('div');
      div.innerHTML = '<span>First</span> <span>Second</span> <span>Third</span>';

      const result = getCleanTextContent(div, 100);
      expect(result).toBe('First Second Third');
    });

    it('should handle empty elements', () => {
      const div = document.createElement('div');

      const result = getCleanTextContent(div, 100);
      expect(result).toBe('');
    });

    it('should handle elements with only whitespace', () => {
      const div = document.createElement('div');
      div.innerHTML = '   \n\t   ';

      const result = getCleanTextContent(div, 100);
      expect(result).toBe('');
    });

    it('should handle deeply nested content', () => {
      const div = document.createElement('div');
      div.innerHTML = `
        <div>
          <div>
            <div>
              <span>Deep content</span>
              <style>.deep { margin: 0; }</style>
            </div>
          </div>
        </div>
      `;

      const result = getCleanTextContent(div, 100);
      expect(result).toBe('Deep content');
      expect(result).not.toContain('.deep');
    });
  });

  describe('script contains getCleanTextContent', () => {
    it('should include getCleanTextContent function', () => {
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('getCleanTextContent');
    });

    it('should include EXCLUDED_TEXT_TAGS set', () => {
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('EXCLUDED_TEXT_TAGS');
    });

    it('should use getCleanTextContent in computeSignals', () => {
      // Verify the script uses getCleanTextContent instead of el.textContent directly
      // in the computeSignals function
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('getCleanTextContent(el');
    });

    it('should use getCleanTextContent in captureEntry', () => {
      // Verify the script uses getCleanTextContent in captureEntry function
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('getCleanTextContent(el, MAX_TEXT_LENGTH)');
    });
  });

  describe('characterData and visibility tracking', () => {
    it('should include characterData in MutationObserver config', () => {
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('characterData: true');
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('characterDataOldValue: true');
    });

    it('should include attributes tracking for visibility changes', () => {
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('attributes: true');
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('attributeFilter: VISIBILITY_ATTRS');
    });

    it('should define VISIBILITY_ATTRS with style, class, hidden, aria-hidden', () => {
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain("'style'");
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain("'class'");
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain("'hidden'");
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain("'aria-hidden'");
    });

    it('should define LIVE_REGION_ROLES for characterData ancestor lookup', () => {
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('LIVE_REGION_ROLES');
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain("'alert'");
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain("'status'");
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain("'log'");
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain("'timer'");
    });

    it('should have findLiveRegionAncestor function', () => {
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('function findLiveRegionAncestor');
    });

    it('should have processCharacterDataMutation function', () => {
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('function processCharacterDataMutation');
    });

    it('should have processAttributeMutation function', () => {
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('function processAttributeMutation');
    });

    it('should handle characterData mutations in the callback', () => {
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain("m.type === 'characterData'");
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('processCharacterDataMutation(m, shadowPath)');
    });

    it('should handle attributes mutations in the callback', () => {
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain("m.type === 'attributes'");
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('processAttributeMutation(m, shadowPath)');
    });
  });

  describe('sync validation', () => {
    it('should have matching EXCLUDED_TEXT_TAGS in source', () => {
      const expectedTags = ['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'SVG'];
      for (const tag of expectedTags) {
        expect(OBSERVATION_OBSERVER_SCRIPT).toContain(`'${tag}'`);
      }
    });

    it('should have getCleanTextContent with same signature', () => {
      expect(OBSERVATION_OBSERVER_SCRIPT).toContain('function getCleanTextContent(el, maxLength)');
    });
  });
});
