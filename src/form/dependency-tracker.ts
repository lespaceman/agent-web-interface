/**
 * Dependency Tracker
 *
 * Tracks observed dependencies between form fields by correlating
 * actions with their effects. Dependencies are learned through
 * interaction, not predicted.
 *
 * Key concept: After each action, record "what changed" and
 * attribute the change to the action with a confidence score.
 *
 * @module form/dependency-tracker
 */

import type {
  FieldDependency,
  DependencyType,
  DependencyDetectionMethod,
  ObservedEffect,
} from './types.js';

/**
 * Dependency tracker configuration
 */
export interface DependencyTrackerConfig {
  /** Minimum confidence to report a dependency (default: 0.3) */
  minConfidence: number;

  /** Maximum number of observations to keep per trigger (default: 10) */
  maxObservationsPerTrigger: number;

  /** Time window to consider effects as caused by action (ms, default: 2000) */
  effectTimeWindow: number;
}

const DEFAULT_CONFIG: DependencyTrackerConfig = {
  minConfidence: 0.3,
  maxObservationsPerTrigger: 10,
  effectTimeWindow: 2000,
};

/**
 * Internal representation of a tracked dependency.
 */
interface TrackedDependency {
  source_eid: string;
  target_eid: string;
  type: DependencyType;
  observations: number;
  lastSeen: string;
  detectionMethod: DependencyDetectionMethod;
}

/**
 * Dependency Tracker class.
 *
 * Maintains a per-page record of observed dependencies between fields.
 * Dependencies are inferred from action->effect correlations.
 */
export class DependencyTracker {
  private readonly config: DependencyTrackerConfig;

  /** Observed effects per page: pageId -> triggerEid -> effects */
  private readonly effectsByPage: Map<string, Map<string, ObservedEffect[]>>;

  /** Tracked dependencies per page: pageId -> Map<"source:target", TrackedDependency> */
  private readonly dependenciesByPage: Map<string, Map<string, TrackedDependency>>;

  constructor(config?: Partial<DependencyTrackerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.effectsByPage = new Map();
    this.dependenciesByPage = new Map();
  }

  /**
   * Record an observed effect after an action.
   *
   * @param pageId - Page identifier
   * @param effect - The observed effect
   */
  recordEffect(pageId: string, effect: ObservedEffect): void {
    // Get or create page entry
    if (!this.effectsByPage.has(pageId)) {
      this.effectsByPage.set(pageId, new Map());
    }
    const pageEffects = this.effectsByPage.get(pageId)!;

    // Get or create trigger entry
    if (!pageEffects.has(effect.trigger_eid)) {
      pageEffects.set(effect.trigger_eid, []);
    }
    const triggerEffects = pageEffects.get(effect.trigger_eid)!;

    // Add effect
    triggerEffects.push(effect);

    // Trim old effects
    if (triggerEffects.length > this.config.maxObservationsPerTrigger) {
      triggerEffects.shift();
    }

    // Update dependencies based on this effect
    this.updateDependencies(pageId, effect);
  }

  /**
   * Update tracked dependencies based on an observed effect.
   */
  private updateDependencies(pageId: string, effect: ObservedEffect): void {
    if (!this.dependenciesByPage.has(pageId)) {
      this.dependenciesByPage.set(pageId, new Map());
    }
    const pageDeps = this.dependenciesByPage.get(pageId)!;

    // Process enabled elements -> 'enables' dependency
    for (const targetEid of effect.enabled) {
      this.trackDependency(
        pageDeps,
        effect.trigger_eid,
        targetEid,
        'enables',
        'observed_state_change'
      );
    }

    // Process disabled elements -> 'enables' dependency (inverse)
    for (const targetEid of effect.disabled) {
      // Track as 'enables' with reverse logic
      this.trackDependency(
        pageDeps,
        effect.trigger_eid,
        targetEid,
        'enables',
        'observed_state_change'
      );
    }

    // Process appeared elements -> 'reveals' dependency
    for (const targetEid of effect.appeared) {
      this.trackDependency(pageDeps, effect.trigger_eid, targetEid, 'reveals', 'observed_mutation');
    }

    // Process disappeared elements -> 'reveals' dependency (inverse)
    for (const targetEid of effect.disappeared) {
      this.trackDependency(pageDeps, effect.trigger_eid, targetEid, 'reveals', 'observed_mutation');
    }

    // Process value changed elements -> 'populates' dependency
    for (const targetEid of effect.value_changed) {
      this.trackDependency(
        pageDeps,
        effect.trigger_eid,
        targetEid,
        'populates',
        'observed_state_change'
      );
    }
  }

  /**
   * Track or update a dependency.
   */
  private trackDependency(
    pageDeps: Map<string, TrackedDependency>,
    sourceEid: string,
    targetEid: string,
    type: DependencyType,
    detectionMethod: DependencyDetectionMethod
  ): void {
    const key = `${sourceEid}:${targetEid}:${type}`;

    if (pageDeps.has(key)) {
      const existing = pageDeps.get(key)!;
      existing.observations++;
      existing.lastSeen = new Date().toISOString();
    } else {
      pageDeps.set(key, {
        source_eid: sourceEid,
        target_eid: targetEid,
        type,
        observations: 1,
        lastSeen: new Date().toISOString(),
        detectionMethod,
      });
    }
  }

  /**
   * Get dependencies for a specific field.
   *
   * @param pageId - Page identifier
   * @param targetEid - EID of the field to get dependencies for
   * @returns Array of dependencies that affect this field
   */
  getDependenciesFor(pageId: string, targetEid: string): FieldDependency[] {
    const pageDeps = this.dependenciesByPage.get(pageId);
    if (!pageDeps) return [];

    const dependencies: FieldDependency[] = [];

    for (const tracked of pageDeps.values()) {
      if (tracked.target_eid !== targetEid) continue;

      const confidence = this.computeConfidence(tracked);
      if (confidence < this.config.minConfidence) continue;

      dependencies.push({
        source_eid: tracked.source_eid,
        type: tracked.type,
        confidence,
        detection_method: tracked.detectionMethod,
      });
    }

    return dependencies;
  }

  /**
   * Get all observed dependencies for a page.
   *
   * @param pageId - Page identifier
   * @returns Map of target EID -> dependencies
   */
  getAllDependencies(pageId: string): Map<string, FieldDependency[]> {
    const result = new Map<string, FieldDependency[]>();
    const pageDeps = this.dependenciesByPage.get(pageId);
    if (!pageDeps) return result;

    for (const tracked of pageDeps.values()) {
      const confidence = this.computeConfidence(tracked);
      if (confidence < this.config.minConfidence) continue;

      const deps = result.get(tracked.target_eid) ?? [];
      deps.push({
        source_eid: tracked.source_eid,
        type: tracked.type,
        confidence,
        detection_method: tracked.detectionMethod,
      });
      result.set(tracked.target_eid, deps);
    }

    return result;
  }

  /**
   * Get fields that depend on a given source field.
   *
   * @param pageId - Page identifier
   * @param sourceEid - EID of the source field
   * @returns Array of field EIDs that depend on the source
   */
  getDependentsOf(pageId: string, sourceEid: string): string[] {
    const pageDeps = this.dependenciesByPage.get(pageId);
    if (!pageDeps) return [];

    const dependents: string[] = [];

    for (const tracked of pageDeps.values()) {
      if (tracked.source_eid !== sourceEid) continue;

      const confidence = this.computeConfidence(tracked);
      if (confidence < this.config.minConfidence) continue;

      if (!dependents.includes(tracked.target_eid)) {
        dependents.push(tracked.target_eid);
      }
    }

    return dependents;
  }

  /**
   * Compute confidence score for a tracked dependency.
   */
  private computeConfidence(tracked: TrackedDependency): number {
    // Base confidence from observations
    // More observations = higher confidence (up to a point)
    const observationFactor = Math.min(1.0, tracked.observations / 3);

    // Method-based confidence boost
    const methodBoost: Record<DependencyDetectionMethod, number> = {
      aria_controls: 0.3,
      data_attribute: 0.25,
      observed_mutation: 0.1,
      observed_state_change: 0.15,
      structural_inference: 0.05,
      naming_convention: 0.05,
    };

    const boost = methodBoost[tracked.detectionMethod] ?? 0;

    return Math.min(1.0, 0.3 + observationFactor * 0.5 + boost);
  }

  /**
   * Clear all tracked data for a page.
   *
   * @param pageId - Page identifier
   */
  clearPage(pageId: string): void {
    this.effectsByPage.delete(pageId);
    this.dependenciesByPage.delete(pageId);
  }

  /**
   * Clear all tracked data.
   */
  clearAll(): void {
    this.effectsByPage.clear();
    this.dependenciesByPage.clear();
  }
}

/**
 * Global dependency tracker instance.
 * Used across the application for consistent tracking.
 */
let globalTracker: DependencyTracker | null = null;

/**
 * Get the global dependency tracker instance.
 */
export function getDependencyTracker(): DependencyTracker {
  globalTracker ??= new DependencyTracker();
  return globalTracker;
}

/**
 * Create an ObservedEffect from before/after state comparison.
 *
 * @param triggerEid - EID of the element that was acted upon
 * @param actionType - Type of action performed
 * @param beforeEids - Map of EID -> enabled state before action
 * @param afterEids - Map of EID -> enabled state after action
 * @param beforeVisible - Set of EIDs that were visible before
 * @param afterVisible - Set of EIDs that are visible after
 * @param valueChanges - EIDs of fields whose values changed
 * @returns ObservedEffect object
 */
export function createObservedEffect(
  triggerEid: string,
  actionType: ObservedEffect['action_type'],
  beforeEids: Map<string, boolean>,
  afterEids: Map<string, boolean>,
  beforeVisible: Set<string>,
  afterVisible: Set<string>,
  valueChanges: string[] = []
): ObservedEffect {
  const enabled: string[] = [];
  const disabled: string[] = [];
  const appeared: string[] = [];
  const disappeared: string[] = [];

  // Find enabled/disabled changes
  for (const [eid, wasEnabled] of beforeEids) {
    const isEnabled = afterEids.get(eid);
    if (isEnabled !== undefined) {
      if (!wasEnabled && isEnabled) {
        enabled.push(eid);
      } else if (wasEnabled && !isEnabled) {
        disabled.push(eid);
      }
    }
  }

  // Check for newly enabled elements
  for (const [eid, isEnabled] of afterEids) {
    if (!beforeEids.has(eid) && isEnabled) {
      enabled.push(eid);
    }
  }

  // Find appeared/disappeared elements
  for (const eid of afterVisible) {
    if (!beforeVisible.has(eid)) {
      appeared.push(eid);
    }
  }

  for (const eid of beforeVisible) {
    if (!afterVisible.has(eid)) {
      disappeared.push(eid);
    }
  }

  // Compute confidence based on number of changes
  const totalChanges =
    enabled.length + disabled.length + appeared.length + disappeared.length + valueChanges.length;
  const confidence = totalChanges > 0 ? Math.min(1.0, 0.5 + totalChanges * 0.1) : 0.3;

  return {
    trigger_eid: triggerEid,
    action_type: actionType,
    timestamp: new Date().toISOString(),
    enabled,
    disabled,
    appeared,
    disappeared,
    value_changed: valueChanges,
    confidence,
  };
}
