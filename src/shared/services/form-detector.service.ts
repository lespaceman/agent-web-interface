/**
 * Form Detector Service
 *
 * CRITICAL FIX #4: Replaces the stub implementation that returned empty fields/submitButtons
 *
 * Detects form fields and submit buttons in the DOM using multiple strategies:
 * - Direct form element analysis
 * - Input element discovery outside forms
 * - Accessibility tree integration
 * - Submit button detection (button[type=submit], input[type=submit], etc.)
 */

import type { ElementRef, DomTreeNode, AxTreeNode, LocatorHint } from '../types/index.js';

interface CdpBridge {
  executeDevToolsMethod<T>(method: string, params?: unknown): Promise<T>;
}

interface SelectorBuilder {
  buildSelectors(
    nodeId: number,
    frameId: string
  ): Promise<{ css?: string; xpath?: string; ax?: string }>;
}

interface VisibilityChecker {
  isVisible(element: ElementRef): Promise<boolean>;
}

/**
 * Represents a detected form field
 */
export interface FormField {
  element: ElementRef;
  type: string; // input type: text, email, password, checkbox, etc.
  label?: string; // associated label text
  name?: string; // field name attribute
  placeholder?: string; // placeholder text
  required: boolean; // whether field is required
  value?: string; // current value
}

/**
 * Represents a detected submit button
 */
export interface SubmitButton {
  element: ElementRef;
  text?: string; // button text content
  type: string; // 'submit' | 'button' | 'input'
}

/**
 * Form detection result
 */
export interface FormDetectionResult {
  fields: FormField[];
  submitButtons: SubmitButton[];
  formElement?: ElementRef; // the form element itself, if found
}

const ARIA_INPUT_ROLES = new Set([
  'radio',
  'checkbox',
  'switch',
  'combobox',
  'option',
  'menuitemradio',
  'menuitemcheckbox',
  'tab',
]);

/**
 * Form Detector Service
 *
 * This is one of the 4 critical fixes for the failing tests
 */
export class FormDetectorService {
  constructor(
    private readonly cdpBridge: CdpBridge,
    private readonly selectorBuilder: SelectorBuilder,
    private readonly visibilityChecker: VisibilityChecker
  ) {}

  /**
   * Detect all form fields and submit buttons in the given scope
   *
   * @param domTree - DOM tree to analyze
   * @param axTree - Accessibility tree for label detection
   * @param scope - Optional scope to limit detection
   * @param visibleOnly - Only return visible fields (default: true)
   */
  async detect(
    domTree: { nodes: DomTreeNode[] },
    axTree: { nodes: AxTreeNode[] },
    scope?: LocatorHint,
    visibleOnly = true
  ): Promise<FormDetectionResult> {
    // Step 1: Find all form elements
    const formElements = this.findFormElements(domTree.nodes);

    // Step 2: Find all input elements (both inside and outside forms)
    const inputElements = this.findInputElements(domTree.nodes);

    // Step 3: Find all submit buttons
    const submitButtonElements = this.findSubmitButtons(domTree.nodes);

    // Step 4: Build ElementRefs for all found elements
    const fields = await this.buildFormFields(inputElements, axTree.nodes, visibleOnly);
    const submitButtons = await this.buildSubmitButtons(submitButtonElements, visibleOnly);

    // Step 5: Find the form element if it exists
    let formElement: ElementRef | undefined;
    if (formElements.length > 0 && formElements[0].nodeId) {
      const selectors = await this.selectorBuilder.buildSelectors(formElements[0].nodeId, 'main');
      formElement = {
        frameId: 'main',
        nodeId: formElements[0].nodeId,
        selectors,
        role: 'form',
      };
    }

    // Step 6: Filter by scope if provided
    if (scope && 'css' in scope && scope.css) {
      // TODO: Implement scope filtering
      // For now, return all results
    }

    return {
      fields,
      submitButtons,
      formElement,
    };
  }

  /**
   * Find all form elements in the DOM tree
   */
  private findFormElements(nodes: DomTreeNode[]): DomTreeNode[] {
    const forms: DomTreeNode[] = [];

    const traverse = (node: DomTreeNode) => {
      if (node.tag === 'form') {
        forms.push(node);
      }
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    for (const node of nodes) {
      traverse(node);
    }

    return forms;
  }

  /**
   * Find all input elements in the DOM tree
   */
  private findInputElements(nodes: DomTreeNode[]): DomTreeNode[] {
    const inputs: DomTreeNode[] = [];

    // Input types we're interested in
    const inputTags = ['input', 'textarea', 'select'];

    const traverse = (node: DomTreeNode) => {
      if (inputTags.includes(node.tag) || this.isAriaInput(node)) {
        inputs.push(node);
      }
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    for (const node of nodes) {
      traverse(node);
    }

    return inputs;
  }

  /**
   * Determine if a DOM node behaves like an input via ARIA role or data attributes
   */
  private isAriaInput(node: DomTreeNode): boolean {
    const role = this.getAttribute(node, 'role')?.toLowerCase();
    const dataAutom = this.getAttribute(node, 'data-autom')?.toLowerCase();

    if (role && ARIA_INPUT_ROLES.has(role)) {
      return true;
    }

    if (dataAutom?.startsWith('dimension')) {
      return true;
    }

    return false;
  }

  /**
   * Find all submit buttons in the DOM tree
   */
  private findSubmitButtons(nodes: DomTreeNode[]): DomTreeNode[] {
    const buttons: DomTreeNode[] = [];

    const traverse = (node: DomTreeNode) => {
      // Check for button elements
      if (node.tag === 'button') {
        const typeAttr = this.getAttribute(node, 'type');
        // Default button type is 'submit'
        if (!typeAttr || typeAttr === 'submit') {
          buttons.push(node);
        }
      }

      // Check for input[type=submit] or input[type=button]
      if (node.tag === 'input') {
        const typeAttr = this.getAttribute(node, 'type');
        if (typeAttr === 'submit' || typeAttr === 'button') {
          buttons.push(node);
        }
      }

      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    for (const node of nodes) {
      traverse(node);
    }

    return buttons;
  }

  /**
   * Build FormField objects from input elements
   */
  private async buildFormFields(
    inputElements: DomTreeNode[],
    axNodes: AxTreeNode[],
    visibleOnly: boolean
  ): Promise<FormField[]> {
    const fields: FormField[] = [];

    for (const node of inputElements) {
      if (!node.nodeId) continue;

      // Build selectors
      const selectors = await this.selectorBuilder.buildSelectors(node.nodeId, 'main');

      // Get attributes
      const type = this.inferFieldType(node);
      const name =
        this.getAttribute(node, 'name') ??
        this.getAttribute(node, 'data-autom') ??
        this.getAttribute(node, 'id');
      const placeholder = this.getAttribute(node, 'placeholder');
      const required = this.hasAttribute(node, 'required');
      const value = this.getAttribute(node, 'value');

      // Find associated label from accessibility tree or fallback to aria-label
      const label =
        this.findLabelForInput(node, axNodes) ??
        this.findAccessibleNameForNode(node, axNodes) ??
        this.getAttribute(node, 'aria-label');

      // Create ElementRef
      const element: ElementRef = {
        frameId: 'main',
        nodeId: node.nodeId,
        selectors,
        label,
        name,
      };

      // Check visibility if required
      if (visibleOnly) {
        const isVisible = await this.visibilityChecker.isVisible(element);
        if (!isVisible) continue;
      }

      fields.push({
        element,
        type,
        label,
        name,
        placeholder,
        required,
        value,
      });
    }

    return fields;
  }

  /**
   * Build SubmitButton objects from button elements
   */
  private async buildSubmitButtons(
    buttonElements: DomTreeNode[],
    visibleOnly: boolean
  ): Promise<SubmitButton[]> {
    const buttons: SubmitButton[] = [];

    for (const node of buttonElements) {
      if (!node.nodeId) continue;

      // Build selectors
      const selectors = await this.selectorBuilder.buildSelectors(node.nodeId, 'main');

      // Get button text
      const text = await this.getButtonText(node);

      // Get button type
      const type = node.tag === 'button' ? 'button' : 'input';

      // Create ElementRef
      const element: ElementRef = {
        frameId: 'main',
        nodeId: node.nodeId,
        selectors,
        label: text,
      };

      // Check visibility if required
      if (visibleOnly) {
        const isVisible = await this.visibilityChecker.isVisible(element);
        if (!isVisible) continue;
      }

      buttons.push({
        element,
        text,
        type,
      });
    }

    return buttons;
  }

  /**
   * Find label text for an input element from accessibility tree
   */
  private findLabelForInput(inputNode: DomTreeNode, axNodes: AxTreeNode[]): string | undefined {
    // First try to find by ID
    const inputId = this.getAttribute(inputNode, 'id');
    if (inputId) {
      // Look for label[for=inputId]
      const label = axNodes.find(
        (n) =>
          n.role === 'LabelText' &&
          n.properties?.some((p) => p.name === 'for' && p.value === inputId)
      );
      if (label) {
        return label.name;
      }
    }

    // Try to find by aria-label
    const ariaLabel = this.getAttribute(inputNode, 'aria-label');
    if (ariaLabel) {
      return ariaLabel;
    }

    // Try to find parent label
    // Note: This requires DOM parent traversal which we'll skip for now
    return undefined;
  }

  /**
   * Use accessibility tree to find computed name for custom controls
   */
  private findAccessibleNameForNode(node: DomTreeNode, axNodes: AxTreeNode[]): string | undefined {
    if (!node.nodeId) return undefined;
    const match = axNodes.find((axNode) => axNode.backendDOMNodeId === node.nodeId);
    return match?.name;
  }

  /**
   * Infer an input "type" for non-standard controls
   */
  private inferFieldType(node: DomTreeNode): string {
    const explicitType = this.getAttribute(node, 'type');
    if (explicitType) {
      return explicitType;
    }

    const role = this.getAttribute(node, 'role');
    if (role && ARIA_INPUT_ROLES.has(role.toLowerCase())) {
      return role;
    }

    const dataAutom = this.getAttribute(node, 'data-autom');
    if (dataAutom?.includes('dimensioncolor') || dataAutom?.includes('dimensioncapacity')) {
      return 'radio';
    }

    if (node.tag === 'button') {
      return 'button';
    }

    return 'text';
  }

  /**
   * Get button text content
   */
  private async getButtonText(buttonNode: DomTreeNode): Promise<string | undefined> {
    // For input[type=submit], check value attribute
    if (buttonNode.tag === 'input') {
      return this.getAttribute(buttonNode, 'value');
    }

    // For button elements, we need to get text content
    // This requires evaluating JavaScript to get textContent
    if (buttonNode.nodeId) {
      try {
        const result = await this.cdpBridge.executeDevToolsMethod<{
          result: { value?: string };
        }>('Runtime.evaluate', {
          expression: `
            (function() {
              const node = document.querySelector('[data-backend-node-id="${buttonNode.nodeId}"]');
              return node ? node.textContent?.trim() : undefined;
            })()
          `,
          returnByValue: true,
        });

        return result.result.value;
      } catch {
        // Fallback: try to get from child text nodes
        return this.getTextFromChildren(buttonNode);
      }
    }

    return undefined;
  }

  /**
   * Get text content from child text nodes
   */
  private getTextFromChildren(node: DomTreeNode): string | undefined {
    if (!node.children) return undefined;

    const textNodes = node.children.filter((child) => child.tag === '#text');
    if (textNodes.length > 0) {
      return textNodes
        .map((n) => n.text ?? '')
        .join(' ')
        .trim();
    }

    return undefined;
  }

  /**
   * Get attribute value from DOM node
   */
  private getAttribute(node: DomTreeNode, name: string): string | undefined {
    if (!node.attrs) return undefined;

    const index = node.attrs.indexOf(name);
    if (index !== -1 && index + 1 < node.attrs.length) {
      return node.attrs[index + 1];
    }

    return undefined;
  }

  /**
   * Check if attribute exists on DOM node
   */
  private hasAttribute(node: DomTreeNode, name: string): boolean {
    if (!node.attrs) return false;
    return node.attrs.includes(name);
  }
}
