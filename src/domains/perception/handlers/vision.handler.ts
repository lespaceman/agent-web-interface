/**
 * Vision Handler
 *
 * Handles vision_ocr and vision_find_by_text tools
 */

import type {
  VisionOcrParams,
  VisionOcrResponse,
  VisionFindByTextParams,
  VisionFindByTextResponse,
} from '../perception.types.js';
import type { BBox, ElementRef } from '../../../shared/types/index.js';

interface CdpBridge {
  captureScreenshot(region?: BBox): Promise<string>;
  executeDevToolsMethod<T>(method: string, params?: unknown): Promise<T>;
}

export class VisionHandler {
  constructor(private readonly cdpBridge: CdpBridge) {}

  /**
   * Perform OCR on a screenshot
   *
   * Note: This is a placeholder implementation. In production, you would:
   * 1. Use Tesseract.js for local OCR
   * 2. Use a cloud OCR service (Google Vision, AWS Textract, etc.)
   * 3. Use the browser's built-in text detection APIs
   */
  async ocr(params: VisionOcrParams): Promise<VisionOcrResponse> {
    // Take screenshot
    const screenshot = await this.cdpBridge.captureScreenshot(params.region);

    // Perform OCR (placeholder - would use Tesseract.js or cloud service)
    const ocrResult = await this.performOCR(screenshot, params.region);

    return ocrResult;
  }

  /**
   * Find an element by visible text using OCR
   */
  async findByText(params: VisionFindByTextParams): Promise<VisionFindByTextResponse> {
    // Run OCR on the specified area
    const ocrResult = await this.ocr({ region: params.areaHint });

    // Find matching text span
    const matchingSpan = this.findTextSpan(ocrResult, params.text, params.fuzzy ?? false);

    if (!matchingSpan) {
      return { element: null };
    }

    // Try to map bbox back to a DOM element
    const element = await this.mapBBoxToElement(matchingSpan.bbox);

    return { element };
  }

  /**
   * Perform OCR on a screenshot
   * PLACEHOLDER: In production, integrate Tesseract.js or cloud OCR service
   */
  private performOCR(_screenshot: string, region?: BBox): Promise<VisionOcrResponse> {
    // This is a placeholder implementation
    // In production, you would:
    // 1. Decode base64 screenshot
    // 2. Run through Tesseract.js or cloud OCR
    // 3. Parse results into spans with bboxes

    return Promise.resolve({
      text: '[OCR not implemented - placeholder]',
      spans: [
        {
          text: '[OCR not implemented - placeholder]',
          bbox: region ?? { x: 0, y: 0, w: 100, h: 20 },
          confidence: 0,
        },
      ],
    });
  }

  /**
   * Find a text span matching the query
   */
  private findTextSpan(
    ocrResult: VisionOcrResponse,
    text: string,
    fuzzy: boolean
  ): { text: string; bbox: BBox; confidence?: number } | null {
    const searchText = fuzzy ? text.toLowerCase() : text;

    for (const span of ocrResult.spans) {
      const spanText = fuzzy ? span.text.toLowerCase() : span.text;

      if (fuzzy) {
        // Fuzzy match: check if text is contained
        if (spanText.includes(searchText)) {
          return span;
        }
      } else {
        // Exact match
        if (spanText === searchText) {
          return span;
        }
      }
    }

    return null;
  }

  /**
   * Map a bounding box to a DOM element
   */
  private async mapBBoxToElement(bbox: BBox): Promise<ElementRef | null> {
    try {
      // Find element at center of bbox
      const centerX = bbox.x + bbox.w / 2;
      const centerY = bbox.y + bbox.h / 2;

      const result = await this.cdpBridge.executeDevToolsMethod<{
        result: { objectId?: string };
      }>('Runtime.evaluate', {
        expression: `document.elementFromPoint(${centerX}, ${centerY})`,
        returnByValue: false,
      });

      if (!result.result.objectId) {
        return null;
      }

      // Get node info
      const nodeInfo = await this.cdpBridge.executeDevToolsMethod<{
        node: { nodeId: number; localName: string; attributes?: string[] };
      }>('DOM.describeNode', {
        objectId: result.result.objectId,
      });

      // Build ElementRef
      return {
        frameId: 'main',
        nodeId: nodeInfo.node.nodeId,
        selectors: {},
        bbox,
      };
    } catch {
      return null;
    }
  }
}
