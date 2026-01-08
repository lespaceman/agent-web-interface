/**
 * Attribute Extractor Tests
 *
 * Tests for extracting element-specific attributes based on NodeKind.
 */

import { describe, it, expect } from 'vitest';
import {
  extractAttributes,
  sanitizeUrl,
} from '../../../../src/snapshot/extractors/attribute-extractor.js';
import type { RawDomNode, RawAxNode, AxProperty } from '../../../../src/snapshot/extractors/types.js';

// Helper to create a minimal DOM node
function createDomNode(
  nodeName: string,
  attributes: Record<string, string> = {}
): RawDomNode {
  return {
    nodeId: 1,
    backendNodeId: 1,
    nodeName,
    nodeType: 1,
    attributes,
  };
}

// Helper to create a minimal AX node
function createAxNode(role: string, name?: string, properties?: AxProperty[]): RawAxNode {
  return {
    nodeId: 'ax-1',
    role,
    name,
    properties,
  };
}

describe('extractAttributes', () => {
  describe('input type extraction', () => {
    it('should extract input type for text input', () => {
      const domNode = createDomNode('INPUT', { type: 'text' });
      const result = extractAttributes(domNode, 'input');

      expect(result?.input_type).toBe('text');
    });

    it('should extract input type for email input', () => {
      const domNode = createDomNode('INPUT', { type: 'email' });
      const result = extractAttributes(domNode, 'input');

      expect(result?.input_type).toBe('email');
    });

    it('should extract input type for password input', () => {
      const domNode = createDomNode('INPUT', { type: 'password' });
      const result = extractAttributes(domNode, 'input');

      expect(result?.input_type).toBe('password');
    });

    it('should not extract input type for non-input kinds', () => {
      const domNode = createDomNode('INPUT', { type: 'text' });
      const result = extractAttributes(domNode, 'button');

      expect(result?.input_type).toBeUndefined();
    });
  });

  describe('placeholder extraction', () => {
    it('should extract placeholder for input', () => {
      const domNode = createDomNode('INPUT', { placeholder: 'Enter your name' });
      const result = extractAttributes(domNode, 'input');

      expect(result?.placeholder).toBe('Enter your name');
    });

    it('should extract placeholder for textarea', () => {
      const domNode = createDomNode('TEXTAREA', { placeholder: 'Write your message' });
      const result = extractAttributes(domNode, 'textarea');

      expect(result?.placeholder).toBe('Write your message');
    });

    it('should not include empty placeholder', () => {
      const domNode = createDomNode('INPUT', { placeholder: '' });
      const result = extractAttributes(domNode, 'input');

      expect(result?.placeholder).toBeUndefined();
    });
  });

  describe('value extraction', () => {
    it('should not extract value by default', () => {
      const domNode = createDomNode('INPUT', { type: 'text', value: 'secret data' });
      const result = extractAttributes(domNode, 'input');

      expect(result?.value).toBeUndefined();
    });

    it('should extract value when includeValues is true', () => {
      const domNode = createDomNode('INPUT', { type: 'text', value: 'some value' });
      const result = extractAttributes(domNode, 'input', { includeValues: true });

      expect(result?.value).toBe('some value');
    });

    it('should redact password value even when includeValues is true', () => {
      const domNode = createDomNode('INPUT', { type: 'password', value: 'mypassword123' });
      const result = extractAttributes(domNode, 'input', { includeValues: true });

      expect(result?.value).toBe('[REDACTED]');
    });

    it('should not redact password value when redactSensitive is false', () => {
      const domNode = createDomNode('INPUT', { type: 'password', value: 'mypassword123' });
      const result = extractAttributes(domNode, 'input', {
        includeValues: true,
        redactSensitive: false,
      });

      expect(result?.value).toBe('mypassword123');
    });
  });

  describe('href sanitization', () => {
    it('should extract href for links', () => {
      const domNode = createDomNode('A', { href: 'https://example.com/page' });
      const result = extractAttributes(domNode, 'link');

      expect(result?.href).toBe('https://example.com/page');
    });

    it('should remove sensitive query params from href', () => {
      const domNode = createDomNode('A', {
        href: 'https://example.com/page?user=john&token=abc123&next=home',
      });
      const result = extractAttributes(domNode, 'link');

      expect(result?.href).toBe('https://example.com/page?user=john&next=home');
    });

    it('should remove auth param from href', () => {
      const domNode = createDomNode('A', { href: 'https://example.com?auth=secret' });
      const result = extractAttributes(domNode, 'link');

      expect(result?.href).toBe('https://example.com/');
    });

    it('should remove key param from href', () => {
      const domNode = createDomNode('A', { href: 'https://api.example.com?key=apikey123' });
      const result = extractAttributes(domNode, 'link');

      expect(result?.href).toBe('https://api.example.com/');
    });

    it('should remove password param from href', () => {
      const domNode = createDomNode('A', { href: 'https://example.com?password=pass' });
      const result = extractAttributes(domNode, 'link');

      expect(result?.href).toBe('https://example.com/');
    });

    it('should remove secret param from href', () => {
      const domNode = createDomNode('A', { href: 'https://example.com?secret=shhh' });
      const result = extractAttributes(domNode, 'link');

      expect(result?.href).toBe('https://example.com/');
    });

    it('should not sanitize href when sanitizeUrls is false', () => {
      const domNode = createDomNode('A', {
        href: 'https://example.com/page?token=secret123',
      });
      const result = extractAttributes(domNode, 'link', { sanitizeUrls: false });

      expect(result?.href).toBe('https://example.com/page?token=secret123');
    });

    it('should truncate very long URLs', () => {
      const longPath = '/very-long/' + 'segment/'.repeat(50);
      const domNode = createDomNode('A', { href: `https://example.com${longPath}` });
      const result = extractAttributes(domNode, 'link');

      expect(result?.href!.length).toBeLessThanOrEqual(203); // 200 + '...'
    });

    it('should handle relative href', () => {
      const domNode = createDomNode('A', { href: '/about' });
      const result = extractAttributes(domNode, 'link');

      expect(result?.href).toBe('/about');
    });

    it('should not extract href for non-link kinds', () => {
      const domNode = createDomNode('A', { href: 'https://example.com' });
      const result = extractAttributes(domNode, 'button');

      expect(result?.href).toBeUndefined();
    });
  });

  describe('image attributes', () => {
    it('should extract alt text for images', () => {
      const domNode = createDomNode('IMG', { alt: 'A beautiful sunset' });
      const result = extractAttributes(domNode, 'image');

      expect(result?.alt).toBe('A beautiful sunset');
    });

    it('should extract src as domain + path only', () => {
      const domNode = createDomNode('IMG', {
        src: 'https://cdn.example.com/images/photo.jpg?v=123&resize=large',
      });
      const result = extractAttributes(domNode, 'image');

      expect(result?.src).toBe('cdn.example.com/images/photo.jpg');
    });

    it('should handle relative src', () => {
      const domNode = createDomNode('IMG', { src: '/images/photo.jpg' });
      const result = extractAttributes(domNode, 'image');

      expect(result?.src).toBe('/images/photo.jpg');
    });

    it('should handle data URLs gracefully', () => {
      const domNode = createDomNode('IMG', { src: 'data:image/png;base64,abc...' });
      const result = extractAttributes(domNode, 'image');

      // Data URLs should be truncated or marked
      expect(result?.src).toBe('[data-url]');
    });

    it('should not extract image attrs for non-image kinds', () => {
      const domNode = createDomNode('IMG', { alt: 'test', src: 'test.jpg' });
      const result = extractAttributes(domNode, 'button');

      expect(result?.alt).toBeUndefined();
      expect(result?.src).toBeUndefined();
    });
  });

  describe('heading level', () => {
    it('should extract heading level from H1 tag', () => {
      const domNode = createDomNode('H1');
      const result = extractAttributes(domNode, 'heading');

      expect(result?.heading_level).toBe(1);
    });

    it('should extract heading level from H2 tag', () => {
      const domNode = createDomNode('H2');
      const result = extractAttributes(domNode, 'heading');

      expect(result?.heading_level).toBe(2);
    });

    it('should extract heading level from H6 tag', () => {
      const domNode = createDomNode('H6');
      const result = extractAttributes(domNode, 'heading');

      expect(result?.heading_level).toBe(6);
    });

    it('should extract heading level from AX properties', () => {
      const domNode = createDomNode('DIV', { role: 'heading' });
      const axNode = createAxNode('heading', 'Title', [
        { name: 'level', value: { type: 'integer', value: 3 } },
      ]);
      const result = extractAttributes(domNode, 'heading', {}, axNode);

      expect(result?.heading_level).toBe(3);
    });

    it('should prefer AX level over tag-based level', () => {
      const domNode = createDomNode('H1');
      const axNode = createAxNode('heading', 'Title', [
        { name: 'level', value: { type: 'integer', value: 2 } },
      ]);
      const result = extractAttributes(domNode, 'heading', {}, axNode);

      // AX tree is more accurate for ARIA headings
      expect(result?.heading_level).toBe(2);
    });

    it('should not extract heading level for non-heading kinds', () => {
      const domNode = createDomNode('H1');
      const result = extractAttributes(domNode, 'paragraph');

      expect(result?.heading_level).toBeUndefined();
    });
  });

  describe('form attributes', () => {
    it('should extract action for form', () => {
      const domNode = createDomNode('FORM', { action: '/submit' });
      const result = extractAttributes(domNode, 'form');

      expect(result?.action).toBe('/submit');
    });

    it('should extract method for form', () => {
      const domNode = createDomNode('FORM', { method: 'POST' });
      const result = extractAttributes(domNode, 'form');

      expect(result?.method).toBe('POST');
    });

    it('should extract both action and method', () => {
      const domNode = createDomNode('FORM', { action: '/api/login', method: 'post' });
      const result = extractAttributes(domNode, 'form');

      expect(result?.action).toBe('/api/login');
      expect(result?.method).toBe('post');
    });

    it('should not extract form attrs for non-form kinds', () => {
      const domNode = createDomNode('FORM', { action: '/submit', method: 'POST' });
      const result = extractAttributes(domNode, 'button');

      expect(result?.action).toBeUndefined();
      expect(result?.method).toBeUndefined();
    });
  });

  describe('autocomplete attribute', () => {
    it('should extract autocomplete for input', () => {
      const domNode = createDomNode('INPUT', { autocomplete: 'email' });
      const result = extractAttributes(domNode, 'input');

      expect(result?.autocomplete).toBe('email');
    });

    it('should extract autocomplete for select', () => {
      const domNode = createDomNode('SELECT', { autocomplete: 'country' });
      const result = extractAttributes(domNode, 'select');

      expect(result?.autocomplete).toBe('country');
    });
  });

  describe('test ID extraction', () => {
    it('should extract data-testid', () => {
      const domNode = createDomNode('BUTTON', { 'data-testid': 'submit-button' });
      const result = extractAttributes(domNode, 'button');

      expect(result?.test_id).toBe('submit-button');
    });

    it('should extract data-test', () => {
      const domNode = createDomNode('BUTTON', { 'data-test': 'login-btn' });
      const result = extractAttributes(domNode, 'button');

      expect(result?.test_id).toBe('login-btn');
    });

    it('should extract data-cy', () => {
      const domNode = createDomNode('BUTTON', { 'data-cy': 'register' });
      const result = extractAttributes(domNode, 'button');

      expect(result?.test_id).toBe('register');
    });

    it('should extract data-test-id', () => {
      const domNode = createDomNode('BUTTON', { 'data-test-id': 'nav-menu' });
      const result = extractAttributes(domNode, 'button');

      expect(result?.test_id).toBe('nav-menu');
    });

    it('should prefer data-testid over other test ID attributes', () => {
      const domNode = createDomNode('BUTTON', {
        'data-testid': 'preferred',
        'data-test': 'fallback',
        'data-cy': 'another',
      });
      const result = extractAttributes(domNode, 'button');

      expect(result?.test_id).toBe('preferred');
    });
  });

  describe('role attribute', () => {
    it('should extract explicit role attribute', () => {
      const domNode = createDomNode('DIV', { role: 'button' });
      const result = extractAttributes(domNode, 'button');

      expect(result?.role).toBe('button');
    });

    it('should not extract role if not present', () => {
      const domNode = createDomNode('BUTTON');
      const result = extractAttributes(domNode, 'button');

      expect(result?.role).toBeUndefined();
    });
  });

  describe('missing attribute handling', () => {
    it('should return undefined for node with no relevant attributes', () => {
      const domNode = createDomNode('BUTTON');
      const result = extractAttributes(domNode, 'button');

      // Should be undefined when no attributes are extracted
      expect(result).toBeUndefined();
    });

    it('should handle undefined domNode', () => {
      const result = extractAttributes(undefined, 'button');

      expect(result).toBeUndefined();
    });

    it('should handle undefined attributes', () => {
      const domNode: RawDomNode = {
        nodeId: 1,
        backendNodeId: 1,
        nodeName: 'BUTTON',
        nodeType: 1,
        // No attributes field
      };
      const result = extractAttributes(domNode, 'button');

      expect(result).toBeUndefined();
    });
  });
});

describe('sanitizeUrl', () => {
  it('should preserve normal URLs', () => {
    expect(sanitizeUrl('https://example.com/page')).toBe('https://example.com/page');
  });

  it('should remove token parameter', () => {
    expect(sanitizeUrl('https://example.com?token=abc')).toBe('https://example.com/');
  });

  it('should remove api_key parameter', () => {
    expect(sanitizeUrl('https://example.com?api_key=xyz')).toBe('https://example.com/');
  });

  it('should remove access_token parameter', () => {
    expect(sanitizeUrl('https://example.com?access_token=bearer123')).toBe(
      'https://example.com/'
    );
  });

  it('should handle multiple sensitive params', () => {
    expect(sanitizeUrl('https://example.com?token=a&user=b&key=c')).toBe(
      'https://example.com/?user=b'
    );
  });

  it('should handle relative URLs', () => {
    expect(sanitizeUrl('/page?name=john')).toBe('/page?name=john');
  });

  it('should truncate long URLs', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(300);
    const result = sanitizeUrl(longUrl);
    expect(result.length).toBeLessThanOrEqual(203);
  });
});
