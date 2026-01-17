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

import type { BaseSnapshot, ReadableNode, NodeKind } from '../snapshot/snapshot.types.js';
import type {
  FormRegion,
  FormSignal,
  FormIntent,
  FormPattern,
  FormCandidate,
  FormDetectionConfig,
} from './types.js';
import { DEFAULT_FORM_DETECTION_CONFIG } from './types.js';
import { extractFields } from './field-extractor.js';
import { computeFormState } from './form-state.js';
import { createHash } from 'crypto';

/**
 * Interactive input kinds
 */
const INPUT_KINDS = new Set<NodeKind>([
  'input',
  'textarea',
  'select',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
]);

/**
 * Button kinds that could be submit buttons
 */
const BUTTON_KINDS = new Set<NodeKind>(['button']);

/**
 * Signal weights for form detection
 */
const SIGNAL_WEIGHTS: Record<FormSignal['type'], number> = {
  form_tag: 0.5,
  role_form: 0.45,
  role_search: 0.4,
  fieldset: 0.3,
  input_cluster: 0.25,
  label_input_pairs: 0.2,
  submit_button: 0.3,
  form_keywords: 0.15,
  naming_pattern: 0.1,
};

/**
 * Weighted keywords that indicate form intent.
 * Higher weight = more explicit signal (e.g., "create account" is more explicitly signup than "email")
 * Lower weight = ambiguous signal that appears in multiple form types
 */
const INTENT_KEYWORDS: Record<FormIntent, { keyword: string; weight: number }[]> = {
  login: [
    { keyword: 'log in', weight: 3 },
    { keyword: 'login', weight: 3 },
    { keyword: 'sign in', weight: 3 },
    { keyword: 'signin', weight: 3 },
    // These are ambiguous - they appear in both login and signup forms
    { keyword: 'email', weight: 0.5 },
    { keyword: 'password', weight: 0.5 },
    { keyword: 'username', weight: 0.5 },
  ],
  signup: [
    { keyword: 'sign up', weight: 3 },
    { keyword: 'signup', weight: 3 },
    { keyword: 'register', weight: 3 },
    { keyword: 'create account', weight: 3 },
    { keyword: 'join', weight: 2 },
  ],
  search: [
    { keyword: 'search', weight: 3 },
    { keyword: 'find', weight: 2 },
    { keyword: 'lookup', weight: 2 },
    { keyword: 'query', weight: 2 },
  ],
  checkout: [
    { keyword: 'checkout', weight: 3 },
    { keyword: 'payment', weight: 2 },
    { keyword: 'order', weight: 2 },
    { keyword: 'purchase', weight: 2 },
    { keyword: 'buy now', weight: 3 },
  ],
  filter: [
    { keyword: 'filter', weight: 3 },
    { keyword: 'sort', weight: 2 },
    { keyword: 'refine', weight: 2 },
    { keyword: 'narrow', weight: 2 },
  ],
  settings: [
    { keyword: 'settings', weight: 3 },
    { keyword: 'preferences', weight: 2 },
    { keyword: 'configuration', weight: 2 },
    { keyword: 'options', weight: 1 },
  ],
  contact: [
    { keyword: 'contact', weight: 3 },
    { keyword: 'message', weight: 1 },
    { keyword: 'feedback', weight: 2 },
    { keyword: 'inquiry', weight: 2 },
  ],
  subscribe: [
    { keyword: 'subscribe', weight: 3 },
    { keyword: 'newsletter', weight: 3 },
    { keyword: 'email updates', weight: 2 },
  ],
  shipping: [
    { keyword: 'shipping', weight: 3 },
    { keyword: 'delivery', weight: 2 },
    { keyword: 'address', weight: 1 },
  ],
  payment: [
    { keyword: 'payment', weight: 3 },
    { keyword: 'credit card', weight: 3 },
    { keyword: 'billing', weight: 2 },
    { keyword: 'card number', weight: 3 },
  ],
  profile: [
    { keyword: 'profile', weight: 3 },
    { keyword: 'account', weight: 1 },
    { keyword: 'personal info', weight: 2 },
  ],
  unknown: [],
};

/**
 * Submit button keywords
 */
const SUBMIT_KEYWORDS = [
  'submit',
  'send',
  'continue',
  'next',
  'save',
  'apply',
  'confirm',
  'add to',
  'sign in',
  'log in',
  'sign up',
  'register',
  'search',
  'buy',
  'checkout',
  'purchase',
  'subscribe',
];

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
      const submitButton = this.findSubmitButton(snapshot, formNode, fieldEids);
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
      const intent = this.inferIntent(snapshot, fieldEids, formNode);

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
    const clusters = this.clusterInputs(unclaimedInputs, snapshot);

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
      const hasFormKeywords = cluster.some((n) => this.hasIntentKeywords(n.label, allKeywords));
      if (hasFormKeywords) {
        signals.push({
          type: 'form_keywords',
          strength: 0.8,
          evidence: 'Form-related keywords in labels',
        });
      }

      // Check for submit button near cluster
      const fieldEids = cluster.map((n) => n.node_id);
      const submitButton = this.findSubmitButtonNearCluster(snapshot, cluster);
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
      const intent = this.inferIntent(snapshot, fieldEids, undefined);

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
   * Cluster input nodes by proximity and structural context.
   */
  private clusterInputs(inputs: ReadableNode[], _snapshot: BaseSnapshot): ReadableNode[][] {
    if (inputs.length === 0) return [];
    if (inputs.length === 1) return [[inputs[0]]];

    // Group by region first
    const byRegion = new Map<string, ReadableNode[]>();
    for (const input of inputs) {
      const key = input.where.region ?? 'unknown';
      const group = byRegion.get(key) ?? [];
      group.push(input);
      byRegion.set(key, group);
    }

    const clusters: ReadableNode[][] = [];

    // Within each region, cluster by proximity
    for (const regionInputs of byRegion.values()) {
      if (regionInputs.length === 1) {
        clusters.push(regionInputs);
        continue;
      }

      // Simple clustering by vertical proximity
      const sorted = [...regionInputs].sort((a, b) => {
        const yA = a.layout?.bbox?.y ?? 0;
        const yB = b.layout?.bbox?.y ?? 0;
        return yA - yB;
      });

      let currentCluster: ReadableNode[] = [sorted[0]];

      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];

        const prevY = (prev.layout?.bbox?.y ?? 0) + (prev.layout?.bbox?.h ?? 0);
        const currY = curr.layout?.bbox?.y ?? 0;
        const distance = currY - prevY;

        if (distance <= this.config.cluster_distance) {
          currentCluster.push(curr);
        } else {
          if (currentCluster.length > 0) {
            clusters.push(currentCluster);
          }
          currentCluster = [curr];
        }
      }

      if (currentCluster.length > 0) {
        clusters.push(currentCluster);
      }
    }

    return clusters;
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
   * Find a submit button associated with a form.
   */
  private findSubmitButton(
    snapshot: BaseSnapshot,
    formNode: ReadableNode,
    fieldEids: string[]
  ): ReadableNode | undefined {
    const buttons = snapshot.nodes.filter((n) => BUTTON_KINDS.has(n.kind));

    for (const button of buttons) {
      // Check if button is within form's scope
      if (!this.isNodeWithinForm(button, formNode, snapshot)) {
        continue;
      }

      // Check if button label suggests submission
      if (this.isSubmitButton(button)) {
        return button;
      }
    }

    // Also check buttons near the fields
    if (fieldEids.length > 0) {
      const fieldNodes = fieldEids
        .map((eid) => snapshot.nodes.find((n) => n.node_id === eid))
        .filter((n): n is ReadableNode => n !== undefined);

      return this.findSubmitButtonNearCluster(snapshot, fieldNodes);
    }

    return undefined;
  }

  /**
   * Find a submit button near a cluster of inputs.
   */
  private findSubmitButtonNearCluster(
    snapshot: BaseSnapshot,
    cluster: ReadableNode[]
  ): ReadableNode | undefined {
    if (cluster.length === 0) return undefined;

    const buttons = snapshot.nodes.filter((n) => BUTTON_KINDS.has(n.kind));
    const clusterBbox = this.computeClusterBbox(cluster);

    if (!clusterBbox) return undefined;

    // Find buttons near the cluster
    const nearbyButtons = buttons.filter((button) => {
      if (!button.layout?.bbox) return false;
      const btnBbox = button.layout.bbox;

      // Check if button is below or to the right of the cluster
      const isNearX =
        btnBbox.x >= clusterBbox.x - 100 && btnBbox.x <= clusterBbox.x + clusterBbox.width + 100;
      const isNearY =
        btnBbox.y >= clusterBbox.y - 50 && btnBbox.y <= clusterBbox.y + clusterBbox.height + 150;

      return isNearX && isNearY;
    });

    // Find the best submit button candidate
    for (const button of nearbyButtons) {
      if (this.isSubmitButton(button)) {
        return button;
      }
    }

    return undefined;
  }

  /**
   * Check if a button looks like a submit button.
   */
  private isSubmitButton(button: ReadableNode): boolean {
    const label = button.label.toLowerCase();

    // Check for submit keywords
    for (const keyword of SUBMIT_KEYWORDS) {
      if (label.includes(keyword)) {
        return true;
      }
    }

    // Check for type="submit" attribute
    if (button.attributes?.input_type === 'submit') {
      return true;
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
   * Infer the intent of a form.
   */
  private inferIntent(
    snapshot: BaseSnapshot,
    fieldEids: string[],
    formNode?: ReadableNode
  ): FormIntent {
    // Collect all relevant text to analyze
    const textToAnalyze: string[] = [];

    // Add form node label if available
    if (formNode?.label) {
      textToAnalyze.push(formNode.label);
    }

    // Add form heading context
    if (formNode?.where.heading_context) {
      textToAnalyze.push(formNode.where.heading_context);
    }

    // Add field labels
    for (const eid of fieldEids) {
      const node = snapshot.nodes.find((n) => n.node_id === eid);
      if (node?.label) {
        textToAnalyze.push(node.label);
      }
      if (node?.attributes?.placeholder) {
        textToAnalyze.push(node.attributes.placeholder);
      }
    }

    const combinedText = textToAnalyze.join(' ').toLowerCase();

    // Score each intent using weighted keywords
    let bestIntent: FormIntent = 'unknown';
    let bestScore = 0;

    for (const [intent, keywordEntries] of Object.entries(INTENT_KEYWORDS)) {
      if (intent === 'unknown') continue;

      let score = 0;
      for (const entry of keywordEntries) {
        if (combinedText.includes(entry.keyword)) {
          score += entry.weight;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent as FormIntent;
      }
    }

    return bestIntent;
  }

  /**
   * Check if text contains any of the given keywords.
   */
  private hasIntentKeywords(text: string, keywords: string[]): boolean {
    const lower = text.toLowerCase();
    return keywords.some((k) => lower.includes(k));
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
    const actions = this.extractFormActions(snapshot, candidate);

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
   * Extract form action buttons.
   */
  private extractFormActions(
    snapshot: BaseSnapshot,
    candidate: FormCandidate
  ): FormRegion['actions'] {
    const actions: FormRegion['actions'] = [];
    const buttons = snapshot.nodes.filter((n) => BUTTON_KINDS.has(n.kind));

    for (const button of buttons) {
      // Skip disabled buttons for now but still include them
      const isSubmit = this.isSubmitButton(button);
      const isNearForm = candidate.bbox
        ? this.isButtonNearBbox(button, candidate.bbox)
        : candidate.field_eids.length === 0 ||
          this.isButtonNearFields(button, snapshot, candidate.field_eids);

      if (!isNearForm) continue;

      // Determine action type
      let type: FormRegion['actions'][0]['type'] = 'action';
      const label = button.label.toLowerCase();

      if (isSubmit) {
        type = 'submit';
      } else if (label.includes('cancel') || label.includes('close')) {
        type = 'cancel';
      } else if (label.includes('back') || label.includes('previous')) {
        type = 'back';
      } else if (label.includes('next') || label.includes('continue')) {
        type = 'next';
      } else if (label.includes('reset') || label.includes('clear')) {
        type = 'reset';
      }

      actions.push({
        eid: button.node_id,
        backend_node_id: button.backend_node_id,
        label: button.label,
        type,
        enabled: button.state?.enabled ?? true,
        is_primary: isSubmit,
      });
    }

    return actions;
  }

  /**
   * Check if a button is near a bounding box.
   */
  private isButtonNearBbox(
    button: ReadableNode,
    bbox: NonNullable<FormCandidate['bbox']>
  ): boolean {
    if (!button.layout?.bbox) return false;
    const btnBbox = button.layout.bbox;

    const isNearX = btnBbox.x >= bbox.x - 100 && btnBbox.x <= bbox.x + bbox.width + 100;
    const isNearY = btnBbox.y >= bbox.y - 50 && btnBbox.y <= bbox.y + bbox.height + 150;

    return isNearX && isNearY;
  }

  /**
   * Check if a button is near a set of fields.
   */
  private isButtonNearFields(
    button: ReadableNode,
    snapshot: BaseSnapshot,
    fieldEids: string[]
  ): boolean {
    const fieldNodes = fieldEids
      .map((eid) => snapshot.nodes.find((n) => n.node_id === eid))
      .filter((n): n is ReadableNode => n !== undefined);

    const clusterBbox = this.computeClusterBbox(fieldNodes);
    if (!clusterBbox) return false;

    return this.isButtonNearBbox(button, clusterBbox);
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
