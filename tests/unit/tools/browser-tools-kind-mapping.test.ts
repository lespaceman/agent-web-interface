/**
 * Kind mapping tests for find schema-to-internal kind conversion.
 */
import { describe, it, expect } from 'vitest';
import { mapSchemaKindToNodeKind } from '../../../src/tools/browser-tools.js';

describe('mapSchemaKindToNodeKind', () => {
  it('maps textbox to input and textarea', () => {
    const result = mapSchemaKindToNodeKind('textbox');
    expect(result).toEqual(['input', 'textarea']);
  });

  it('maps canvas to canvas', () => {
    const result = mapSchemaKindToNodeKind('canvas');
    expect(result).toBe('canvas');
  });

  it('passes through button unchanged', () => {
    const result = mapSchemaKindToNodeKind('button');
    expect(result).toBe('button');
  });

  it('passes through link unchanged', () => {
    const result = mapSchemaKindToNodeKind('link');
    expect(result).toBe('link');
  });

  it('passes through checkbox unchanged', () => {
    const result = mapSchemaKindToNodeKind('checkbox');
    expect(result).toBe('checkbox');
  });

  it('passes through radio unchanged', () => {
    const result = mapSchemaKindToNodeKind('radio');
    expect(result).toBe('radio');
  });

  it('passes through combobox unchanged', () => {
    const result = mapSchemaKindToNodeKind('combobox');
    expect(result).toBe('combobox');
  });

  it('passes through image unchanged', () => {
    const result = mapSchemaKindToNodeKind('image');
    expect(result).toBe('image');
  });

  it('passes through heading unchanged', () => {
    const result = mapSchemaKindToNodeKind('heading');
    expect(result).toBe('heading');
  });

  it('maps alert to all live region kinds', () => {
    const result = mapSchemaKindToNodeKind('alert');
    expect(result).toEqual(['alert', 'status', 'log', 'tooltip', 'progressbar', 'timer']);
  });
});
