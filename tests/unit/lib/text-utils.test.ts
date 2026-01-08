/**
 * Text Utils Tests
 *
 * Tests for CSS escaping and text processing utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  cssEscape,
  escapeAttrSelectorValue,
  escapeAttributeValue,
  normalizeText,
} from '../../../src/lib/text-utils.js';

describe('cssEscape', () => {
  describe('special CSS characters', () => {
    it('should escape colons', () => {
      expect(cssEscape('foo:bar')).toBe('foo\\:bar');
    });

    it('should escape dots', () => {
      expect(cssEscape('foo.bar')).toBe('foo\\.bar');
    });

    it('should escape brackets', () => {
      expect(cssEscape('foo[bar]')).toBe('foo\\[bar\\]');
    });

    it('should escape hash', () => {
      expect(cssEscape('foo#bar')).toBe('foo\\#bar');
    });

    it('should escape parentheses', () => {
      expect(cssEscape('foo(bar)')).toBe('foo\\(bar\\)');
    });

    it('should escape at sign', () => {
      expect(cssEscape('foo@bar')).toBe('foo\\@bar');
    });

    it('should escape percent', () => {
      expect(cssEscape('foo%bar')).toBe('foo\\%bar');
    });

    it('should escape ampersand', () => {
      expect(cssEscape('foo&bar')).toBe('foo\\&bar');
    });

    it('should escape plus', () => {
      expect(cssEscape('foo+bar')).toBe('foo\\+bar');
    });

    it('should escape equals', () => {
      expect(cssEscape('foo=bar')).toBe('foo\\=bar');
    });

    it('should escape tilde', () => {
      expect(cssEscape('foo~bar')).toBe('foo\\~bar');
    });

    it('should escape caret', () => {
      expect(cssEscape('foo^bar')).toBe('foo\\^bar');
    });

    it('should escape pipe', () => {
      expect(cssEscape('foo|bar')).toBe('foo\\|bar');
    });

    it('should escape slash', () => {
      expect(cssEscape('foo/bar')).toBe('foo\\/bar');
    });

    it('should escape space', () => {
      expect(cssEscape('foo bar')).toBe('foo\\ bar');
    });
  });

  describe('leading characters', () => {
    it('should escape leading digit with unicode notation', () => {
      // '1' is 0x31, so it becomes \31 followed by a space
      expect(cssEscape('123abc')).toBe('\\31 23abc');
    });

    it('should escape single hyphen', () => {
      expect(cssEscape('-')).toBe('\\-');
    });

    it('should escape hyphen followed by digit', () => {
      expect(cssEscape('-1abc')).toBe('\\-1abc');
    });

    it('should NOT escape hyphen followed by letter', () => {
      expect(cssEscape('-abc')).toBe('-abc');
    });

    it('should NOT escape hyphen in middle of string', () => {
      expect(cssEscape('foo-bar')).toBe('foo-bar');
    });
  });

  describe('control characters', () => {
    it('should replace null character with replacement char', () => {
      expect(cssEscape('foo\0bar')).toBe('foo\uFFFDbar');
    });

    it('should escape control characters with unicode notation', () => {
      // Tab (0x09) should become \9 followed by space
      expect(cssEscape('foo\tbar')).toBe('foo\\9 bar');
    });

    it('should escape newline with unicode notation', () => {
      // Newline (0x0A) should become \a followed by space
      expect(cssEscape('foo\nbar')).toBe('foo\\a bar');
    });
  });

  describe('safe characters', () => {
    it('should NOT escape lowercase letters', () => {
      expect(cssEscape('abcxyz')).toBe('abcxyz');
    });

    it('should NOT escape uppercase letters', () => {
      expect(cssEscape('ABCXYZ')).toBe('ABCXYZ');
    });

    it('should NOT escape digits after first position', () => {
      expect(cssEscape('abc123')).toBe('abc123');
    });

    it('should NOT escape underscore', () => {
      expect(cssEscape('foo_bar')).toBe('foo_bar');
    });

    it('should NOT escape hyphen (not first char)', () => {
      expect(cssEscape('foo-bar-baz')).toBe('foo-bar-baz');
    });

    it('should NOT escape non-ASCII characters', () => {
      expect(cssEscape('fooébar')).toBe('fooébar');
      expect(cssEscape('日本語')).toBe('日本語');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(cssEscape('')).toBe('');
    });

    it('should handle single safe character', () => {
      expect(cssEscape('a')).toBe('a');
    });

    it('should handle single special character', () => {
      expect(cssEscape(':')).toBe('\\:');
    });

    it('should handle multiple consecutive special chars', () => {
      expect(cssEscape(':::')).toBe('\\:\\:\\:');
    });

    it('should handle mixed content', () => {
      expect(cssEscape('btn:primary-1')).toBe('btn\\:primary-1');
    });

    it('should handle realistic Tailwind-style class', () => {
      expect(cssEscape('w-1/2')).toBe('w-1\\/2');
    });
  });

  describe('real-world ID/class patterns', () => {
    it('should handle BEM-style selectors', () => {
      expect(cssEscape('block__element--modifier')).toBe('block__element--modifier');
    });

    it('should handle namespace:component pattern', () => {
      expect(cssEscape('ns:component')).toBe('ns\\:component');
    });

    it('should handle React-style generated IDs', () => {
      expect(cssEscape(':r0:')).toBe('\\:r0\\:');
    });

    it('should handle Angular-style selectors', () => {
      expect(cssEscape('_ngcontent-xyz-c123')).toBe('_ngcontent-xyz-c123');
    });
  });
});

describe('escapeAttrSelectorValue', () => {
  it('should escape double quotes', () => {
    expect(escapeAttrSelectorValue('foo"bar')).toBe('foo\\"bar');
  });

  it('should escape backslashes', () => {
    expect(escapeAttrSelectorValue('foo\\bar')).toBe('foo\\\\bar');
  });

  it('should escape both quotes and backslashes', () => {
    expect(escapeAttrSelectorValue('foo\\"bar')).toBe('foo\\\\\\"bar');
  });

  it('should NOT escape colons (valid in attribute values)', () => {
    expect(escapeAttrSelectorValue('foo:bar')).toBe('foo:bar');
  });

  it('should NOT escape dots', () => {
    expect(escapeAttrSelectorValue('foo.bar')).toBe('foo.bar');
  });

  it('should NOT escape spaces', () => {
    expect(escapeAttrSelectorValue('foo bar')).toBe('foo bar');
  });

  it('should NOT escape brackets', () => {
    expect(escapeAttrSelectorValue('foo[bar]')).toBe('foo[bar]');
  });

  it('should handle empty string', () => {
    expect(escapeAttrSelectorValue('')).toBe('');
  });

  it('should NOT truncate long values', () => {
    const longValue = 'a'.repeat(200);
    expect(escapeAttrSelectorValue(longValue)).toBe(longValue);
  });

  it('should NOT normalize whitespace', () => {
    expect(escapeAttrSelectorValue('foo  bar')).toBe('foo  bar');
  });

  describe('control character escaping (CSS string spec)', () => {
    it('should replace null (U+0000) with replacement char', () => {
      expect(escapeAttrSelectorValue('foo\0bar')).toBe('foo\uFFFDbar');
    });

    it('should escape newline (U+000A) with hex notation', () => {
      expect(escapeAttrSelectorValue('foo\nbar')).toBe('foo\\a bar');
    });

    it('should escape carriage return (U+000D)', () => {
      expect(escapeAttrSelectorValue('foo\rbar')).toBe('foo\\d bar');
    });

    it('should escape form feed (U+000C)', () => {
      expect(escapeAttrSelectorValue('foo\fbar')).toBe('foo\\c bar');
    });

    it('should escape tab (U+0009)', () => {
      expect(escapeAttrSelectorValue('foo\tbar')).toBe('foo\\9 bar');
    });

    it('should escape DEL (U+007F)', () => {
      expect(escapeAttrSelectorValue('foo\x7Fbar')).toBe('foo\\7f bar');
    });

    it('should escape SOH (U+0001)', () => {
      expect(escapeAttrSelectorValue('foo\x01bar')).toBe('foo\\1 bar');
    });

    it('should escape US (U+001F)', () => {
      expect(escapeAttrSelectorValue('foo\x1Fbar')).toBe('foo\\1f bar');
    });

    it('should handle multiple control characters', () => {
      expect(escapeAttrSelectorValue('line1\nline2\ttab')).toBe('line1\\a line2\\9 tab');
    });

    it('should handle control chars with quotes and backslashes', () => {
      expect(escapeAttrSelectorValue('a"b\\c\nd')).toBe('a\\"b\\\\c\\a d');
    });

    it('should handle CRLF sequence', () => {
      expect(escapeAttrSelectorValue('line1\r\nline2')).toBe('line1\\d \\a line2');
    });
  });
});

describe('escapeAttributeValue (for display)', () => {
  it('should normalize and truncate', () => {
    const longValue = 'a'.repeat(200);
    const result = escapeAttributeValue(longValue);
    expect(result.length).toBeLessThanOrEqual(120);
  });

  it('should collapse whitespace', () => {
    expect(escapeAttributeValue('foo  bar')).toBe('foo bar');
  });

  it('should escape quotes', () => {
    expect(escapeAttributeValue('foo"bar')).toBe('foo\\"bar');
  });
});

describe('normalizeText', () => {
  it('should collapse multiple spaces', () => {
    expect(normalizeText('foo   bar')).toBe('foo bar');
  });

  it('should trim leading/trailing whitespace', () => {
    expect(normalizeText('  foo bar  ')).toBe('foo bar');
  });

  it('should remove zero-width characters', () => {
    expect(normalizeText('foo\u200Bbar')).toBe('foobar');
  });

  it('should normalize unicode', () => {
    // NFKC normalization: ﬁ (U+FB01) -> fi
    expect(normalizeText('ﬁle')).toBe('file');
  });
});
