/**
 * Screenshot Capture Service Tests
 */
/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CdpClient } from '../../../src/cdp/cdp-client.interface.js';

// Mock temp-file module (hoisted before imports)
vi.mock('../../../src/lib/temp-file.js', () => ({
  writeTempFile: vi.fn().mockResolvedValue('/tmp/screenshot-abc123.png'),
  computeBase64ByteSize: vi.fn((b64: string) => Math.floor((b64.length * 3) / 4)),
}));

import {
  captureScreenshot,
  getElementBoundingBox,
} from '../../../src/screenshot/screenshot-capture.js';
import { writeTempFile, computeBase64ByteSize } from '../../../src/lib/temp-file.js';

function createMockCdp(): CdpClient {
  return {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    isActive: vi.fn().mockReturnValue(true),
  };
}

describe('captureScreenshot', () => {
  let cdp: CdpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    cdp = createMockCdp();
  });

  it('should return inline ImageResult for small screenshots', async () => {
    const smallBase64 = 'iVBORw0KGgoAAAANSUhEUg==';
    vi.mocked(cdp.send).mockResolvedValue({ data: smallBase64 });
    vi.mocked(computeBase64ByteSize).mockReturnValue(1024); // 1KB

    const result = await captureScreenshot(cdp);

    expect(result.type).toBe('image');
    expect(result).toHaveProperty('data', smallBase64);
    expect(result.mimeType).toBe('image/png');
    expect(result.sizeBytes).toBe(1024);
  });

  it('should return FileResult for large screenshots (>=2MB)', async () => {
    const largeBase64 = 'A'.repeat(3_000_000);
    vi.mocked(cdp.send).mockResolvedValue({ data: largeBase64 });
    vi.mocked(computeBase64ByteSize).mockReturnValue(2.5 * 1024 * 1024); // 2.5MB

    const result = await captureScreenshot(cdp);

    expect(result.type).toBe('file');
    expect(result).toHaveProperty('path');
    expect(result.mimeType).toBe('image/png');
    expect(writeTempFile).toHaveBeenCalledWith(largeBase64, 'png');
  });

  it('should use PNG format by default with optimizeForSpeed', async () => {
    vi.mocked(cdp.send).mockResolvedValue({ data: 'abc' });
    vi.mocked(computeBase64ByteSize).mockReturnValue(3);

    await captureScreenshot(cdp);

    expect(cdp.send).toHaveBeenCalledWith('Page.captureScreenshot', {
      format: 'png',
      quality: undefined,
      optimizeForSpeed: true,
    });
  });

  it('should pass JPEG quality parameter', async () => {
    vi.mocked(cdp.send).mockResolvedValue({ data: 'abc' });
    vi.mocked(computeBase64ByteSize).mockReturnValue(3);

    await captureScreenshot(cdp, { format: 'jpeg', quality: 75 });

    expect(cdp.send).toHaveBeenCalledWith('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 75,
      optimizeForSpeed: true,
    });
  });

  it('should default JPEG quality to 80 when not specified', async () => {
    vi.mocked(cdp.send).mockResolvedValue({ data: 'abc' });
    vi.mocked(computeBase64ByteSize).mockReturnValue(3);

    await captureScreenshot(cdp, { format: 'jpeg' });

    expect(cdp.send).toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.objectContaining({ quality: 80 })
    );
  });

  it('should use correct mimeType for JPEG', async () => {
    vi.mocked(cdp.send).mockResolvedValue({ data: 'abc' });
    vi.mocked(computeBase64ByteSize).mockReturnValue(3);

    const result = await captureScreenshot(cdp, { format: 'jpeg' });

    expect(result.mimeType).toBe('image/jpeg');
  });

  it('should save JPEG files with .jpg extension', async () => {
    const largeBase64 = 'A'.repeat(3_000_000);
    vi.mocked(cdp.send).mockResolvedValue({ data: largeBase64 });
    vi.mocked(computeBase64ByteSize).mockReturnValue(3 * 1024 * 1024);

    await captureScreenshot(cdp, { format: 'jpeg' });

    expect(writeTempFile).toHaveBeenCalledWith(largeBase64, 'jpg');
  });

  it('should include clip parameter for element screenshots', async () => {
    vi.mocked(cdp.send).mockResolvedValue({ data: 'abc' });
    vi.mocked(computeBase64ByteSize).mockReturnValue(3);

    const clip = { x: 10, y: 20, width: 100, height: 50, scale: 1 };
    await captureScreenshot(cdp, { clip });

    expect(cdp.send).toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.objectContaining({ clip })
    );
  });

  it('should call Page.getLayoutMetrics and set clip for full page screenshots', async () => {
    vi.mocked(cdp.send)
      .mockResolvedValueOnce({
        cssContentSize: { width: 1280, height: 5000 },
        cssLayoutViewport: { clientWidth: 1280, clientHeight: 720 },
        cssVisualViewport: { clientWidth: 1280, clientHeight: 720 },
      })
      .mockResolvedValueOnce({ data: 'abc' });
    vi.mocked(computeBase64ByteSize).mockReturnValue(3);

    await captureScreenshot(cdp, { captureBeyondViewport: true });

    expect(cdp.send).toHaveBeenCalledWith('Page.getLayoutMetrics', undefined);
    expect(cdp.send).toHaveBeenCalledWith('Page.captureScreenshot', expect.objectContaining({
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 1280, height: 5000, scale: 1 },
    }));
  });

  it('should not call Page.getLayoutMetrics for viewport screenshots', async () => {
    vi.mocked(cdp.send).mockResolvedValue({ data: 'abc' });
    vi.mocked(computeBase64ByteSize).mockReturnValue(3);

    await captureScreenshot(cdp);

    expect(cdp.send).not.toHaveBeenCalledWith('Page.getLayoutMetrics', undefined);
    expect(cdp.send).toHaveBeenCalledTimes(1);
    expect(cdp.send).toHaveBeenCalledWith('Page.captureScreenshot', {
      format: 'png',
      quality: undefined,
      optimizeForSpeed: true,
    });
  });

  it('should respect optimizeForSpeed=false', async () => {
    vi.mocked(cdp.send).mockResolvedValue({ data: 'abc' });
    vi.mocked(computeBase64ByteSize).mockReturnValue(3);

    await captureScreenshot(cdp, { optimizeForSpeed: false });

    expect(cdp.send).toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.objectContaining({ optimizeForSpeed: false })
    );
  });
});

describe('getElementBoundingBox', () => {
  let cdp: CdpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    cdp = createMockCdp();
  });

  it('should return correct bounding box from box model content quad', async () => {
    // Content quad: top-left(10,20), top-right(110,20), bottom-right(110,70), bottom-left(10,70)
    vi.mocked(cdp.send).mockResolvedValue({
      model: {
        content: [10, 20, 110, 20, 110, 70, 10, 70],
      },
    });

    const bbox = await getElementBoundingBox(cdp, 123);

    expect(bbox).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      scale: 1,
    });
  });

  it('should round fractional coordinates', async () => {
    vi.mocked(cdp.send).mockResolvedValue({
      model: {
        content: [10.4, 20.7, 110.6, 20.7, 110.6, 70.3, 10.4, 70.3],
      },
    });

    const bbox = await getElementBoundingBox(cdp, 456);

    expect(bbox.x).toBe(10);
    expect(bbox.y).toBe(21);
    expect(bbox.width).toBe(100);
    expect(bbox.height).toBe(50);
  });

  it('should compute axis-aligned bounding box for rotated elements', async () => {
    // Diamond shape (rotated square): corners not axis-aligned
    // Top(50,0), Right(100,50), Bottom(50,100), Left(0,50)
    vi.mocked(cdp.send).mockResolvedValue({
      model: {
        content: [50, 0, 100, 50, 50, 100, 0, 50],
      },
    });

    const bbox = await getElementBoundingBox(cdp, 999);

    expect(bbox).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      scale: 1,
    });
  });

  it('should throw when element has no box model', async () => {
    vi.mocked(cdp.send).mockResolvedValue({ model: null });

    await expect(getElementBoundingBox(cdp, 789)).rejects.toThrow('has no box model');
  });

  it('should call DOM.getBoxModel with backendNodeId', async () => {
    vi.mocked(cdp.send).mockResolvedValue({
      model: { content: [0, 0, 100, 0, 100, 50, 0, 50] },
    });

    await getElementBoundingBox(cdp, 42);

    expect(cdp.send).toHaveBeenCalledWith('DOM.getBoxModel', { backendNodeId: 42 });
  });
});
