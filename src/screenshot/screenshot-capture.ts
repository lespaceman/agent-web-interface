/**
 * Screenshot Capture Service
 *
 * Captures browser screenshots via CDP with support for:
 * - Viewport screenshots (default)
 * - Full page screenshots (beyond viewport)
 * - Element screenshots (clipped to bounding box)
 * - PNG and JPEG formats with quality control
 * - Size-based inline vs file storage (2MB threshold)
 *
 * Uses `optimizeForSpeed: true` for faster encoding (matches chrome-devtools-mcp).
 */

import type { CdpClient } from '../cdp/cdp-client.interface.js';
import type { Protocol } from 'devtools-protocol';
import { writeTempFile, computeBase64ByteSize } from '../lib/temp-file.js';
import type { ImageResult, FileResult } from '../tools/tool-result.types.js';

/** Screenshots under this size are returned inline as base64 */
const INLINE_SIZE_THRESHOLD_BYTES = 2 * 1024 * 1024; // 2MB

export interface ScreenshotOptions {
  /** Image format (default: 'png') */
  format?: 'png' | 'jpeg';
  /** JPEG quality 0-100 (ignored for PNG) */
  quality?: number;
  /** Use faster encoding at cost of larger file size (default: true) */
  optimizeForSpeed?: boolean;
  /** Clip to specific viewport region (for element screenshots) */
  clip?: Protocol.Page.Viewport;
  /** Capture full page beyond visible viewport (default: false) */
  captureBeyondViewport?: boolean;
}

/**
 * Capture a screenshot via CDP `Page.captureScreenshot`.
 *
 * Returns an `ImageResult` (inline base64) if under 2MB,
 * or a `FileResult` (temp file path) if 2MB or larger.
 *
 * @param cdp - CDP client for the target page
 * @param options - Screenshot configuration
 * @returns Image result for inline delivery, or file result for large screenshots
 */
export async function captureScreenshot(
  cdp: CdpClient,
  options: ScreenshotOptions = {}
): Promise<ImageResult | FileResult> {
  const format = options.format ?? 'png';
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';

  const params: Protocol.Page.CaptureScreenshotRequest = {
    format,
    quality: format === 'jpeg' ? (options.quality ?? 80) : undefined,
    optimizeForSpeed: options.optimizeForSpeed ?? true,
  };

  if (options.captureBeyondViewport) {
    const metrics = await cdp.send('Page.getLayoutMetrics', undefined);
    params.clip = {
      x: 0,
      y: 0,
      width: metrics.cssContentSize.width,
      height: metrics.cssContentSize.height,
      scale: 1,
    };
    params.captureBeyondViewport = true;
  } else if (options.clip) {
    params.clip = options.clip;
  }

  const response = await cdp.send('Page.captureScreenshot', params);
  const base64Data = response.data;
  const sizeBytes = computeBase64ByteSize(base64Data);

  if (sizeBytes < INLINE_SIZE_THRESHOLD_BYTES) {
    return {
      type: 'image',
      data: base64Data,
      mimeType,
      sizeBytes,
    };
  }

  const extension = format === 'jpeg' ? 'jpg' : 'png';
  const path = await writeTempFile(base64Data, extension);

  return {
    type: 'file',
    path,
    mimeType,
    sizeBytes,
  };
}

/**
 * Get the bounding box of an element for clipped screenshots.
 *
 * Uses CDP `DOM.getBoxModel` to retrieve the content box coordinates.
 *
 * @param cdp - CDP client
 * @param backendNodeId - CDP backend node ID of the target element
 * @returns Viewport clip region suitable for `Page.captureScreenshot`
 * @throws Error if element has no box model (e.g., `display: none`)
 */
export async function getElementBoundingBox(
  cdp: CdpClient,
  backendNodeId: number
): Promise<Protocol.Page.Viewport> {
  const response = await cdp.send('DOM.getBoxModel', { backendNodeId });

  if (!response.model) {
    throw new Error(`Element (backendNodeId=${backendNodeId}) has no box model — it may be hidden`);
  }

  // Content quad: [x1,y1, x2,y2, x3,y3, x4,y4]
  // For axis-aligned elements: Top-left, Top-right, Bottom-right, Bottom-left
  // For transformed elements (CSS rotate, etc.): corners may not be axis-aligned,
  // so we compute the axis-aligned bounding box from all 4 corner points.
  const q = response.model.content;
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.round(Math.max(...xs) - minX),
    height: Math.round(Math.max(...ys) - minY),
    scale: 1,
  };
}
