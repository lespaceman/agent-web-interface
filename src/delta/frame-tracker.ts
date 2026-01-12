/**
 * Frame Tracker
 *
 * Manages frame lifecycle and element reference tracking.
 * Ensures globally unique element references across frames and navigations.
 */

import type { CdpClient, CdpEventHandler } from '../cdp/cdp-client.interface.js';
import type {
  ScopedElementRef,
  CompositeNodeKey,
  FrameState,
  FrameTree,
  FrameInfo,
} from './types.js';
import { makeCompositeKey } from './utils.js';

/**
 * FrameTracker class
 *
 * Tracks frame lifecycle and manages element references.
 * Subscribes to CDP Page events to detect frame navigations and detachments.
 */
export class FrameTracker {
  private frames = new Map<string, FrameState>();
  private mainFrameId: string | null = null;

  /**
   * All refs ever issued, keyed by composite key (frameId:loaderId:backendNodeId).
   * CONTRACT: Callers MUST call pruneRefs() when refs are removed/invalidated
   * to prevent unbounded growth. Frame navigation automatically prunes via
   * invalidateFrameRefs(), but element removal requires explicit pruning.
   */
  private issuedRefs = new Map<CompositeNodeKey, ScopedElementRef>();

  /** Refs invalidated since last delta emission */
  private pendingInvalidations: ScopedElementRef[] = [];

  /** Initialization state - MUST be awaited before createRef calls */
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly cdp: CdpClient) {}

  /**
   * Initialize frame tracker. MUST be awaited before any createRef calls.
   * Safe to call multiple times - returns same promise.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        await this.doInitialize();
        this.initialized = true;
      } catch (error) {
        // Reset promise so next call can retry
        this.initPromise = null;
        throw error;
      }
    })();

    await this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    // Enable Page domain for frame events
    await this.cdp.send('Page.enable', undefined);

    // Get initial frame tree
    const { frameTree } = await this.cdp.send('Page.getFrameTree', undefined);
    this.processFrameTree(frameTree);

    // Listen for frame events
    // Note: Using type assertion because CdpClient.on uses generic handler type
    this.cdp.on('Page.frameNavigated', this.onFrameNavigated.bind(this) as CdpEventHandler);
    this.cdp.on('Page.frameDetached', this.onFrameDetached.bind(this) as CdpEventHandler);
  }

  /**
   * Ensure initialized before operations.
   */
  async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private processFrameTree(frameTree: FrameTree): void {
    const frame = frameTree.frame;
    this.frames.set(frame.id, {
      frameId: frame.id,
      loaderId: frame.loaderId,
      url: frame.url,
      isMainFrame: !frame.parentId,
    });

    if (!frame.parentId) {
      this.mainFrameId = frame.id;
    }

    for (const child of frameTree.childFrames ?? []) {
      this.processFrameTree(child);
    }
  }

  private onFrameNavigated(event: { frame: FrameInfo }): void {
    const { frame } = event;
    const previousState = this.frames.get(frame.id);

    // If loaderId changed, invalidate all refs in this frame
    if (previousState && previousState.loaderId !== frame.loaderId) {
      this.invalidateFrameRefs(frame.id, previousState.loaderId);
    }

    this.frames.set(frame.id, {
      frameId: frame.id,
      loaderId: frame.loaderId,
      url: frame.url,
      isMainFrame: !frame.parentId,
    });

    if (!frame.parentId) {
      this.mainFrameId = frame.id;
    }
  }

  private onFrameDetached(event: { frameId: string }): void {
    const state = this.frames.get(event.frameId);
    if (state) {
      this.invalidateFrameRefs(event.frameId, state.loaderId);
      this.frames.delete(event.frameId);
    }
  }

  private invalidateFrameRefs(frameId: string, loaderId: string): void {
    for (const [compositeKey, ref] of this.issuedRefs.entries()) {
      if (ref.frame_id === frameId && ref.loader_id === loaderId) {
        this.pendingInvalidations.push(ref);
        this.issuedRefs.delete(compositeKey);
      }
    }
  }

  /**
   * Create and register a scoped reference.
   * Returns null if frame doesn't exist or tracker not initialized.
   */
  createRef(backendNodeId: number, frameId: string): ScopedElementRef | null {
    if (!this.initialized) {
      console.warn('FrameTracker.createRef called before initialization');
      return null;
    }

    const frameState = this.frames.get(frameId);
    if (!frameState) {
      return null; // Frame doesn't exist
    }

    const ref: ScopedElementRef = {
      backend_node_id: backendNodeId,
      frame_id: frameId,
      loader_id: frameState.loaderId,
    };

    // Use composite key for internal tracking
    const compositeKey = makeCompositeKey(ref);
    this.issuedRefs.set(compositeKey, ref);

    return ref;
  }

  /**
   * Validate a reference is still valid.
   */
  isValid(ref: ScopedElementRef): boolean {
    const frameState = this.frames.get(ref.frame_id);
    if (!frameState) return false;
    return frameState.loaderId === ref.loader_id;
  }

  /**
   * Serialize ref for agent communication.
   * ALWAYS includes loaderId to prevent stale ref collisions.
   * Format: "loaderId:backendNodeId" (main frame) or "frameId:loaderId:backendNodeId" (iframes)
   */
  serializeRef(ref: ScopedElementRef): string {
    if (ref.frame_id === this.mainFrameId) {
      // Main frame: shorter form but STILL includes loaderId
      return `${ref.loader_id}:${ref.backend_node_id}`;
    }
    // Iframe: full form
    return `${ref.frame_id}:${ref.loader_id}:${ref.backend_node_id}`;
  }

  /**
   * Parse serialized ref back to structured form.
   * Validates loaderId matches current frame state.
   */
  parseRef(serialized: string): ScopedElementRef | null {
    const parts = serialized.split(':');

    if (parts.length === 2) {
      // Main frame format: "loaderId:backendNodeId"
      const [loaderId, backendNodeIdStr] = parts;

      if (!this.mainFrameId) return null;
      const mainFrame = this.frames.get(this.mainFrameId);

      if (!mainFrame) return null;

      // CRITICAL: Validate loaderId matches current frame
      if (mainFrame.loaderId !== loaderId) {
        // Stale ref from previous navigation
        return null;
      }

      return {
        backend_node_id: parseInt(backendNodeIdStr, 10),
        frame_id: this.mainFrameId,
        loader_id: loaderId,
      };
    }

    if (parts.length === 3) {
      // Iframe format: "frameId:loaderId:backendNodeId"
      const [frameId, loaderId, backendNodeIdStr] = parts;
      const frameState = this.frames.get(frameId);

      if (!frameState) return null;

      // CRITICAL: Validate loaderId matches current frame
      if (frameState.loaderId !== loaderId) {
        // Stale ref from previous navigation
        return null;
      }

      return {
        frame_id: frameId,
        loader_id: loaderId,
        backend_node_id: parseInt(backendNodeIdStr, 10),
      };
    }

    return null;
  }

  /**
   * Get and clear pending invalidations.
   * Call before computing delta to include frame-navigation invalidations.
   */
  drainInvalidations(): ScopedElementRef[] {
    const invalidations = [...this.pendingInvalidations];
    this.pendingInvalidations = [];
    return invalidations;
  }

  /**
   * Remove refs from tracking (called when delta reports them as removed).
   * Prevents unbounded growth of issuedRefs.
   */
  pruneRefs(refs: ScopedElementRef[]): void {
    for (const ref of refs) {
      const compositeKey = makeCompositeKey(ref);
      this.issuedRefs.delete(compositeKey);
    }
  }

  /**
   * Clear all refs (called on full page navigation).
   */
  clearAllRefs(): void {
    this.issuedRefs.clear();
    this.pendingInvalidations = [];
  }

  /**
   * Get main frame state.
   */
  get mainFrame(): FrameState | undefined {
    return this.mainFrameId ? this.frames.get(this.mainFrameId) : undefined;
  }

  /**
   * Get main frame ID.
   */
  get mainFrameIdValue(): string | null {
    return this.mainFrameId;
  }

  /**
   * Check if a frame exists.
   */
  hasFrame(frameId: string): boolean {
    return this.frames.has(frameId);
  }

  /**
   * Get frame state by ID.
   */
  getFrameState(frameId: string): FrameState | undefined {
    return this.frames.get(frameId);
  }
}
