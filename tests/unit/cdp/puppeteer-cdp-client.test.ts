/**
 * Tests for PuppeteerCdpClient
 *
 * Covers:
 * - Event listener cleanup on close()
 * - Method format validation
 * - Domain auto-enabling
 * - on(), off(), once() event handling
 * - isActive() state tracking
 * - getHealth() diagnostics
 * - Timeout behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PuppeteerCdpClient } from '../../../src/cdp/puppeteer-cdp-client.js';
import type { CDPSession } from 'puppeteer-core';

/**
 * Creates a mock CDPSession for testing PuppeteerCdpClient directly
 */
function createMockCDPSession(): {
  session: CDPSession;
  mockSend: ReturnType<typeof vi.fn>;
  mockOn: ReturnType<typeof vi.fn>;
  mockOff: ReturnType<typeof vi.fn>;
  mockDetach: ReturnType<typeof vi.fn>;
} {
  const mockSend = vi.fn().mockResolvedValue({});
  const mockOn = vi.fn();
  const mockOff = vi.fn();
  const mockDetach = vi.fn().mockResolvedValue(undefined);

  const session = {
    send: mockSend,
    on: mockOn,
    off: mockOff,
    detach: mockDetach,
  } as unknown as CDPSession;

  return { session, mockSend, mockOn, mockOff, mockDetach };
}

describe('PuppeteerCdpClient', () => {
  let mockSession: CDPSession;
  let mockSend: ReturnType<typeof vi.fn>;
  let mockOn: ReturnType<typeof vi.fn>;
  let mockOff: ReturnType<typeof vi.fn>;
  let mockDetach: ReturnType<typeof vi.fn>;
  let client: PuppeteerCdpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = createMockCDPSession();
    mockSession = mocks.session;
    mockSend = mocks.mockSend;
    mockOn = mocks.mockOn;
    mockOff = mocks.mockOff;
    mockDetach = mocks.mockDetach;
    client = new PuppeteerCdpClient(mockSession);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('send()', () => {
    it('should send CDP commands to the session', async () => {
      // First call is DOM.enable, second is the actual command
      mockSend
        .mockResolvedValueOnce({}) // DOM.enable
        .mockResolvedValueOnce({ root: { nodeId: 1 } }); // DOM.getDocument

      const result = await client.send('DOM.getDocument', { depth: -1 });

      expect(result).toEqual({ root: { nodeId: 1 } });
      expect(mockSend).toHaveBeenCalledWith('DOM.getDocument', { depth: -1 });
    });

    it('should reject methods without domain prefix', async () => {
      await expect(client.send('getDocument')).rejects.toThrow(
        'Invalid CDP method format: "getDocument". Expected "Domain.method" format.'
      );
    });

    it('should throw when session is closed', async () => {
      await client.close();

      await expect(client.send('DOM.getDocument')).rejects.toThrow('CDP session is closed');
    });

    it('should mark session as inactive on Target closed error', async () => {
      // First call succeeds (DOM.enable), second fails
      mockSend
        .mockResolvedValueOnce({}) // DOM.enable
        .mockRejectedValueOnce(new Error('Target closed'));

      await expect(client.send('DOM.getDocument')).rejects.toThrow('Target closed');
      expect(client.isActive()).toBe(false);
    });

    it('should mark session as inactive on Session closed error', async () => {
      mockSend
        .mockResolvedValueOnce({}) // DOM.enable
        .mockRejectedValueOnce(new Error('Session closed'));

      await expect(client.send('DOM.getDocument')).rejects.toThrow('Session closed');
      expect(client.isActive()).toBe(false);
    });

    it('should mark session as inactive on detached error', async () => {
      mockSend
        .mockResolvedValueOnce({}) // DOM.enable
        .mockRejectedValueOnce(new Error('Session detached'));

      await expect(client.send('DOM.getDocument')).rejects.toThrow('Session detached');
      expect(client.isActive()).toBe(false);
    });

    it('should mark session as inactive on fatal Protocol error', async () => {
      // Only specific Protocol errors that indicate session death should mark inactive
      mockSend
        .mockResolvedValueOnce({}) // DOM.enable
        .mockRejectedValueOnce(new Error('Protocol error: Cannot find context'));

      await expect(client.send('DOM.getDocument')).rejects.toThrow('Cannot find context');
      expect(client.isActive()).toBe(false);
    });

    it('should NOT mark session as inactive on non-fatal Protocol error', async () => {
      // Protocol errors like "Frame not found" are operation failures, not session death
      mockSend
        .mockResolvedValueOnce({}) // DOM.enable
        .mockRejectedValueOnce(
          new Error(
            'Protocol error (Accessibility.getFullAXTree): Frame with the given frameId is not found.'
          )
        );

      await expect(client.send('DOM.getDocument')).rejects.toThrow('Frame with the given frameId');
      expect(client.isActive()).toBe(true); // Session should still be active
    });

    it('should not mark session as inactive on other errors', async () => {
      mockSend
        .mockResolvedValueOnce({}) // DOM.enable
        .mockRejectedValueOnce(new Error('Some other error'));

      await expect(client.send('DOM.getDocument')).rejects.toThrow('Some other error');
      expect(client.isActive()).toBe(true);
    });
  });

  describe('domain auto-enabling', () => {
    it('should auto-enable domain before sending command', async () => {
      mockSend.mockResolvedValue({});

      await client.send('DOM.getDocument');

      // Should have called DOM.enable first
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenNthCalledWith(1, 'DOM.enable');
      expect(mockSend).toHaveBeenNthCalledWith(2, 'DOM.getDocument', undefined);
    });

    it('should not re-enable already enabled domain', async () => {
      mockSend.mockResolvedValue({});

      await client.send('DOM.getDocument');
      await client.send('DOM.querySelector', { nodeId: 1, selector: 'div' });

      // DOM.enable should only be called once
      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(mockSend).toHaveBeenNthCalledWith(1, 'DOM.enable');
    });

    it('should not enable domain for .enable methods', async () => {
      mockSend.mockResolvedValue({});

      await client.send('DOM.enable');

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith('DOM.enable', undefined);
    });

    it('should not enable domain for .disable methods', async () => {
      mockSend.mockResolvedValue({});

      await client.send('DOM.disable');

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith('DOM.disable', undefined);
    });

    it('should not enable domains that do not support enable', async () => {
      mockSend.mockResolvedValue({});

      await client.send('Browser.getVersion');

      // Should not call Browser.enable
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith('Browser.getVersion', undefined);
    });

    it('should handle domain enable failure gracefully', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('Domain not supported'))
        .mockResolvedValueOnce({ root: { nodeId: 1 } });

      const result = await client.send('CustomDomain.getStuff');

      expect(result).toEqual({ root: { nodeId: 1 } });
      // Domain still marked as enabled to avoid repeated attempts
      expect(client.getEnabledDomains().has('CustomDomain')).toBe(true);
    });

    it('should respect custom domainsWithoutEnable option', async () => {
      const customClient = new PuppeteerCdpClient(mockSession, {
        domainsWithoutEnable: ['MyCustomDomain'],
      });
      mockSend.mockResolvedValue({});

      await customClient.send('MyCustomDomain.doSomething');

      // Should not call MyCustomDomain.enable
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith('MyCustomDomain.doSomething', undefined);
    });
  });

  describe('timeout behavior', () => {
    it('should timeout if command takes too long', async () => {
      // Client with very short timeout for testing
      const shortTimeoutClient = new PuppeteerCdpClient(mockSession, { timeout: 50 });

      // Mock send that never resolves - intentionally returns pending promise for timeout testing
      // eslint-disable-next-line @typescript-eslint/no-misused-promises, @typescript-eslint/no-empty-function
      mockSend.mockImplementation(() => new Promise(() => {}));

      // Use a domain that doesn't need enabling to simplify the test
      await expect(shortTimeoutClient.send('Browser.getVersion')).rejects.toThrow(
        'CDP command timed out after 50ms: Browser.getVersion'
      );
    });

    it('should clear timeout on successful response', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      mockSend.mockResolvedValue({});

      // Use domain that doesn't need enabling
      await client.send('Browser.getVersion');

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('event handling', () => {
    it('should register event handlers with on()', () => {
      const handler = vi.fn();

      client.on('DOM.documentUpdated', handler);

      expect(mockOn).toHaveBeenCalledWith('DOM.documentUpdated', handler);
    });

    it('should unregister event handlers with off()', () => {
      const handler = vi.fn();

      client.on('DOM.documentUpdated', handler);
      client.off('DOM.documentUpdated', handler);

      expect(mockOff).toHaveBeenCalledWith('DOM.documentUpdated', handler);
    });

    it('should register one-time handlers with once()', () => {
      const handler = vi.fn();

      client.once('DOM.documentUpdated', handler);

      // Should have registered with on()
      expect(mockOn).toHaveBeenCalledTimes(1);
      expect(mockOn).toHaveBeenCalledWith('DOM.documentUpdated', expect.any(Function));
    });

    it('should auto-unsubscribe once() handlers after first call', () => {
      const handler = vi.fn();

      client.once('DOM.documentUpdated', handler);

      // Get the wrapped handler that was registered
      const wrappedHandler = mockOn.mock.calls[0][1] as (params: Record<string, unknown>) => void;

      // Simulate event firing
      wrappedHandler({ timestamp: 123 });

      // Original handler should have been called
      expect(handler).toHaveBeenCalledWith({ timestamp: 123 });

      // Should have called off() to unregister
      expect(mockOff).toHaveBeenCalledWith('DOM.documentUpdated', wrappedHandler);
    });
  });

  describe('close()', () => {
    it('should detach the session', async () => {
      await client.close();

      expect(mockDetach).toHaveBeenCalled();
    });

    it('should mark session as inactive after close', async () => {
      expect(client.isActive()).toBe(true);

      await client.close();

      expect(client.isActive()).toBe(false);
    });

    it('should clear enabled domains on close', async () => {
      mockSend.mockResolvedValue({});
      await client.send('DOM.getDocument');

      expect(client.getEnabledDomains().has('DOM')).toBe(true);

      await client.close();

      expect(client.getEnabledDomains().size).toBe(0);
    });

    it('should remove all event handlers on close', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      client.on('DOM.documentUpdated', handler1);
      client.on('Page.loadEventFired', handler2);

      await client.close();

      // Should have called off() for each registered handler
      expect(mockOff).toHaveBeenCalledWith('DOM.documentUpdated', handler1);
      expect(mockOff).toHaveBeenCalledWith('Page.loadEventFired', handler2);
    });

    it('should not throw if close is called multiple times', async () => {
      await client.close();
      await expect(client.close()).resolves.toBeUndefined();
    });

    it('should handle detach errors gracefully', async () => {
      mockDetach.mockRejectedValueOnce(new Error('Session already detached'));

      await expect(client.close()).resolves.toBeUndefined();
      expect(client.isActive()).toBe(false);
    });
  });

  describe('isActive()', () => {
    it('should return true initially', () => {
      expect(client.isActive()).toBe(true);
    });

    it('should return false after close', async () => {
      await client.close();

      expect(client.isActive()).toBe(false);
    });

    it('should return false after session disconnect error', async () => {
      mockSend
        .mockResolvedValueOnce({}) // DOM.enable
        .mockRejectedValueOnce(new Error('Target closed'));

      try {
        await client.send('DOM.getDocument');
      } catch {
        // Expected
      }

      expect(client.isActive()).toBe(false);
    });
  });

  describe('getHealth()', () => {
    it('should return active true when session is operational', () => {
      const health = client.getHealth();

      expect(health.active).toBe(true);
      expect(health.lastError).toBeUndefined();
      expect(health.lastErrorTime).toBeUndefined();
    });

    it('should track last error after CDP failure', async () => {
      mockSend
        .mockResolvedValueOnce({}) // DOM.enable
        .mockRejectedValueOnce(new Error('CDP command failed'));

      try {
        await client.send('DOM.getDocument');
      } catch {
        // Expected
      }

      const health = client.getHealth();
      expect(health.lastError).toBe('CDP command failed');
      expect(health.lastErrorTime).toBeInstanceOf(Date);
    });

    it('should return active false after close', async () => {
      await client.close();

      const health = client.getHealth();
      expect(health.active).toBe(false);
    });

    it('should return active false after fatal error', async () => {
      mockSend
        .mockResolvedValueOnce({}) // DOM.enable
        .mockRejectedValueOnce(new Error('Target closed'));

      try {
        await client.send('DOM.getDocument');
      } catch {
        // Expected
      }

      const health = client.getHealth();
      expect(health.active).toBe(false);
      expect(health.lastError).toBe('Target closed');
    });
  });

  describe('getEnabledDomains()', () => {
    it('should return empty set initially', () => {
      expect(client.getEnabledDomains().size).toBe(0);
    });

    it('should track enabled domains', async () => {
      mockSend.mockResolvedValue({});

      await client.send('DOM.getDocument');
      await client.send('Page.getFrameTree');

      const enabled = client.getEnabledDomains();
      expect(enabled.has('DOM')).toBe(true);
      expect(enabled.has('Page')).toBe(true);
    });

    it('should return set that tracks domain state correctly', async () => {
      mockSend.mockResolvedValue({});

      await client.send('DOM.getDocument');
      const enabled = client.getEnabledDomains();

      // The returned set reflects internal state
      expect(enabled.has('DOM')).toBe(true);
      expect(enabled.size).toBe(1);
    });
  });

  describe('expected CDP failures', () => {
    it('should treat DOM.getBoxModel failure for hidden elements as expected', async () => {
      mockSend
        .mockResolvedValueOnce({}) // DOM.enable
        .mockRejectedValueOnce(new Error('Could not compute box model'));

      // Should still throw, but logged at debug level (not error)
      await expect(client.send('DOM.getBoxModel', { nodeId: 123 })).rejects.toThrow(
        'Could not compute box model'
      );

      // Session should still be active (not a fatal error)
      expect(client.isActive()).toBe(true);
    });

    it('should treat CSS.getComputedStyleForNode failure as expected', async () => {
      mockSend
        .mockResolvedValueOnce({}) // CSS.enable
        .mockRejectedValueOnce(new Error('Node not found'));

      await expect(client.send('CSS.getComputedStyleForNode', { nodeId: 123 })).rejects.toThrow(
        'Node not found'
      );

      expect(client.isActive()).toBe(true);
    });

    it('should treat Accessibility.getFullAXTree failure for removed frame as expected', async () => {
      mockSend
        .mockResolvedValueOnce({}) // Accessibility.enable
        .mockRejectedValueOnce(new Error('Frame with the given frameId is not found'));

      await expect(
        client.send('Accessibility.getFullAXTree', { frameId: 'removed-frame' })
      ).rejects.toThrow('Frame with the given frameId is not found');

      // Session should still be active (expected failure for cross-origin/removed frames)
      expect(client.isActive()).toBe(true);
    });
  });
});
