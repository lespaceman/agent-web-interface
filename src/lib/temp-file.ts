/**
 * Temp File Utility
 *
 * Writes binary data to temporary files with unique names.
 * Used when tool results are too large for inline MCP responses.
 */

import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

/** Tracks all temp files created during the session */
const trackedFiles = new Set<string>();

/**
 * Write base64-encoded data to a temporary file.
 *
 * @param base64Data - Base64-encoded file content
 * @param extension - File extension without dot (e.g., 'png', 'jpg')
 * @returns Absolute path to the written file
 */
export async function writeTempFile(base64Data: string, extension: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');
  const filename = `screenshot-${randomBytes(6).toString('hex')}.${extension}`;
  const filepath = join(tmpdir(), filename);

  await writeFile(filepath, buffer);
  trackedFiles.add(filepath);
  return filepath;
}

/**
 * Compute the byte size of base64-encoded data.
 *
 * @param base64 - Base64-encoded string
 * @returns Size in bytes
 */
export function computeBase64ByteSize(base64: string): number {
  let size = Math.floor((base64.length * 3) / 4);
  if (base64.endsWith('==')) size -= 2;
  else if (base64.endsWith('=')) size -= 1;
  return size;
}

/**
 * Clean up all temp files created during this session.
 * Silently ignores files that have already been deleted.
 */
export async function cleanupTempFiles(): Promise<void> {
  const deletions = [...trackedFiles].map((filepath) =>
    unlink(filepath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') {
        console.warn(`[cleanup] Failed to delete temp file ${filepath}: ${err.message}`);
      }
    })
  );
  await Promise.all(deletions);
  trackedFiles.clear();
}
