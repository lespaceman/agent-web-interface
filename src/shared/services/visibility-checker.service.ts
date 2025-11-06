/**
 * Visibility Checker Service
 *
 * Determines if elements are visible in the viewport using multiple strategies
 */

import type { ElementRef, BBox } from '../types/index.js';

interface CdpBridge {
  executeDevToolsMethod<T>(method: string, params?: unknown): Promise<T>;
}

interface BoxModelResult {
  model: {
    content: number[];
    width: number;
    height: number;
  };
}

interface ComputedStyleResult {
  computedStyle: { name: string; value: string }[];
}

export class VisibilityCheckerService {
  constructor(private readonly cdpBridge: CdpBridge) {}

  /**
   * Check if an element is visible
   * Combines multiple checks:
   * 1. Has bounding box (layoutvisibility)
   * 2. CSS visibility/display properties
   * 3. Opacity > 0
   * 4. Not hidden by overflow
   */
  async isVisible(element: ElementRef): Promise<boolean> {
    if (!element.nodeId) {
      return false;
    }

    try {
      // Check 1: Element must have a bounding box
      const bbox = await this.getBoundingBox(element.nodeId);
      if (!bbox || bbox.w === 0 || bbox.h === 0) {
        return false;
      }

      // Check 2: CSS display and visibility properties
      const styles = await this.getComputedStyle(element.nodeId);
      if (!styles) {
        return true; // If we can't get styles, assume visible
      }

      const display = styles.display ?? '';
      const visibility = styles.visibility ?? '';
      const opacity = parseFloat(styles.opacity ?? '1');

      if (display === 'none') {
        return false;
      }

      if (visibility === 'hidden') {
        return false;
      }

      if (opacity === 0) {
        return false;
      }

      // Check 3: Element is in viewport
      const inViewport = await this.isInViewport(bbox);
      if (!inViewport) {
        return false;
      }

      return true;
    } catch {
      // If any check fails, assume not visible
      return false;
    }
  }

  /**
   * Check if an element is in the viewport
   */
  async isInViewport(bbox: BBox): Promise<boolean> {
    try {
      const viewport = await this.getViewportSize();

      // Element must have at least some overlap with viewport
      const visible =
        bbox.x + bbox.w > 0 &&
        bbox.y + bbox.h > 0 &&
        bbox.x < viewport.width &&
        bbox.y < viewport.height;

      return visible;
    } catch {
      return true; // If we can't determine viewport, assume visible
    }
  }

  /**
   * Get the bounding box for an element
   */
  async getBoundingBox(nodeId: number): Promise<BBox | null> {
    try {
      const result = await this.cdpBridge.executeDevToolsMethod<BoxModelResult>('DOM.getBoxModel', {
        nodeId,
      });

      const quad = result.model.content;
      const x = Math.min(quad[0], quad[2], quad[4], quad[6]);
      const y = Math.min(quad[1], quad[3], quad[5], quad[7]);
      const w = result.model.width;
      const h = result.model.height;

      return { x, y, w, h };
    } catch {
      return null;
    }
  }

  /**
   * Get computed style for an element
   */
  async getComputedStyle(nodeId: number): Promise<Record<string, string> | null> {
    try {
      const result = await this.cdpBridge.executeDevToolsMethod<ComputedStyleResult>(
        'CSS.getComputedStyleForNode',
        { nodeId }
      );

      const styles: Record<string, string> = {};
      for (const prop of result.computedStyle) {
        styles[prop.name] = prop.value;
      }

      return styles;
    } catch {
      return null;
    }
  }

  /**
   * Get viewport dimensions
   */
  async getViewportSize(): Promise<{ width: number; height: number }> {
    try {
      const result = await this.cdpBridge.executeDevToolsMethod<{
        result: { value: { width: number; height: number } };
      }>('Runtime.evaluate', {
        expression: '({ width: window.innerWidth, height: window.innerHeight })',
        returnByValue: true,
      });

      return result.result.value;
    } catch {
      return { width: 1920, height: 1080 }; // Default fallback
    }
  }

  /**
   * Check if element is scrolled into view
   */
  async isScrolledIntoView(element: ElementRef): Promise<boolean> {
    if (!element.nodeId) {
      return false;
    }

    try {
      const result = await this.cdpBridge.executeDevToolsMethod<{
        result: { value: boolean };
      }>('Runtime.callFunctionOn', {
        objectId: element.nodeId.toString(),
        functionDeclaration: `
          function() {
            const rect = this.getBoundingClientRect();
            return (
              rect.top >= 0 &&
              rect.left >= 0 &&
              rect.bottom <= window.innerHeight &&
              rect.right <= window.innerWidth
            );
          }
        `,
        returnByValue: true,
      });

      return result.result.value;
    } catch {
      return false;
    }
  }

  /**
   * Check if element is obscured by another element
   */
  async isObscured(element: ElementRef): Promise<boolean> {
    if (!element.bbox) {
      return false;
    }

    try {
      const centerX = element.bbox.x + element.bbox.w / 2;
      const centerY = element.bbox.y + element.bbox.h / 2;

      const result = await this.cdpBridge.executeDevToolsMethod<{
        result: { value: boolean };
      }>('Runtime.evaluate', {
        expression: `
          (function() {
            const el = document.elementFromPoint(${centerX}, ${centerY});
            const target = document.querySelector('[data-node-id="${element.nodeId}"]');
            return el !== target && !target.contains(el);
          })()
        `,
        returnByValue: true,
      });

      return result.result.value;
    } catch {
      return false;
    }
  }

  /**
   * Get visibility ratio (0-1) indicating how much of element is visible
   */
  async getVisibilityRatio(element: ElementRef): Promise<number> {
    if (!element.bbox) {
      return 0;
    }

    try {
      const viewport = await this.getViewportSize();

      // Calculate visible area
      const visibleX = Math.max(
        0,
        Math.min(element.bbox.x + element.bbox.w, viewport.width) - Math.max(element.bbox.x, 0)
      );
      const visibleY = Math.max(
        0,
        Math.min(element.bbox.y + element.bbox.h, viewport.height) - Math.max(element.bbox.y, 0)
      );

      const visibleArea = visibleX * visibleY;
      const totalArea = element.bbox.w * element.bbox.h;

      if (totalArea === 0) {
        return 0;
      }

      return visibleArea / totalArea;
    } catch {
      return 0;
    }
  }
}
