/**
 * Form Detector
 *
 * Detects logical form boundaries in a BaseSnapshot, regardless of
 * HTML <form> tag presence. Uses signal scoring to identify form
 * regions with confidence scores.
 *
 * Detection approaches:
 * 1. Semantic: <form> tags, role="form", role="search", <fieldset>
 * 2. Structural: Input clusters, label-input pairs, submit buttons
 * 3. Naming: Form keywords in labels, field name patterns
 *
 * @module form/form-detector
 */

import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type {
  FormRegion,
  FormSignal,
  FormPattern,
  FormCandidate,
  FormDetectionConfig,
} from './types.js';
import { DEFAULT_FORM_DETECTION_CONFIG } from './types.js';
import { extractFields } from './field-extractor.js';
import { computeFormState } from './form-state.js';
import { createHash } from 'crypto';
import { inferIntent, hasIntentKeywords, INTENT_KEYWORDS } from './intent-inference.js';
import { findSubmitButton, findSubmitButtonNearCluster } from './submit-detection.js';
import { clusterInputs } from './input-clustering.js';
import { extractFormActions, INPUT_KINDS, SIGNAL_WEIGHTS } from './form-actions.js';

/**
 * Form Detector class
 */
export class FormDetector {
  private readonly config: FormDetectionConfig;

  constructor(config?: Partial<FormDetectionConfig>) {
    this.config = { ...DEFAULT_FORM_DETECTION_CONFIG, ...config };
  }

  /**
   * Detect all form regions in a snapshot.
   *
   * @param snapshot - BaseSnapshot to analyze
   * @returns Array of detected FormRegions
   */
  detect(snapshot: BaseSnapshot): FormRegion[] {
    const candidates: FormCandidate[] = [];

    // Phase 1: Detect explicit form elements (semantic signals)
    const explicitForms = this.detectExplicitForms(snapshot);
    candidates.push(...explicitForms);

    // Track which fields are already claimed by explicit forms
    const claimedFields = new Set<string>();
    for (const candidate of explicitForms) {
      for (const eid of candidate.field_eids) {
        claimedFields.add(eid);
      }
    }

    // Phase 2: Detect implicit forms (formless input clusters)
    if (this.config.detect_formless) {
      const implicitForms = this.detectImplicitForms(snapshot, claimedFields);
      candidates.push(...implicitForms);
    }

    // Phase 3: Filter by minimum confidence
    const validCandidates = candidates.filter((c) => c.confidence >= this.config.min_confidence);

    // Phase 4: Transform candidates to FormRegions
    return validCandidates.map((candidate, index) =>
      this.buildFormRegion(candidate, snapshot, index)
    );
  }

  /**
   * Detect explicit form elements (form tags, role=form, etc.)
   */
  private detectExplicitForms(snapshot: BaseSnapshot): FormCandidate[] {
    const candidates: FormCandidate[] = [];
    const inputNodes = snapshot.nodes.filter((n) => INPUT_KINDS.has(n.kind));

    // Find form structural nodes
    const formNodes = snapshot.nodes.filter(
      (n) => n.kind === 'form' || n.attributes?.role === 'form' || n.attributes?.role === 'search'
    );

    for (const formNode of formNodes) {
      const signals: FormSignal[] = [];

      // Determine signal type
      if (formNode.kind === 'form') {
        signals.push({
          type: 'form_tag',
          strength: 1.0,
          evidence: `<form> element at ${formNode.node_id}`,
        });
      } else if (formNode.attributes?.role === 'search') {
        signals.push({
          type: 'role_search',
          strength: 1.0,
          evidence: `role="search" at ${formNode.node_id}`,
        });
      } else if (formNode.attributes?.role === 'form') {
        signals.push({
          type: 'role_form',
          strength: 1.0,
          evidence: `role="form" at ${formNode.node_id}`,
        });
      }

      // Find fields within this form's region/group
      const fieldEids: string[] = [];
      for (const input of inputNodes) {
        // Check if input is in the same group or under the same heading context
        const isInForm = this.isNodeWithinForm(input, formNode, snapshot);
        if (isInForm) {
          fieldEids.push(input.node_id);
        }
      }

      // Add input cluster signal if we found fields
      if (fieldEids.length > 0) {
        signals.push({
          type: 'input_cluster',
          strength: Math.min(1.0, fieldEids.length / 5),
          evidence: `${fieldEids.length} input fields`,
        });
      }

      // Check for submit button
      const submitButton = findSubmitButton(
        snapshot,
        formNode,
        fieldEids,
        this.isNodeWithinForm.bind(this),
        this.computeClusterBbox.bind(this)
      );
      if (submitButton) {
        signals.push({
          type: 'submit_button',
          strength: 1.0,
          evidence: `Submit button: "${submitButton.label}"`,
        });
      }

      // Compute confidence
      const confidence = this.computeConfidence(signals);

      // Infer intent
      const intent = inferIntent(snapshot, fieldEids, formNode);

      candidates.push({
        root_node_id: formNode.node_id,
        root_backend_node_id: formNode.backend_node_id,
        signals,
        field_eids: fieldEids,
        confidence,
        intent,
        bbox: formNode.layout?.bbox
          ? {
              x: formNode.layout.bbox.x,
              y: formNode.layout.bbox.y,
              width: formNode.layout.bbox.w,
              height: formNode.layout.bbox.h,
            }
          : undefined,
      });
    }

    return candidates;
  }

  /**
   * Detect implicit forms (input clusters without form tag)
   */
  private detectImplicitForms(snapshot: BaseSnapshot, claimedFields: Set<string>): FormCandidate[] {
    const candidates: FormCandidate[] = [];

    // Find unclaimed input nodes
    const unclaimedInputs = snapshot.nodes.filter(
      (n) => INPUT_KINDS.has(n.kind) && !claimedFields.has(n.node_id)
    );

    if (unclaimedInputs.length === 0) {
      return candidates;
    }

    // Group inputs by proximity and structural context
    const clusters = clusterInputs(unclaimedInputs, snapshot, this.config);

    for (const cluster of clusters) {
      if (cluster.length < 1) continue;

      const signals: FormSignal[] = [];

      // Input cluster signal
      signals.push({
        type: 'input_cluster',
        strength: Math.min(1.0, cluster.length / 3),
        evidence: `${cluster.length} input fields clustered`,
      });

      // Check for label-input pairs
      const labeledCount = cluster.filter((n) => n.label && n.label.trim().length > 0).length;
      if (labeledCount > 0) {
        signals.push({
          type: 'label_input_pairs',
          strength: labeledCount / cluster.length,
          evidence: `${labeledCount}/${cluster.length} fields have labels`,
        });
      }

      // Check for form keywords in labels
      const allKeywords = Object.values(INTENT_KEYWORDS)
        .flat()
        .map((entry) => entry.keyword);
      const hasFormKeywords = cluster.some((n) => hasIntentKeywords(n.label, allKeywords));
      if (hasFormKeywords) {
        signals.push({
          type: 'form_keywords',
          strength: 0.8,
          evidence: 'Form-related keywords in labels',
        });
      }

      // Check for submit button near cluster
      const fieldEids = cluster.map((n) => n.node_id);
      const submitButton = findSubmitButtonNearCluster(
        snapshot,
        cluster,
        this.computeClusterBbox.bind(this)
      );
      if (submitButton) {
        signals.push({
          type: 'submit_button',
          strength: 0.9,
          evidence: `Nearby submit button: "${submitButton.label}"`,
        });
      }

      // Compute confidence
      const confidence = this.computeConfidence(signals);

      // Infer intent
      const intent = inferIntent(snapshot, fieldEids, undefined);

      // Compute bounding box from cluster
      const bbox = this.computeClusterBbox(cluster);

      candidates.push({
        signals,
        field_eids: fieldEids,
        confidence,
        intent,
        bbox,
      });
    }

    return candidates;
  }

  /**
   * Check if a node is likely within a form's scope.
   */
  private isNodeWithinForm(
    node: ReadableNode,
    formNode: ReadableNode,
    _snapshot: BaseSnapshot
  ): boolean {
    // Check region match
    if (node.where.region !== formNode.where.region) {
      return false;
    }

    // Check group_id if available
    if (formNode.where.group_id && node.where.group_id) {
      if (node.where.group_id === formNode.where.group_id) {
        return true;
      }
    }

    // Check heading context
    if (formNode.where.heading_context && node.where.heading_context) {
      if (node.where.heading_context === formNode.where.heading_context) {
        return true;
      }
    }

    // Check spatial proximity using bounding boxes
    if (formNode.layout?.bbox && node.layout?.bbox) {
      const formBbox = formNode.layout.bbox;
      const nodeBbox = node.layout.bbox;

      // Check if node is within or near form's bounding box
      const isWithinX = nodeBbox.x >= formBbox.x - 50 && nodeBbox.x <= formBbox.x + formBbox.w + 50;
      const isWithinY = nodeBbox.y >= formBbox.y - 50 && nodeBbox.y <= formBbox.y + formBbox.h + 50;

      if (isWithinX && isWithinY) {
        return true;
      }
    }

    return false;
  }

  /**
   * Compute confidence score from signals.
   */
  private computeConfidence(signals: FormSignal[]): number {
    let score = 0;

    for (const signal of signals) {
      const weight = SIGNAL_WEIGHTS[signal.type] ?? 0;
      score += weight * signal.strength;
    }

    // Normalize to 0-1
    return Math.min(1.0, score);
  }

  /**
   * Compute bounding box for a cluster of nodes.
   */
  private computeClusterBbox(
    nodes: ReadableNode[]
  ): { x: number; y: number; width: number; height: number } | undefined {
    const bboxes = nodes
      .map((n) => n.layout?.bbox)
      .filter((b): b is NonNullable<typeof b> => b !== undefined);

    if (bboxes.length === 0) return undefined;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const bbox of bboxes) {
      minX = Math.min(minX, bbox.x);
      minY = Math.min(minY, bbox.y);
      maxX = Math.max(maxX, bbox.x + bbox.w);
      maxY = Math.max(maxY, bbox.y + bbox.h);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /**
   * Build a FormRegion from a candidate.
   */
  private buildFormRegion(
    candidate: FormCandidate,
    snapshot: BaseSnapshot,
    index: number
  ): FormRegion {
    // Generate form ID
    const formId = this.generateFormId(candidate, index);

    // Extract fields
    const fields = extractFields(snapshot, candidate.field_eids, this.config);

    // Find action buttons
    const actions = extractFormActions(snapshot, candidate, this.computeClusterBbox.bind(this));

    // Compute form state
    const state = computeFormState(fields);

    // Determine form pattern
    const pattern = this.inferPattern(fields, snapshot);

    // Build detection info
    const detection = {
      method: candidate.root_node_id ? 'semantic' : 'structural',
      confidence: candidate.confidence,
      signals: candidate.signals,
    } as const;

    return {
      form_id: formId,
      detection,
      intent: candidate.intent,
      pattern,
      fields,
      actions,
      state,
      bbox: candidate.bbox,
    };
  }

  /**
   * Generate a unique form ID.
   */
  private generateFormId(candidate: FormCandidate, index: number): string {
    const components = [
      candidate.intent ?? 'form',
      candidate.root_node_id ?? `cluster-${index}`,
      String(candidate.field_eids.length),
    ];
    const hash = createHash('sha256').update(components.join('::')).digest('hex');
    return `form-${hash.substring(0, 8)}`;
  }

  /**
   * Infer form pattern (single page, multi-step, etc.)
   */
  private inferPattern(_fields: FormRegion['fields'], _snapshot: BaseSnapshot): FormPattern {
    // For now, default to single_page
    // Future: detect multi-step wizards, accordions, tabs
    return 'single_page';
  }
}

/**
 * Convenience function for detecting forms in a snapshot.
 */
export function detectForms(
  snapshot: BaseSnapshot,
  config?: Partial<FormDetectionConfig>
): FormRegion[] {
  const detector = new FormDetector(config);
  return detector.detect(snapshot);
}
