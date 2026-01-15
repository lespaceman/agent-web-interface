/**
 * Browser-side script for DOM observation.
 *
 * This script is injected into the browser context and runs continuously to capture
 * significant DOM mutations. It uses universal web standards for significance detection -
 * NO hardcoded text/class patterns.
 *
 * The script is returned as a string for page.evaluate().
 */

export const OBSERVATION_OBSERVER_SCRIPT = `
(function() {
  // Prevent double-injection
  if (window.__observationAccumulator) return;

  const MAX_ENTRIES = 500;
  const MAX_TEXT_LENGTH = 200;
  // IMPORTANT: Must match SIGNIFICANCE_THRESHOLD in observation.types.ts
  const SIGNIFICANCE_THRESHOLD = 3;

  // Significance weights (must match server-side observation.types.ts)
  const WEIGHTS = {
    hasAlertRole: 3,
    hasAriaLive: 3,
    isDialog: 3,
    isFixedOrSticky: 2,
    hasHighZIndex: 1,
    coversSignificantViewport: 2,
    isBodyDirectChild: 1,
    containsInteractiveElements: 1,
    // Temporal signals computed later
  };

  /**
   * Compute significance signals from element - NO TEXT/CLASS PATTERN MATCHING.
   * Uses only universal web standards (ARIA, CSS positioning, DOM structure).
   */
  function computeSignals(el) {
    const role = el.getAttribute('role');
    const ariaLive = el.getAttribute('aria-live');
    const ariaModal = el.getAttribute('aria-modal');
    const tagName = el.tagName.toLowerCase();

    // Get computed style (may fail for detached elements)
    let style = null;
    let rect = null;
    try {
      style = getComputedStyle(el);
      rect = el.getBoundingClientRect();
    } catch (e) {
      // Element may be detached
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    return {
      // Semantic signals
      hasAlertRole: ['alert', 'status', 'log', 'alertdialog'].includes(role),
      hasAriaLive: ariaLive === 'polite' || ariaLive === 'assertive',
      isDialog: role === 'dialog' || tagName === 'dialog' || ariaModal === 'true',

      // Visual signals
      isFixedOrSticky: style && (style.position === 'fixed' || style.position === 'sticky'),
      // Note: parseInt returns NaN for non-numeric values like "auto", which correctly fails the > 1000 check
      hasHighZIndex: style && parseInt(style.zIndex, 10) > 1000,
      coversSignificantViewport: rect && ((rect.width > vw * 0.5) || (rect.height > vh * 0.3)),

      // Structural signals
      isBodyDirectChild: el.parentElement === document.body,
      containsInteractiveElements: el.querySelector('button, a, input, select, textarea') !== null,

      // Temporal signals (set by accumulator later)
      appearedAfterDelay: false,
      wasShortLived: false,
    };
  }

  function computeSignificance(signals) {
    let score = 0;
    for (const [key, weight] of Object.entries(WEIGHTS)) {
      if (signals[key]) score += weight;
    }
    return score;
  }

  function captureEntry(node, type) {
    if (node.nodeType !== 1) return null; // Element nodes only

    const el = node;
    const signals = computeSignals(el);
    const significance = computeSignificance(signals);

    // Only capture if meets threshold
    if (significance < SIGNIFICANCE_THRESHOLD) return null;

    // Capture content
    const text = (el.textContent || '').trim().substring(0, MAX_TEXT_LENGTH);
    const hasInteractives = signals.containsInteractiveElements;

    // Get viewport coverage for later analysis
    let viewportCoverage = { widthPct: 0, heightPct: 0 };
    try {
      const rect = el.getBoundingClientRect();
      viewportCoverage = {
        widthPct: Math.round((rect.width / window.innerWidth) * 100),
        heightPct: Math.round((rect.height / window.innerHeight) * 100),
      };
    } catch (e) {
      // Element may be detached
    }

    // Get z-index
    let zIndex = 0;
    try {
      zIndex = parseInt(getComputedStyle(el).zIndex, 10) || 0;
    } catch (e) {
      // Element may be detached
    }

    return {
      type: type,
      timestamp: Date.now(),
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,

      // Semantic attributes
      role: el.getAttribute('role') || undefined,
      ariaLive: el.getAttribute('aria-live') || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      ariaModal: el.getAttribute('aria-modal') || undefined,

      // Content
      text: text,
      hasInteractives: hasInteractives,

      // Visual signals
      isFixedOrSticky: signals.isFixedOrSticky,
      zIndex: zIndex,
      viewportCoverage: viewportCoverage,

      // Structural
      isBodyDirectChild: signals.isBodyDirectChild,

      // Significance
      significance: significance,
    };
  }

  const log = [];
  const pageLoadTime = Date.now();

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      // Capture added nodes
      for (const node of m.addedNodes) {
        const entry = captureEntry(node, 'added');
        if (entry) {
          // Set temporal signal: appeared after initial load?
          entry.appearedAfterDelay = (entry.timestamp - pageLoadTime) > 100;
          log.push(entry);
        }

        // Check significant children (dialogs inside containers, etc.)
        if (node.nodeType === 1) {
          const significantChildren = node.querySelectorAll(
            '[role="alert"], [role="status"], [role="dialog"], [aria-live], [aria-modal], dialog'
          );
          for (const child of significantChildren) {
            const childEntry = captureEntry(child, 'added');
            if (childEntry) {
              childEntry.appearedAfterDelay = (childEntry.timestamp - pageLoadTime) > 100;
              log.push(childEntry);
            }
          }
        }
      }

      // Capture removed nodes (to calculate duration)
      for (const node of m.removedNodes) {
        const entry = captureEntry(node, 'removed');
        if (entry) {
          log.push(entry);
        }
      }
    }

    // Trim if over limit (FIFO) - use splice for O(1) batch removal instead of shift() loop
    if (log.length > MAX_ENTRIES) {
      const excess = log.length - MAX_ENTRIES;
      log.splice(0, excess);
    }
  });

  // Start observing
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  window.__observationAccumulator = {
    log: log,
    observer: observer,
    observedBody: document.body, // Track which body we're observing for staleness detection
    pageLoadTime: pageLoadTime,
    lastReportedIndex: 0, // Track what's been reported

    // Get all entries since timestamp
    getSince: function(timestamp) {
      return this.log.filter(e => e.timestamp >= timestamp);
    },

    // Get significant entries since timestamp
    getSignificant: function(timestamp, threshold) {
      threshold = threshold || SIGNIFICANCE_THRESHOLD;
      return this.log.filter(e => e.timestamp >= timestamp && e.significance >= threshold);
    },

    // Get unreported entries (for accumulation between tool calls)
    getUnreported: function() {
      const unreported = this.log.slice(this.lastReportedIndex);
      return unreported.filter(e => e.significance >= SIGNIFICANCE_THRESHOLD);
    },

    // Mark entries as reported
    markReported: function() {
      this.lastReportedIndex = this.log.length;
    },

    // Reset on navigation
    reset: function() {
      this.log.length = 0;
      this.lastReportedIndex = 0;
      this.pageLoadTime = Date.now();
    },
  };
})();
`;
