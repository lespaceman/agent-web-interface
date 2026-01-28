// tests/unit/diagnostics/cdp-event-logger.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CdpEventLogger } from '../../../src/diagnostics/cdp-event-logger.js';
import { MockCdpClient } from '../../mocks/cdp-client.mock.js';

describe('CdpEventLogger', () => {
  let logger: CdpEventLogger;
  let mockCdp: MockCdpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCdp = new MockCdpClient();
    logger = new CdpEventLogger();
  });

  describe('attach()', () => {
    it('should subscribe to Page domain events', () => {
      logger.attach(mockCdp);

      expect(mockCdp.onSpy).toHaveBeenCalledWith(
        'Page.frameNavigated',
        expect.any(Function)
      );
      expect(mockCdp.onSpy).toHaveBeenCalledWith(
        'Page.loadEventFired',
        expect.any(Function)
      );
      expect(mockCdp.onSpy).toHaveBeenCalledWith(
        'Page.domContentEventFired',
        expect.any(Function)
      );
    });

    it('should subscribe to Runtime domain events', () => {
      logger.attach(mockCdp);

      expect(mockCdp.onSpy).toHaveBeenCalledWith(
        'Runtime.executionContextCreated',
        expect.any(Function)
      );
      expect(mockCdp.onSpy).toHaveBeenCalledWith(
        'Runtime.executionContextDestroyed',
        expect.any(Function)
      );
    });
  });

  describe('getEvents()', () => {
    it('should return empty array before any events', () => {
      expect(logger.getEvents()).toEqual([]);
    });

    it('should capture and timestamp events', () => {
      logger.attach(mockCdp);

      // Use the MockCdpClient's emitEvent helper to trigger the event
      mockCdp.emitEvent('Page.loadEventFired', { timestamp: 12345.67 });

      const events = logger.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('Page.loadEventFired');
      expect(events[0].params).toEqual({ timestamp: 12345.67 });
      expect(events[0].localTimestamp).toBeGreaterThan(0);
    });
  });

  describe('clear()', () => {
    it('should remove all captured events', () => {
      logger.attach(mockCdp);

      // Emit an event
      mockCdp.emitEvent('Page.loadEventFired', {});

      expect(logger.getEvents()).toHaveLength(1);

      logger.clear();

      expect(logger.getEvents()).toHaveLength(0);
    });
  });

  describe('detach()', () => {
    it('should unsubscribe from all events', () => {
      logger.attach(mockCdp);
      logger.detach();

      expect(mockCdp.offSpy).toHaveBeenCalledWith(
        'Page.frameNavigated',
        expect.any(Function)
      );
      expect(mockCdp.offSpy).toHaveBeenCalledWith(
        'Page.loadEventFired',
        expect.any(Function)
      );
    });

    it('should handle detach when not attached', () => {
      // Should not throw when detaching without prior attach
      expect(() => logger.detach()).not.toThrow();
    });
  });

  describe('formatForDiagnostics()', () => {
    it('should return message when no events captured', () => {
      expect(logger.formatForDiagnostics()).toBe('No CDP events captured');
    });

    it('should format events as diagnostic string', () => {
      logger.attach(mockCdp);

      mockCdp.emitEvent('Page.loadEventFired', { timestamp: 12345.67 });

      const formatted = logger.formatForDiagnostics();
      expect(formatted).toContain('Page.loadEventFired');
      expect(formatted).toContain('12345.67');
    });
  });

  describe('maxEvents limit', () => {
    it('should trim old events when exceeding capacity', () => {
      logger.attach(mockCdp);

      // Emit 101 events (default max is 100)
      for (let i = 0; i < 101; i++) {
        mockCdp.emitEvent('Page.loadEventFired', { index: i });
      }

      const events = logger.getEvents();
      expect(events).toHaveLength(100);
      // First event should be trimmed, so index starts at 1
      expect(events[0].params).toEqual({ index: 1 });
      expect(events[99].params).toEqual({ index: 100 });
    });
  });
});
