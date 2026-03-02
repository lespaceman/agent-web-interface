/**
 * SessionStore Tests
 *
 * TDD tests for SessionStore implementation.
 * Tracks active sessions per MCP client (tenant isolation).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionStore } from '../../../src/server/session-store.js';
import { expectSessionId, expectRecentDate } from '../../helpers/test-utils.js';

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore();
  });

  describe('createSession', () => {
    it('should generate unique session_id', () => {
      const session_id = store.createSession('tenant-1');

      expectSessionId(session_id);
    });

    it('should generate different session_ids for each call', () => {
      const id1 = store.createSession('tenant-1');
      const id2 = store.createSession('tenant-1');

      expect(id1).not.toBe(id2);
    });

    it('should track tenant_id', () => {
      const session_id = store.createSession('tenant-abc');
      const session = store.getSession(session_id);

      expect(session).toBeDefined();
      expect(session?.tenant_id).toBe('tenant-abc');
    });

    it('should set created_at to current time', () => {
      const session_id = store.createSession('tenant-1');
      const session = store.getSession(session_id);

      expect(session).toBeDefined();
      expectRecentDate(session!.created_at);
    });

    it('should initialize with empty page_ids', () => {
      const session_id = store.createSession('tenant-1');
      const pages = store.getPages(session_id);

      expect(pages).toEqual([]);
    });
  });

  describe('getSession', () => {
    it('should return session by id', () => {
      const session_id = store.createSession('tenant-1');

      const session = store.getSession(session_id);

      expect(session).toBeDefined();
      expect(session?.session_id).toBe(session_id);
    });

    it('should return undefined for unknown id', () => {
      const session = store.getSession('session-unknown');

      expect(session).toBeUndefined();
    });
  });

  describe('addPage', () => {
    it('should associate page with session', () => {
      const session_id = store.createSession('tenant-1');

      store.addPage(session_id, 'page-1');

      const pages = store.getPages(session_id);
      expect(pages).toContain('page-1');
    });

    it('should allow multiple pages per session', () => {
      const session_id = store.createSession('tenant-1');

      store.addPage(session_id, 'page-1');
      store.addPage(session_id, 'page-2');
      store.addPage(session_id, 'page-3');

      const pages = store.getPages(session_id);
      expect(pages).toHaveLength(3);
      expect(pages).toContain('page-1');
      expect(pages).toContain('page-2');
      expect(pages).toContain('page-3');
    });

    it('should not duplicate page_ids', () => {
      const session_id = store.createSession('tenant-1');

      store.addPage(session_id, 'page-1');
      store.addPage(session_id, 'page-1'); // Duplicate

      const pages = store.getPages(session_id);
      expect(pages).toHaveLength(1);
    });

    it('should do nothing for unknown session_id', () => {
      // Should not throw
      store.addPage('session-unknown', 'page-1');
    });
  });

  describe('removePage', () => {
    it('should remove page from session', () => {
      const session_id = store.createSession('tenant-1');
      store.addPage(session_id, 'page-1');
      store.addPage(session_id, 'page-2');

      store.removePage(session_id, 'page-1');

      const pages = store.getPages(session_id);
      expect(pages).not.toContain('page-1');
      expect(pages).toContain('page-2');
    });

    it('should do nothing if page not in session', () => {
      const session_id = store.createSession('tenant-1');
      store.addPage(session_id, 'page-1');

      // Should not throw
      store.removePage(session_id, 'page-unknown');

      const pages = store.getPages(session_id);
      expect(pages).toContain('page-1');
    });

    it('should do nothing for unknown session_id', () => {
      // Should not throw
      store.removePage('session-unknown', 'page-1');
    });
  });

  describe('getPages', () => {
    it('should list pages for session', () => {
      const session_id = store.createSession('tenant-1');
      store.addPage(session_id, 'page-1');
      store.addPage(session_id, 'page-2');

      const pages = store.getPages(session_id);

      expect(pages).toEqual(['page-1', 'page-2']);
    });

    it('should return empty array for session with no pages', () => {
      const session_id = store.createSession('tenant-1');

      const pages = store.getPages(session_id);

      expect(pages).toEqual([]);
    });

    it('should return empty array for unknown session_id', () => {
      const pages = store.getPages('session-unknown');

      expect(pages).toEqual([]);
    });
  });

  describe('destroySession', () => {
    it('should remove session completely', async () => {
      const session_id = store.createSession('tenant-1');
      store.addPage(session_id, 'page-1');

      await store.destroySession(session_id);

      expect(store.getSession(session_id)).toBeUndefined();
      expect(store.getPages(session_id)).toEqual([]);
    });

    it('should do nothing for unknown session_id', async () => {
      // Should not throw
      await store.destroySession('session-unknown');
    });
  });

  describe('listSessions', () => {
    it('should return empty array when no sessions', () => {
      const sessions = store.listSessions();

      expect(sessions).toEqual([]);
    });

    it('should return all active sessions', () => {
      const id1 = store.createSession('tenant-1');
      const id2 = store.createSession('tenant-2');

      const sessions = store.listSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.session_id)).toContain(id1);
      expect(sessions.map((s) => s.session_id)).toContain(id2);
    });

    it('should not include destroyed sessions', async () => {
      const id1 = store.createSession('tenant-1');
      const id2 = store.createSession('tenant-2');

      await store.destroySession(id1);

      const sessions = store.listSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].session_id).toBe(id2);
    });
  });

  describe('getSessionsByTenant', () => {
    it('should return sessions for a specific tenant', () => {
      store.createSession('tenant-1');
      store.createSession('tenant-1');
      store.createSession('tenant-2');

      const sessions = store.getSessionsByTenant('tenant-1');

      expect(sessions).toHaveLength(2);
      sessions.forEach((s) => {
        expect(s.tenant_id).toBe('tenant-1');
      });
    });

    it('should return empty array for unknown tenant', () => {
      store.createSession('tenant-1');

      const sessions = store.getSessionsByTenant('tenant-unknown');

      expect(sessions).toEqual([]);
    });
  });

  describe('sessionCount', () => {
    it('should return zero when empty', () => {
      expect(store.sessionCount()).toBe(0);
    });

    it('should return correct count', () => {
      store.createSession('tenant-1');
      store.createSession('tenant-2');

      expect(store.sessionCount()).toBe(2);
    });
  });

  describe('createSession with clientInfo', () => {
    it('should store clientInfo when provided', () => {
      const clientInfo = { name: 'claude-code', version: '1.0' };
      const session_id = store.createSession('tenant-1', clientInfo);
      const session = store.getSession(session_id);

      expect(session?.client_info).toEqual(clientInfo);
    });

    it('should leave clientInfo undefined when not provided', () => {
      const session_id = store.createSession('tenant-1');
      const session = store.getSession(session_id);

      expect(session?.client_info).toBeUndefined();
    });
  });

  describe('getDefaultSession', () => {
    it('should return undefined when no sessions exist', () => {
      expect(store.getDefaultSession()).toBeUndefined();
    });

    it('should return the only session when one exists', () => {
      const session_id = store.createSession('tenant-1');
      const session = store.getDefaultSession();

      expect(session?.session_id).toBe(session_id);
    });

    it('should throw when multiple sessions exist', () => {
      store.createSession('tenant-1');
      store.createSession('tenant-2');

      expect(() => store.getDefaultSession()).toThrow(/multiple sessions/i);
    });
  });
});
