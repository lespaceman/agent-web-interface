/**
 * Session Routing Tests
 *
 * Tests that SessionStore correctly resolves sessions:
 * - Returns the only session when session_id is omitted (single session)
 * - Returns the correct session by explicit ID
 * - Throws when multiple sessions exist and no ID provided
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionStore } from '../../../src/server/session-store.js';

describe('SessionStore session routing', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore({ ttlMs: 0 }); // No expiry for tests
  });

  describe('getDefaultSession()', () => {
    it('should return undefined when no sessions exist', () => {
      expect(store.getDefaultSession()).toBeUndefined();
    });

    it('should return the only session when session_id is omitted', () => {
      const sessionId = store.createSession('tenant-1');

      const session = store.getDefaultSession();

      expect(session).toBeDefined();
      expect(session!.session_id).toBe(sessionId);
      expect(session!.tenant_id).toBe('tenant-1');
    });

    it('should throw when multiple sessions exist and no ID provided', () => {
      store.createSession('tenant-1');
      store.createSession('tenant-2');

      expect(() => store.getDefaultSession()).toThrow(
        /Multiple sessions active.*Provide an explicit session_id/
      );
    });
  });

  describe('getSession(id)', () => {
    it('should return the correct session by explicit ID', () => {
      const id1 = store.createSession('tenant-1');
      const id2 = store.createSession('tenant-2');

      const session1 = store.getSession(id1);
      const session2 = store.getSession(id2);

      expect(session1).toBeDefined();
      expect(session1!.session_id).toBe(id1);
      expect(session1!.tenant_id).toBe('tenant-1');

      expect(session2).toBeDefined();
      expect(session2!.session_id).toBe(id2);
      expect(session2!.tenant_id).toBe('tenant-2');
    });

    it('should return undefined for a non-existent session ID', () => {
      store.createSession('tenant-1');

      expect(store.getSession('session-nonexistent')).toBeUndefined();
    });
  });

  describe('session_id in tool schema routing', () => {
    it('should resolve session when only one exists (no explicit ID needed)', () => {
      const sessionId = store.createSession('tenant-1');
      store.addPage(sessionId, 'page-1');

      // Simulate tool routing: no session_id provided, use default
      const session = store.getDefaultSession();
      expect(session).toBeDefined();

      const pages = store.getPages(session!.session_id);
      expect(pages).toContain('page-1');
    });

    it('should resolve correct session by explicit ID when multiple exist', () => {
      const id1 = store.createSession('tenant-1');
      const id2 = store.createSession('tenant-2');
      store.addPage(id1, 'page-1');
      store.addPage(id2, 'page-2');

      // Simulate tool routing: explicit session_id provided
      const session = store.getSession(id2);
      expect(session).toBeDefined();

      const pages = store.getPages(session!.session_id);
      expect(pages).toContain('page-2');
      expect(pages).not.toContain('page-1');
    });
  });
});
