/**
 * Temp File Utility Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs/promises and crypto (hoisted)
vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('crypto', () => ({
  randomBytes: vi.fn().mockReturnValue({ toString: () => 'a1b2c3d4e5f6' }),
}));

import {
  writeTempFile,
  computeBase64ByteSize,
  cleanupTempFiles,
} from '../../../src/lib/temp-file.js';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('writeTempFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write decoded base64 data to a temp file', async () => {
    const base64 = Buffer.from('hello world').toString('base64');
    const filepath = await writeTempFile(base64, 'png');

    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('screenshot-'),
      expect.any(Buffer)
    );
    expect(filepath).toContain('.png');
  });

  it('should generate path in OS temp directory', async () => {
    const filepath = await writeTempFile('dGVzdA==', 'jpg');

    expect(filepath).toBe(join(tmpdir(), 'screenshot-a1b2c3d4e5f6.jpg'));
  });

  it('should use the provided extension', async () => {
    const filepath = await writeTempFile('dGVzdA==', 'jpg');
    expect(filepath).toMatch(/\.jpg$/);
  });
});

describe('computeBase64ByteSize', () => {
  it('should compute correct size for data without padding', () => {
    // "abc" in base64 is "YWJj" (4 chars, no padding, 3 bytes)
    expect(computeBase64ByteSize('YWJj')).toBe(3);
  });

  it('should account for single padding character', () => {
    // "ab" in base64 is "YWI=" (4 chars, 1 padding, 2 bytes)
    expect(computeBase64ByteSize('YWI=')).toBe(2);
  });

  it('should account for double padding characters', () => {
    // "a" in base64 is "YQ==" (4 chars, 2 padding, 1 byte)
    expect(computeBase64ByteSize('YQ==')).toBe(1);
  });

  it('should handle empty string', () => {
    expect(computeBase64ByteSize('')).toBe(0);
  });

  it('should handle large strings correctly', () => {
    // 1000 base64 chars = ~750 bytes (before padding adjustment)
    const size = computeBase64ByteSize('A'.repeat(1000));
    expect(size).toBe(750);
  });
});

describe('cleanupTempFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should delete all tracked temp files', async () => {
    // Create files so they get tracked
    await writeTempFile('dGVzdA==', 'png');
    await writeTempFile('dGVzdA==', 'jpg');

    await cleanupTempFiles();

    expect(unlink).toHaveBeenCalledTimes(2);
  });

  it('should clear tracking set after cleanup', async () => {
    await writeTempFile('dGVzdA==', 'png');
    await cleanupTempFiles();

    vi.mocked(unlink).mockClear();

    // Second cleanup should have nothing to delete
    await cleanupTempFiles();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('should silently ignore already-deleted files (ENOENT)', async () => {
    const enoentError = Object.assign(new Error('ENOENT: no such file or directory'), {
      code: 'ENOENT',
    });
    vi.mocked(unlink).mockRejectedValue(enoentError);

    await writeTempFile('dGVzdA==', 'png');

    // Should not throw and should not warn
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* noop */ });
    await expect(cleanupTempFiles()).resolves.toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('should log warning for non-ENOENT errors (e.g. EACCES)', async () => {
    const eaccesError = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    });
    vi.mocked(unlink).mockRejectedValue(eaccesError);

    await writeTempFile('dGVzdA==', 'png');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* noop */ });
    await expect(cleanupTempFiles()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
    warnSpy.mockRestore();
  });
});
