/**
 * Form Understanding Types
 *
 * Type definitions for unified form understanding.
 * Provides semantic understanding of form-like interactions
 * regardless of HTML implementation.
 */

// ============================================================================
// FormRegion Types
// ============================================================================

/**
 * A logical boundary containing related input fields.
 * Detected regardless of <form> tag presence.
 */
export interface FormRegion {
  /** Unique identifier for this form region */
  form_id: string;

  /** How this form was detected */
  detection: FormDetection;

  /** Inferred intent of the form */
  intent?: FormIntent;

  /** Pattern of form interaction */
  pattern?: FormPattern;

  /** Fields within this form region */
  fields: FormField[];

  /** Submit/action buttons associated with this form */
  actions: FormAction[];

  /** Current state of the form */
  state: FormState;

  /** Bounding box of the form region */
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * How a form region was detected.
 */
export interface FormDetection {
  /** Detection method used */
  method: 'semantic' | 'structural' | 'behavioral' | 'inferred';

  /** Confidence score (0.0 - 1.0) */
  confidence: number;

  /** Signals that contributed to detection */
  signals: FormSignal[];
}

/**
 * A signal that contributed to form detection.
 */
export interface FormSignal {
  /** Type of signal */
  type:
    | 'form_tag'
    | 'role_form'
    | 'role_search'
    | 'fieldset'
    | 'input_cluster'
    | 'label_input_pairs'
    | 'submit_button'
    | 'form_keywords'
    | 'naming_pattern';

  /** Strength of this signal (0.0 - 1.0) */
  strength: number;

  /** Evidence for this signal */
  evidence?: string;
}

/**
 * Inferred intent of a form.
 */
export type FormIntent =
  | 'login'
  | 'signup'
  | 'search'
  | 'checkout'
  | 'filter'
  | 'settings'
  | 'contact'
  | 'subscribe'
  | 'shipping'
  | 'payment'
  | 'profile'
  | 'unknown';

/**
 * Pattern of form interaction.
 */
export type FormPattern =
  | 'single_page'
  | 'multi_step'
  | 'accordion'
  | 'tabs'
  | 'wizard'
  | 'inline'
  | 'unknown';

/**
 * Current state of a form.
 */
export interface FormState {
  /** Percentage of required fields completed */
  completion_pct: number;

  /** Number of fields with validation errors */
  error_count: number;

  /** Whether the form can be submitted */
  can_submit: boolean;

  /** Whether any field has been modified */
  dirty: boolean;

  /** Number of required fields */
  required_count: number;

  /** Number of filled required fields */
  filled_required_count: number;
}

// ============================================================================
// FormField Types
// ============================================================================

/**
 * A single input element with rich metadata.
 */
export interface FormField {
  /** Element ID reference to the actionable */
  eid: string;

  /** Backend node ID for direct CDP targeting */
  backend_node_id: number;

  /** Frame ID containing this field */
  frame_id: string;

  /** Accessible name / label */
  label: string;

  /** Element kind (input, select, checkbox, etc.) */
  kind: string;

  /** Inferred purpose of this field */
  purpose: FieldPurpose;

  /** Constraints on this field */
  constraints: FieldConstraints;

  /** Current state of this field */
  state: FieldState;

  /** Dependencies this field has on other fields */
  depends_on?: FieldDependency[];

  /** EIDs of fields that depend on this field */
  dependents?: string[];

  /** Position in recommended fill order */
  sequence?: number;

  /** Group ID if field is part of a group (e.g., radio group) */
  group_id?: string;
}

/**
 * Inferred purpose of a field.
 */
export interface FieldPurpose {
  /** Semantic type of the field */
  semantic_type: FieldSemanticType;

  /** Confidence in the inferred type (0.0 - 1.0) */
  confidence: number;

  /** Signals that led to this inference */
  inferred_from: string[];
}

/**
 * Semantic types for form fields.
 */
export type FieldSemanticType =
  | 'email'
  | 'phone'
  | 'password'
  | 'password_confirm'
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'username'
  | 'address'
  | 'street'
  | 'city'
  | 'state'
  | 'zip'
  | 'country'
  | 'card_number'
  | 'card_expiry'
  | 'card_cvv'
  | 'date'
  | 'date_of_birth'
  | 'quantity'
  | 'price'
  | 'search'
  | 'comment'
  | 'message'
  | 'url'
  | 'file'
  | 'color'
  | 'selection'
  | 'toggle'
  | 'consent'
  | 'unknown';

/**
 * Constraints on a form field.
 */
export interface FieldConstraints {
  /** Whether the field is required */
  required: boolean;

  /** Confidence in required detection (0.0 - 1.0) */
  required_confidence: number;

  /** Available options for select/radio/combobox */
  options?: FieldOption[];

  /** Minimum length constraint */
  min_length?: number;

  /** Maximum length constraint */
  max_length?: number;

  /** Regex pattern constraint */
  pattern?: string;

  /** Minimum value (for numeric inputs) */
  min_value?: number;

  /** Maximum value (for numeric inputs) */
  max_value?: number;

  /** Step value (for numeric inputs) */
  step?: number;

  /** Accepted file types (for file inputs) */
  accept?: string;
}

/**
 * An option for select/radio/combobox fields.
 */
export interface FieldOption {
  /** Value of the option */
  value: string;

  /** Display label */
  label: string;

  /** Whether this option is selected */
  selected?: boolean;

  /** Whether this option is disabled */
  disabled?: boolean;

  /** EID of the option element (for radio buttons) */
  eid?: string;
}

/**
 * Current state of a form field.
 */
export interface FieldState {
  /**
   * Current value (only included when include_values=true).
   * ALWAYS masked for sensitive fields.
   */
  current_value?: string;

  /**
   * Source of value information:
   * - 'runtime': Read via CDP Runtime (accurate for JS-set values)
   * - 'attribute': From HTML attribute (may be stale)
   * - undefined: Could not determine
   */
  value_source?: 'runtime' | 'attribute';

  /**
   * Whether the field has a non-empty value.
   * Based on runtime read when available.
   */
  has_value: boolean;

  /** Whether the field is considered "filled" for form completion */
  filled: boolean;

  /** Whether the field passes validation */
  valid: boolean;

  /** Validation error message */
  validation_message?: string;

  /** Whether the field is enabled */
  enabled: boolean;

  /** Whether the field has been interacted with */
  touched: boolean;

  /** Whether the field is focused */
  focused: boolean;

  /** Whether the field is visible */
  visible: boolean;
}

// ============================================================================
// FieldDependency Types
// ============================================================================

/**
 * A dependency relationship between fields.
 */
export interface FieldDependency {
  /** EID of the source field that this field depends on */
  source_eid: string;

  /** Type of dependency */
  type: DependencyType;

  /** Confidence in this dependency (0.0 - 1.0) */
  confidence: number;

  /** How this dependency was detected */
  detection_method: DependencyDetectionMethod;

  /** Condition under which the dependency applies */
  condition?: DependencyCondition;
}

/**
 * Type of dependency between fields.
 */
export type DependencyType =
  | 'enables' // Source enables target when condition met
  | 'reveals' // Source reveals target when condition met
  | 'populates' // Source populates options in target
  | 'validates' // Source value affects target validation
  | 'requires'; // Source requires target to have a value

/**
 * How a dependency was detected.
 */
export type DependencyDetectionMethod =
  | 'aria_controls'
  | 'data_attribute'
  | 'observed_mutation'
  | 'observed_state_change'
  | 'structural_inference'
  | 'naming_convention';

/**
 * Condition under which a dependency applies.
 */
export interface DependencyCondition {
  /** When the source field is in this state */
  when_source: 'filled' | 'empty' | 'specific_value' | 'any_change';

  /** Specific values that trigger the dependency */
  specific_values?: string[];
}

// ============================================================================
// FormAction Types
// ============================================================================

/**
 * A submit or action button for a form.
 */
export interface FormAction {
  /** Element ID */
  eid: string;

  /** Backend node ID */
  backend_node_id: number;

  /** Button label */
  label: string;

  /** Type of action */
  type: 'submit' | 'reset' | 'next' | 'back' | 'cancel' | 'action';

  /** Whether the action is enabled */
  enabled: boolean;

  /** Why the action is disabled (if disabled) */
  disabled_reason?: string;

  /** Fields blocking this action */
  blocked_by?: string[];

  /** Whether this is the primary action */
  is_primary: boolean;
}

// ============================================================================
// Observed Dependency Types
// ============================================================================

/**
 * Record of an observed effect after an action.
 */
export interface ObservedEffect {
  /** EID of the element that triggered the effect */
  trigger_eid: string;

  /** Type of action that triggered the effect */
  action_type: 'click' | 'type' | 'select' | 'focus' | 'blur';

  /** Timestamp when effect was observed */
  timestamp: string;

  /** EIDs of elements that became enabled */
  enabled: string[];

  /** EIDs of elements that became disabled */
  disabled: string[];

  /** EIDs of elements that appeared */
  appeared: string[];

  /** EIDs of elements that disappeared */
  disappeared: string[];

  /** EIDs of elements whose values changed */
  value_changed: string[];

  /** Confidence in the causation */
  confidence: number;
}

// ============================================================================
// Tool Response Types
// ============================================================================

/**
 * Response from get_form_understanding tool.
 */
export interface FormUnderstandingResponse {
  /** Page ID */
  page_id: string;

  /** Detected form regions */
  forms: FormRegion[];

  /** Total field count across all forms */
  total_fields: number;

  /** Count of forms detected */
  form_count: number;
}

/**
 * Response from get_field_context tool.
 */
export interface FieldContextResponse {
  /** The requested field */
  field: FormField;

  /** The form containing this field */
  form: FormRegion;

  /** Suggested next action */
  next_action?: {
    type: 'click' | 'type' | 'select';
    eid: string;
    reason: string;
  };
}

/**
 * Action result hints added to click/type responses.
 *
 * @experimental This interface is experimental and may change in future releases.
 * The implementation of action result hints is deferred to a future PR.
 * The dependency tracking mechanism provides the foundation for this feature.
 */
export interface ActionResultHints {
  /** Status of the action */
  status: 'success' | 'failed' | 'partial';

  /** Error message if failed */
  error?: string;

  /** Reason for failure */
  reason?: string;

  /** Prerequisite action needed */
  prerequisite?: {
    eid: string;
    label: string;
    action: 'click' | 'type' | 'select';
  };

  /** Fields that were enabled by this action */
  enabled?: string[];

  /** Fields that were disabled by this action */
  disabled?: string[];

  /** Form progress after this action */
  form_progress?: {
    form_id: string;
    complete: number;
    remaining: number;
    pct: number;
  };

  /** Suggested next action */
  next_suggested?: {
    eid: string;
    label: string;
    reason: string;
  };
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Intermediate form candidate during detection.
 */
export interface FormCandidate {
  /** Potential form root element */
  root_node_id?: string;
  root_backend_node_id?: number;

  /** Detection signals */
  signals: FormSignal[];

  /** Field EIDs in this candidate */
  field_eids: string[];

  /** Computed confidence */
  confidence: number;

  /** Detected intent */
  intent?: FormIntent;

  /** Bounding box */
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Configuration for form detection.
 */
export interface FormDetectionConfig {
  /** Minimum confidence to consider a form region valid */
  min_confidence: number;

  /** Whether to detect formless forms (input clusters without form tag) */
  detect_formless: boolean;

  /** Maximum distance between elements to cluster (in pixels) */
  cluster_distance: number;

  /** Whether to mask sensitive field values */
  mask_sensitive: boolean;
}

/**
 * Default configuration for form detection.
 */
export const DEFAULT_FORM_DETECTION_CONFIG: FormDetectionConfig = {
  min_confidence: 0.3,
  detect_formless: true,
  cluster_distance: 200,
  mask_sensitive: true,
};
