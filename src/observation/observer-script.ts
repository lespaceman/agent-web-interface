/**
 * Browser-side script for DOM observation.
 *
 * This script is injected into the browser context and runs continuously to capture
 * significant DOM mutations. It uses universal web standards for significance detection -
 * NO hardcoded text/class patterns.
 *
 * Shadow DOM Support:
 * - Detects shadow hosts when elements are added
 * - Attaches MutationObservers to open shadow roots
 * - Tracks shadow path context for observations
 * - Cleans up observers when shadow hosts are removed
 *
 * Note: Closed shadow roots cannot be observed (browser security).
 *
 * The script is returned as a string for page.evaluate().
 */

export const OBSERVATION_OBSERVER_SCRIPT = `
(function() {
  // Prevent double-injection
  if (window.__observationAccumulator) return;

  const MAX_ENTRIES = 500;
  const MAX_TEXT_LENGTH = 200;
  const MAX_SHADOW_OBSERVERS = 50; // Limit to prevent performance issues
  // IMPORTANT: Must match SIGNIFICANCE_THRESHOLD in observation.types.ts
  const SIGNIFICANCE_THRESHOLD = 3;

  // Significance weights (must match server-side observation.types.ts)
  const WEIGHTS = {
    // Semantic signals (strongest)
    hasAlertRole: 3,
    hasAriaLive: 3,
    isDialog: 3,

    // Visual signals
    isFixedOrSticky: 2,
    hasHighZIndex: 1,
    coversSignificantViewport: 2,

    // Structural signals
    isBodyDirectChild: 1,
    containsInteractiveElements: 1,

    // New universal signals - work without ARIA
    isVisibleInViewport: 2,      // Element is visible in viewport
    hasNonTrivialText: 1,        // Has meaningful text content
    // Temporal signals computed later
  };

  // Shadow DOM tracking
  // Map: shadowRoot -> { observer, hostPath }
  const shadowObservers = new Map();

  // Track processed elements to avoid duplicate observations
  // WeakSet allows garbage collection of removed elements
  const processedElements = new WeakSet();

  // Content-based deduplication for nested shadow DOM with same text
  // Map: "tag:text" -> timestamp of last capture
  const recentContent = new Map();
  const CONTENT_DEDUP_WINDOW_MS = 100; // Dedupe same content within 100ms

  /**
   * Generate a stable identifier for an element (for shadow path tracking).
   * Format: TAG#id or TAG.className or TAG[index]
   */
  function getElementIdentifier(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id) {
      return tag + '#' + el.id;
    }
    // For custom elements, use the tag name (usually descriptive like 'my-toast')
    if (tag.includes('-')) {
      return tag;
    }
    // Fallback: use first class or just tag
    const className = el.className && typeof el.className === 'string'
      ? el.className.split(' ')[0]
      : '';
    if (className) {
      return tag + '.' + className;
    }
    return tag;
  }

  /**
   * Compute significance signals from element.
   * Uses universal web standards (ARIA, CSS positioning, DOM structure, visibility).
   */
  function computeSignals(el, shadowPath) {
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

    // Check if element is visible in viewport
    const isVisibleInViewport = rect && style &&
      rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.top < vh &&
      rect.right > 0 && rect.left < vw &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0';

    // Check for non-trivial text (at least 3 chars, not just whitespace)
    const text = (el.textContent || '').trim();
    const hasNonTrivialText = text.length >= 3;

    // For shadow DOM elements, isBodyDirectChild is false but we still want to capture them
    // Check if parent is a shadow root (which indicates top-level in shadow DOM)
    const isTopLevelInShadow = shadowPath && shadowPath.length > 0 &&
      el.parentNode && el.parentNode.nodeType === 11; // DocumentFragment (shadow root)

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

      // Structural signals - consider top-level shadow DOM elements as equivalent to body children
      isBodyDirectChild: el.parentElement === document.body || isTopLevelInShadow,
      containsInteractiveElements: el.querySelector('button, a, input, select, textarea') !== null,

      // Universal signals (work without ARIA)
      isVisibleInViewport: !!isVisibleInViewport,
      hasNonTrivialText: hasNonTrivialText,

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

  /**
   * Capture a mutation entry from an element.
   * @param node - The DOM node
   * @param type - 'added' or 'removed'
   * @param shadowPath - Optional array of shadow host identifiers
   */
  function captureEntry(node, type, shadowPath) {
    if (node.nodeType !== 1) return null; // Element nodes only

    const el = node;
    const signals = computeSignals(el, shadowPath);
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

    const entry = {
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

      // Universal signals
      isVisibleInViewport: signals.isVisibleInViewport,
      hasNonTrivialText: signals.hasNonTrivialText,

      // Shadow DOM context
      shadowPath: shadowPath && shadowPath.length > 0 ? shadowPath : undefined,

      // Significance
      significance: significance,
    };

    return entry;
  }

  const log = [];
  const pageLoadTime = Date.now();

  /**
   * Process added nodes - capture entries and check for shadow roots.
   * @param node - The added node
   * @param shadowPath - Current shadow path context
   */
  function processAddedNode(node, shadowPath) {
    // Skip if already processed (prevents duplicates from nested shadow DOM)
    if (node.nodeType === 1 && processedElements.has(node)) {
      return;
    }

    const entry = captureEntry(node, 'added', shadowPath);
    if (entry) {
      entry.appearedAfterDelay = (entry.timestamp - pageLoadTime) > 100;
      log.push(entry);
      // Mark as processed
      if (node.nodeType === 1) {
        processedElements.add(node);
      }
    }

    // Check significant children - both ARIA-attributed and visible text elements
    if (node.nodeType === 1) {
      // First: ARIA-attributed elements (high confidence)
      const ariaChildren = node.querySelectorAll(
        '[role="alert"], [role="status"], [role="dialog"], [role="alertdialog"], [aria-live], [aria-modal], dialog'
      );
      for (const child of ariaChildren) {
        // Skip if already processed
        if (processedElements.has(child)) continue;

        const childEntry = captureEntry(child, 'added', shadowPath);
        if (childEntry) {
          childEntry.appearedAfterDelay = (childEntry.timestamp - pageLoadTime) > 100;
          log.push(childEntry);
          processedElements.add(child);
        }
      }

      // Second: Any visible element with text (broader capture for sites without ARIA)
      const textChildren = node.querySelectorAll('span, div, p, small, strong, em, label, li');
      for (const child of textChildren) {
        // Skip if already processed
        if (processedElements.has(child)) continue;

        // Skip if already captured via ARIA query
        if (child.hasAttribute('role') || child.hasAttribute('aria-live')) continue;

        // Only capture leaf-ish elements (minimal nested structure)
        const hasDeepNesting = child.querySelector('div, p, ul, ol, table');
        if (hasDeepNesting) continue;

        const childEntry = captureEntry(child, 'added', shadowPath);
        if (childEntry) {
          childEntry.appearedAfterDelay = (childEntry.timestamp - pageLoadTime) > 100;
          log.push(childEntry);
          processedElements.add(child);
        }
      }

      // Check for shadow roots in this element and its descendants
      checkAndObserveShadowRoots(node, shadowPath || []);
    }
  }

  /**
   * Process removed nodes - capture entries and cleanup shadow observers.
   * @param node - The removed node
   * @param shadowPath - Current shadow path context
   */
  function processRemovedNode(node, shadowPath) {
    const entry = captureEntry(node, 'removed', shadowPath);
    if (entry) {
      log.push(entry);
    }

    // Cleanup shadow observers for removed elements
    if (node.nodeType === 1) {
      cleanupShadowObservers(node);
    }
  }

  /**
   * Create a mutation callback for observing a specific context (main DOM or shadow root).
   * @param shadowPath - The shadow path context for this observer
   */
  function createMutationCallback(shadowPath) {
    return function(mutations) {
      for (const m of mutations) {
        // Capture added nodes
        for (const node of m.addedNodes) {
          processAddedNode(node, shadowPath);
        }

        // Capture removed nodes
        for (const node of m.removedNodes) {
          processRemovedNode(node, shadowPath);
        }
      }

      // Trim if over limit (FIFO)
      if (log.length > MAX_ENTRIES) {
        const excess = log.length - MAX_ENTRIES;
        log.splice(0, excess);
      }
    };
  }

  /**
   * Observe a shadow root for mutations.
   * @param shadowRoot - The shadow root to observe
   * @param shadowPath - The path of shadow host identifiers leading to this shadow root
   */
  function observeShadowRoot(shadowRoot, shadowPath) {
    // Already observing this shadow root
    if (shadowObservers.has(shadowRoot)) return;

    // Limit number of shadow observers for performance
    if (shadowObservers.size >= MAX_SHADOW_OBSERVERS) {
      console.warn('[ObservationAccumulator] Max shadow observers reached, skipping:', shadowPath);
      return;
    }

    const observer = new MutationObserver(createMutationCallback(shadowPath));
    observer.observe(shadowRoot, {
      childList: true,
      subtree: true,
    });

    shadowObservers.set(shadowRoot, { observer, hostPath: shadowPath });
  }

  /**
   * Recursively check element and descendants for open shadow roots.
   * @param element - The element to check
   * @param currentShadowPath - The current shadow path context
   */
  function checkAndObserveShadowRoots(element, currentShadowPath) {
    if (!element || element.nodeType !== 1) return;

    // Check if this element has an open shadow root
    if (element.shadowRoot) {
      const newPath = [...currentShadowPath, getElementIdentifier(element)];
      observeShadowRoot(element.shadowRoot, newPath);

      // Check shadow root's children for nested shadow roots
      const shadowChildren = element.shadowRoot.querySelectorAll('*');
      for (const child of shadowChildren) {
        if (child.shadowRoot) {
          checkAndObserveShadowRoots(child, newPath);
        }
      }
    }

    // Check light DOM children for shadow roots
    const children = element.querySelectorAll('*');
    for (const child of children) {
      if (child.shadowRoot) {
        checkAndObserveShadowRoots(child, currentShadowPath);
      }
    }
  }

  /**
   * Cleanup shadow observers for a removed element and its descendants.
   * @param element - The element being removed
   */
  function cleanupShadowObservers(element) {
    if (!element || element.nodeType !== 1) return;

    // If element is a shadow host, cleanup its observer
    if (element.shadowRoot && shadowObservers.has(element.shadowRoot)) {
      const { observer } = shadowObservers.get(element.shadowRoot);
      observer.disconnect();
      shadowObservers.delete(element.shadowRoot);
    }

    // Recursively cleanup descendant shadow hosts
    try {
      const descendants = element.querySelectorAll('*');
      for (const child of descendants) {
        if (child.shadowRoot && shadowObservers.has(child.shadowRoot)) {
          const { observer } = shadowObservers.get(child.shadowRoot);
          observer.disconnect();
          shadowObservers.delete(child.shadowRoot);
        }
      }
    } catch (e) {
      // Element may be detached, ignore errors
    }
  }

  // Create main observer for document.body
  const observer = new MutationObserver(createMutationCallback(null));

  // Start observing
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Initial scan for existing shadow roots in the DOM
    checkAndObserveShadowRoots(document.body, []);
  }

  window.__observationAccumulator = {
    log: log,
    observer: observer,
    shadowObservers: shadowObservers, // Expose for debugging/testing
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
      // Cleanup all shadow observers
      for (const [shadowRoot, { observer }] of this.shadowObservers) {
        observer.disconnect();
      }
      this.shadowObservers.clear();
    },

    // Re-scan for shadow roots (useful after dynamic content load)
    rescanShadowRoots: function() {
      if (document.body) {
        checkAndObserveShadowRoots(document.body, []);
      }
    },

    // Get shadow observer count (for debugging)
    getShadowObserverCount: function() {
      return this.shadowObservers.size;
    },
  };
})();
`;
