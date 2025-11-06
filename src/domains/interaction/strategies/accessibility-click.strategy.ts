/**
 * Accessibility Click Strategy
 *
 * Clicks elements using accessibility selectors (aria-label, role, etc.)
 */

import type { ClickStrategy } from './click-strategy.interface.js';
import type { ElementRef } from '../../../shared/types/index.js';

interface CdpBridge {
  executeDevToolsMethod<T>(method: string, params?: unknown): Promise<T>;
}

export class AccessibilityClickStrategy implements ClickStrategy {
  constructor(private readonly cdpBridge: CdpBridge) {}

  /**
   * Check if this strategy can handle the target
   */
  canHandle(target: ElementRef): boolean {
    return Boolean(target.selectors.ax ?? target.label ?? target.role);
  }

  /**
   * Click using accessibility attributes
   */
  async click(target: ElementRef): Promise<void> {
    if (!this.canHandle(target)) {
      throw new Error('AccessibilityClickStrategy cannot handle this target');
    }

    // Build a selector based on available accessibility attributes
    const conditions: string[] = [];

    if (target.selectors.ax) {
      // Parse accessibility selector (e.g., "role=button[label="Submit"]")
      conditions.push(`node.getAttribute('aria-label') === ${JSON.stringify(target.selectors.ax)}`);
    } else {
      if (target.role) {
        conditions.push(`node.getAttribute('role') === ${JSON.stringify(target.role)}`);
      }
      if (target.label) {
        conditions.push(`node.getAttribute('aria-label') === ${JSON.stringify(target.label)}`);
      }
      if (target.name) {
        conditions.push(`node.getAttribute('name') === ${JSON.stringify(target.name)}`);
      }
    }

    const expression = `
      (function() {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_ELEMENT
        );

        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node && node.getAttribute && (${conditions.join(' && ')})) {
            if (typeof node.click === 'function') {
              node.click();
              return true;
            }
          }
        }
        return false;
      })()
    `;

    const result = await this.cdpBridge.executeDevToolsMethod<{
      result: { value?: boolean };
    }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });

    if (!result.result.value) {
      throw new Error('Failed to click element via accessibility attributes');
    }
  }
}
