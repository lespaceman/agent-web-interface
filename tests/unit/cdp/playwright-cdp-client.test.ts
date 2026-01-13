/**
 * PlaywrightCdpClient Tests
 *
 * TDD tests for PlaywrightCdpClient implementation.
 * Tests event listener cleanup, method validation, and domain configuration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlaywrightCdpClient } from '../../../src/cdp/playwright-cdp-client.js';
import { createMockCDPSession, type MockCDPSession } from '../../mocks/playwright.mock.js';
import type { CDPSession } from 'playwright';

describe('PlaywrightCdpClient', () => {
  let client: PlaywrightCdpClient;
  let mockCdpSession: MockCDPSession;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCdpSession = createMockCDPSession();
    client = new PlaywrightCdpClient(mockCdpSession as unknown as CDPSession);
  });

  describe('close() - event listener cleanup', () => {
    it('should remove all event listeners registered via on()', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      client.on('Page.loadEventFired', handler1);
      client.on('DOM.documentUpdated', handler2);

      await client.close();

      // Verify off() was called for each handler
      expect(mockCdpSession.off).toHaveBeenCalledWith('Page.loadEventFired', handler1);
      expect(mockCdpSession.off).toHaveBeenCalledWith('DOM.documentUpdated', handler2);
    });

    it('should handle multiple handlers for same event', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      client.on('Page.loadEventFired', handler1);
      client.on('Page.loadEventFired', handler2);

      await client.close();

      expect(mockCdpSession.off).toHaveBeenCalledWith('Page.loadEventFired', handler1);
      expect(mockCdpSession.off).toHaveBeenCalledWith('Page.loadEventFired', handler2);
    });

    it('should clear handler tracking after close()', async () => {
      client.on('Page.loadEventFired', vi.fn());
      await client.close();

      expect(client.isActive()).toBe(false);
    });

    it('should not throw if close() called with no registered handlers', async () => {
      await expect(client.close()).resolves.not.toThrow();
    });

    it('should handle off() errors gracefully during close()', async () => {
      const handler = vi.fn();
      client.on('Page.loadEventFired', handler);
      mockCdpSession.off.mockImplementation(() => {
        throw new Error('Already removed');
      });

      // Should not throw, should complete gracefully
      await expect(client.close()).resolves.not.toThrow();
    });

    it('should not call off() again for handlers removed via off() before close()', async () => {
      const handler = vi.fn();
      client.on('Page.loadEventFired', handler);
      client.off('Page.loadEventFired', handler);

      // Clear mock to track only close() behavior
      mockCdpSession.off.mockClear();

      await client.close();

      // Handler was already removed, so off() should not be called again
      expect(mockCdpSession.off).not.toHaveBeenCalledWith('Page.loadEventFired', handler);
    });
  });

  describe('send() - method validation', () => {
    it('should reject invalid method format (no dot)', async () => {
      await expect(client.send('nodot')).rejects.toThrow(/invalid.*method.*format/i);
    });

    it('should accept valid method format', async () => {
      mockCdpSession.send.mockResolvedValue({ root: { nodeId: 1 } });

      const result = await client.send('DOM.getDocument', { depth: -1 });

      expect(result).toEqual({ root: { nodeId: 1 } });
    });

    it('should throw for empty method string', async () => {
      await expect(client.send('')).rejects.toThrow(/invalid.*method.*format/i);
    });
  });

  describe('domain enabling - configurability', () => {
    it('should not call enable for domains in default domainsWithoutEnable list', async () => {
      mockCdpSession.send.mockResolvedValue({});

      await client.send('Browser.getVersion');

      // Browser.enable should NOT be called
      expect(mockCdpSession.send).not.toHaveBeenCalledWith('Browser.enable');
      expect(mockCdpSession.send).toHaveBeenCalledWith('Browser.getVersion', undefined);
    });

    it('should auto-enable domains that support it', async () => {
      mockCdpSession.send.mockResolvedValue({});

      await client.send('DOM.getDocument');

      // DOM.enable should be called first
      expect(mockCdpSession.send).toHaveBeenCalledWith('DOM.enable');
      expect(mockCdpSession.send).toHaveBeenCalledWith('DOM.getDocument', undefined);
    });

    it('should accept custom domainsWithoutEnable in options', async () => {
      const customClient = new PlaywrightCdpClient(mockCdpSession as unknown as CDPSession, {
        domainsWithoutEnable: ['CustomDomain'],
      });
      mockCdpSession.send.mockResolvedValue({});

      await customClient.send('CustomDomain.someMethod');

      // CustomDomain.enable should NOT be called
      expect(mockCdpSession.send).not.toHaveBeenCalledWith('CustomDomain.enable');
      expect(mockCdpSession.send).toHaveBeenCalledWith('CustomDomain.someMethod', undefined);
    });

    it('should use default domains when custom list has different domain', async () => {
      // Create client with custom list that doesn't include Browser
      const customClient = new PlaywrightCdpClient(mockCdpSession as unknown as CDPSession, {
        domainsWithoutEnable: ['CustomDomain'],
      });
      mockCdpSession.send.mockResolvedValue({});

      await customClient.send('Browser.getVersion');

      // Browser.enable SHOULD be called since custom list doesn't include Browser
      expect(mockCdpSession.send).toHaveBeenCalledWith('Browser.enable');
    });
  });

  describe('on() and off()', () => {
    it('should register handler with underlying session', () => {
      const handler = vi.fn();

      client.on('Page.loadEventFired', handler);

      expect(mockCdpSession.on).toHaveBeenCalledWith('Page.loadEventFired', handler);
    });

    it('should unregister handler from underlying session', () => {
      const handler = vi.fn();

      client.on('Page.loadEventFired', handler);
      client.off('Page.loadEventFired', handler);

      expect(mockCdpSession.off).toHaveBeenCalledWith('Page.loadEventFired', handler);
    });
  });

  describe('once()', () => {
    it('should call handler only once', () => {
      const handler = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      let capturedHandler: (params: Record<string, unknown>) => void = () => {};

      // Capture the wrapped handler passed to session.on
      mockCdpSession.on.mockImplementation(
        (_event: string, h: (params: Record<string, unknown>) => void) => {
          capturedHandler = h;
        }
      );

      client.once('Page.loadEventFired', handler);

      // Simulate event firing
      capturedHandler({ timestamp: 123 });

      expect(handler).toHaveBeenCalledWith({ timestamp: 123 });
      // off() should have been called to unregister
      expect(mockCdpSession.off).toHaveBeenCalled();
    });
  });

  describe('isActive()', () => {
    it('should return true initially', () => {
      expect(client.isActive()).toBe(true);
    });

    it('should return false after close()', async () => {
      await client.close();

      expect(client.isActive()).toBe(false);
    });

    it('should return false after "Target closed" error', async () => {
      mockCdpSession.send.mockRejectedValue(new Error('Target closed'));

      await expect(client.send('DOM.getDocument')).rejects.toThrow('Target closed');
      expect(client.isActive()).toBe(false);
    });

    it('should return false after "Session closed" error', async () => {
      // First call (DOM.enable) succeeds
      mockCdpSession.send.mockResolvedValueOnce({});
      // Second call fails with session closed
      mockCdpSession.send.mockRejectedValueOnce(new Error('Session closed'));

      await expect(client.send('DOM.getDocument')).rejects.toThrow('Session closed');
      expect(client.isActive()).toBe(false);
    });

    it('should return false after "detached" error', async () => {
      mockCdpSession.send.mockRejectedValue(new Error('Target page or frame detached'));

      await expect(client.send('DOM.getDocument')).rejects.toThrow('detached');
      expect(client.isActive()).toBe(false);
    });
  });

  describe('getHealth()', () => {
    it('should return active=true and no error initially', () => {
      const health = client.getHealth();

      expect(health.active).toBe(true);
      expect(health.lastError).toBeUndefined();
      expect(health.lastErrorTime).toBeUndefined();
    });

    it('should return active=false after close()', async () => {
      await client.close();

      const health = client.getHealth();
      expect(health.active).toBe(false);
    });

    it('should track last error after failed send()', async () => {
      mockCdpSession.send.mockRejectedValue(new Error('Target closed'));

      await expect(client.send('DOM.getDocument')).rejects.toThrow();

      const health = client.getHealth();
      expect(health.active).toBe(false);
      expect(health.lastError).toBe('Target closed');
      expect(health.lastErrorTime).toBeInstanceOf(Date);
    });

    it('should track non-fatal errors without marking inactive', async () => {
      // First call (DOM.enable) succeeds
      mockCdpSession.send.mockResolvedValueOnce({});
      // Second call fails with non-fatal error
      mockCdpSession.send.mockRejectedValueOnce(new Error('Could not compute box model'));

      await expect(client.send('DOM.getBoxModel', { nodeId: 123 })).rejects.toThrow(
        'Could not compute box model'
      );

      const health = client.getHealth();
      // Non-fatal error should NOT mark session inactive
      expect(health.active).toBe(true);
      expect(health.lastError).toBe('Could not compute box model');
      expect(health.lastErrorTime).toBeInstanceOf(Date);
    });

    it('should update lastError on subsequent errors', async () => {
      // First error
      mockCdpSession.send.mockRejectedValueOnce(new Error('First error'));
      await expect(client.send('Browser.getVersion')).rejects.toThrow();

      const health1 = client.getHealth();
      expect(health1.lastError).toBe('First error');

      // Second error
      mockCdpSession.send.mockRejectedValueOnce(new Error('Second error'));
      await expect(client.send('Browser.getWindowBounds')).rejects.toThrow();

      const health2 = client.getHealth();
      expect(health2.lastError).toBe('Second error');
    });
  });
});
