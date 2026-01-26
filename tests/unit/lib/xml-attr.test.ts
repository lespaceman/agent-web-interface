import { describe, it, expect } from 'vitest';
import { xmlAttr } from '../../../src/lib/text-utils.js';

describe('xmlAttr', () => {
  it('should use single quotes when value contains double quotes', () => {
    const result = xmlAttr('primary', 'role=button[name="Shopping Bag"]');
    expect(result).toBe(`primary='role=button[name="Shopping Bag"]'`);
    expect(result).not.toContain('&quot;');
  });

  it('should use double quotes for simple values', () => {
    const result = xmlAttr('id', 'submit-btn');
    expect(result).toBe('id="submit-btn"');
  });

  it('should escape < > & in single-quoted values', () => {
    const result = xmlAttr('test', 'a < b & c > d "quoted"');
    expect(result).toBe(`test='a &lt; b &amp; c &gt; d "quoted"'`);
  });

  it('should handle values with both quote types using double quotes', () => {
    const result = xmlAttr('test', `He said "it's fine"`);
    expect(result).toBe(`test="He said &quot;it&apos;s fine&quot;"`);
  });

  it('should handle empty values', () => {
    expect(xmlAttr('empty', '')).toBe('empty=""');
  });

  it('should handle values with only single quotes using double quotes', () => {
    const result = xmlAttr('test', "it's a test");
    expect(result).toBe(`test="it&apos;s a test"`);
  });
});
