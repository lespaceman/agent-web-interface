/**
 * DOM Stabilizer Tests
 *
 * Tests for stabilizeDom timeout paths and edge cases.
 */

import { describe, it, expect, vi } from 'vitest';
import { stabilizeDom } from '../../../src/delta/dom-stabilizer.js';
import type { Page } from 'puppeteer-core';
import { createMockPage, type MockPage } from '../../mocks/puppeteer.mock.js';

/**
 * Helper to create a mock page with a specific evaluate result.
 */
function createMockPageWithEvaluate(evaluateResult: unknown): MockPage {
  const page = createMockPage();
  page.evaluate.mockResolvedValue(evaluateResult);
  return page;
}

describe('stabilizeDom', () => {
  describe('stable page (no mutations)', () => {
    it('should return stable status when no mutations within quiet window', async () => {
      const mockPage = createMockPageWithEvaluate({
        stable: true,
        elapsed: 100,
        mutationCount: 0,
      });

      const result = await stabilizeDom(mockPage as unknown as Page);

      expect(result.status).toBe('stable');
      expect(result.mutationCount).toBe(0);
      expect(result.warning).toBeUndefined();
    });

    it('should return stable status with mutation count when mutations settled', async () => {
      const mockPage = createMockPageWithEvaluate({
        stable: true,
        elapsed: 250,
        mutationCount: 5,
      });

      const result = await stabilizeDom(mockPage as unknown as Page);

      expect(result.status).toBe('stable');
      expect(result.mutationCount).toBe(5);
      expect(result.warning).toBeUndefined();
    });
  });

  describe('timeout path (continuous mutations)', () => {
    it('should return timeout status when mutations continue past max timeout', async () => {
      const mockPage = createMockPageWithEvaluate({
        stable: false,
        elapsed: 2000,
        mutationCount: 100,
      });

      const result = await stabilizeDom(mockPage as unknown as Page);

      expect(result.status).toBe('timeout');
      expect(result.mutationCount).toBe(100);
      expect(result.warning).toContain('DOM still mutating');
      expect(result.warning).toContain('100 mutations observed');
    });

    it('should respect custom maxTimeoutMs option', async () => {
      const mockPage = createMockPageWithEvaluate({
        stable: false,
        elapsed: 500,
        mutationCount: 10,
      });

      const result = await stabilizeDom(mockPage as unknown as Page, { maxTimeoutMs: 500 });

      expect(result.status).toBe('timeout');
      expect(result.warning).toContain('500ms');
    });
  });

  describe('missing document.body (navigation edge case)', () => {
    it('should handle missing document.body gracefully', async () => {
      const mockPage = createMockPageWithEvaluate({
        stable: false,
        elapsed: 0,
        mutationCount: 0,
      });

      const result = await stabilizeDom(mockPage as unknown as Page);

      expect(result.status).toBe('timeout');
      expect(result.mutationCount).toBe(0);
    });
  });

  describe('error path (page.evaluate failure)', () => {
    it('should return error status when page.evaluate throws', async () => {
      const mockPage = {
        evaluate: vi.fn().mockRejectedValue(new Error('Execution context was destroyed')),
      } as unknown as Page;

      const result = await stabilizeDom(mockPage as unknown as Page);

      expect(result.status).toBe('error');
      expect(result.warning).toContain('Stabilization interrupted');
      expect(result.warning).toContain('Execution context was destroyed');
    });

    it('should handle non-Error rejections', async () => {
      const mockPage = {
        evaluate: vi.fn().mockRejectedValue('Navigation occurred'),
      } as unknown as Page;

      const result = await stabilizeDom(mockPage as unknown as Page);

      expect(result.status).toBe('error');
      expect(result.warning).toContain('Navigation occurred');
    });
  });

  describe('custom options', () => {
    it('should pass quietWindowMs to page.evaluate', async () => {
      const mockPage = createMockPageWithEvaluate({
        stable: true,
        elapsed: 50,
        mutationCount: 0,
      });

      await stabilizeDom(mockPage as unknown as Page, { quietWindowMs: 50 });

      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        quietWindowMs: 50,
        maxTimeoutMs: 2000,
      });
    });

    it('should pass maxTimeoutMs to page.evaluate', async () => {
      const mockPage = createMockPageWithEvaluate({
        stable: true,
        elapsed: 100,
        mutationCount: 0,
      });

      await stabilizeDom(mockPage as unknown as Page, { maxTimeoutMs: 1000 });

      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        quietWindowMs: 100,
        maxTimeoutMs: 1000,
      });
    });

    it('should use default options when none provided', async () => {
      const mockPage = createMockPageWithEvaluate({
        stable: true,
        elapsed: 100,
        mutationCount: 0,
      });

      await stabilizeDom(mockPage as unknown as Page);

      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        quietWindowMs: 100,
        maxTimeoutMs: 2000,
      });
    });
  });

  describe('waitTimeMs tracking', () => {
    it('should track actual wall-clock time', async () => {
      const mockPage = createMockPageWithEvaluate({
        stable: true,
        elapsed: 100,
        mutationCount: 0,
      });

      const startTime = Date.now();
      const result = await stabilizeDom(mockPage as unknown as Page);
      const endTime = Date.now();

      // waitTimeMs should be approximately the time the function took
      expect(result.waitTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.waitTimeMs).toBeLessThanOrEqual(endTime - startTime + 100);
    });
  });
});
