/**
 * FactPack Test Utilities
 *
 * Helper functions for creating test nodes and snapshots for factpack tests.
 */

import type {
  ReadableNode,
  BaseSnapshot,
  NodeKind,
  SemanticRegion,
} from '../../../src/snapshot/snapshot.types.js';

// Counter for generating unique backend node IDs in tests
let testBackendNodeIdCounter = 20000;

/**
 * Reset the backend node ID counter (call in beforeEach)
 */
export function resetBackendNodeIdCounter(): void {
  testBackendNodeIdCounter = 20000;
}

/**
 * Create a minimal ReadableNode for testing
 */
export function createNode(overrides: Partial<ReadableNode> = {}): ReadableNode {
  return {
    node_id: `n${testBackendNodeIdCounter}`,
    backend_node_id: testBackendNodeIdCounter++,
    frame_id: 'test-frame-id',
    loader_id: 'test-loader-id',
    kind: 'generic',
    label: 'Test',
    where: { region: 'main' },
    layout: { bbox: { x: 0, y: 0, w: 100, h: 50 } },
    ...overrides,
  };
}

/**
 * Create a minimal BaseSnapshot for testing
 */
export function createSnapshot(
  nodes: ReadableNode[] = [],
  overrides: Partial<BaseSnapshot> = {}
): BaseSnapshot {
  return {
    snapshot_id: 'test-snapshot',
    url: 'https://example.com',
    title: 'Test Page',
    captured_at: new Date().toISOString(),
    viewport: { width: 1280, height: 720 },
    nodes,
    meta: {
      node_count: nodes.length,
      interactive_count: nodes.filter((n) => isInteractiveKind(n.kind)).length,
    },
    ...overrides,
  };
}

/**
 * Create an empty snapshot for edge case testing
 */
export function createEmptySnapshot(): BaseSnapshot {
  return createSnapshot([]);
}

// ============================================================================
// Dialog Test Helpers
// ============================================================================

/**
 * Create a dialog node
 */
export function createDialogNode(
  label: string,
  overrides: Partial<ReadableNode> = {}
): ReadableNode {
  return createNode({
    kind: 'dialog',
    label,
    where: { region: 'dialog', ...overrides.where },
    state: { visible: true, enabled: true },
    attributes: { role: 'dialog' },
    ...overrides,
  });
}

/**
 * Create an alertdialog node
 */
export function createAlertDialogNode(
  label: string,
  overrides: Partial<ReadableNode> = {}
): ReadableNode {
  return createNode({
    kind: 'dialog',
    label,
    where: { region: 'dialog', ...overrides.where },
    state: { visible: true, enabled: true },
    attributes: { role: 'alertdialog' },
    ...overrides,
  });
}

/**
 * Create a cookie consent dialog with typical content
 */
export function createCookieConsentDialog(): ReadableNode[] {
  const groupId = 'dialog-cookie-consent';
  return [
    createDialogNode('Cookie Consent', {
      node_id: 'dialog-cookie',
      where: { region: 'dialog', group_id: groupId, heading_context: 'Cookie Consent' },
    }),
    createButtonNode('Accept All Cookies', {
      node_id: 'btn-accept-cookies',
      where: { region: 'dialog', group_id: groupId },
    }),
    createButtonNode('Manage Preferences', {
      node_id: 'btn-manage-cookies',
      where: { region: 'dialog', group_id: groupId },
    }),
    createLinkNode('Privacy Policy', {
      node_id: 'link-privacy',
      where: { region: 'dialog', group_id: groupId },
    }),
  ];
}

/**
 * Create a newsletter dialog with typical content
 */
export function createNewsletterDialog(): ReadableNode[] {
  const groupId = 'dialog-newsletter';
  return [
    createDialogNode('Subscribe to our Newsletter', {
      node_id: 'dialog-newsletter',
      where: { region: 'dialog', group_id: groupId, heading_context: 'Subscribe' },
    }),
    createInputNode('Email', 'email', {
      node_id: 'input-newsletter-email',
      where: { region: 'dialog', group_id: groupId },
    }),
    createButtonNode('Subscribe', {
      node_id: 'btn-subscribe',
      where: { region: 'dialog', group_id: groupId },
    }),
    createButtonNode('Close', {
      node_id: 'btn-close-newsletter',
      where: { region: 'dialog', group_id: groupId },
    }),
  ];
}

// ============================================================================
// Form Test Helpers
// ============================================================================

/**
 * Create a form node
 */
export function createFormNode(label: string, overrides: Partial<ReadableNode> = {}): ReadableNode {
  return createNode({
    kind: 'form',
    label,
    where: { region: 'main', ...overrides.where },
    state: { visible: true, enabled: true },
    attributes: { method: 'POST' },
    ...overrides,
  });
}

/**
 * Create an input node
 */
export function createInputNode(
  label: string,
  inputType = 'text',
  overrides: Partial<ReadableNode> = {}
): ReadableNode {
  return createNode({
    kind: 'input',
    label,
    state: { visible: true, enabled: true },
    attributes: { input_type: inputType, ...overrides.attributes },
    find: { primary: `getByLabel('${label}')` },
    ...overrides,
  });
}

/**
 * Create a login form with typical fields
 */
export function createLoginForm(): ReadableNode[] {
  const groupId = 'form-login';
  return [
    createFormNode('Login Form', {
      node_id: 'form-login',
      where: { region: 'main', group_id: groupId, heading_context: 'Sign In' },
    }),
    createInputNode('Email', 'email', {
      node_id: 'input-email',
      where: { region: 'main', group_id: groupId },
      attributes: { input_type: 'email', autocomplete: 'email' },
    }),
    createInputNode('Password', 'password', {
      node_id: 'input-password',
      where: { region: 'main', group_id: groupId },
      attributes: { input_type: 'password', autocomplete: 'current-password' },
    }),
    createButtonNode('Sign In', {
      node_id: 'btn-signin',
      where: { region: 'main', group_id: groupId },
    }),
  ];
}

/**
 * Create a signup form with typical fields
 */
export function createSignupForm(): ReadableNode[] {
  const groupId = 'form-signup';
  return [
    createFormNode('Registration Form', {
      node_id: 'form-signup',
      where: { region: 'main', group_id: groupId, heading_context: 'Create Account' },
    }),
    createInputNode('Full Name', 'text', {
      node_id: 'input-name',
      where: { region: 'main', group_id: groupId },
      attributes: { input_type: 'text', autocomplete: 'name' },
    }),
    createInputNode('Email address', 'email', {
      node_id: 'input-email',
      where: { region: 'main', group_id: groupId },
      attributes: { input_type: 'email', autocomplete: 'email' },
    }),
    createInputNode('Password', 'password', {
      node_id: 'input-password',
      where: { region: 'main', group_id: groupId },
      attributes: { input_type: 'password', autocomplete: 'new-password' },
    }),
    createInputNode('Confirm_password', 'password', {
      // Label uses underscore so pattern /\bconfirm.?pass/i matches
      // No autocomplete so pattern matching is used instead
      node_id: 'input-password-confirm',
      where: { region: 'main', group_id: groupId },
      attributes: { input_type: 'password' },
    }),
    createButtonNode('Create Account', {
      node_id: 'btn-signup',
      where: { region: 'main', group_id: groupId },
    }),
  ];
}

/**
 * Create a search form
 */
export function createSearchForm(): ReadableNode[] {
  const groupId = 'form-search';
  return [
    createFormNode('Search', {
      node_id: 'form-search',
      where: { region: 'search', group_id: groupId },
    }),
    createInputNode('Search', 'search', {
      node_id: 'input-search',
      where: { region: 'search', group_id: groupId },
      attributes: { input_type: 'search', placeholder: 'Search...' },
    }),
    createButtonNode('Search', {
      node_id: 'btn-search',
      where: { region: 'search', group_id: groupId },
    }),
  ];
}

/**
 * Create a checkout form with payment fields
 */
export function createCheckoutForm(): ReadableNode[] {
  const groupId = 'form-checkout';
  return [
    createFormNode('Payment Form', {
      node_id: 'form-checkout',
      where: { region: 'main', group_id: groupId, heading_context: 'Payment Details' },
    }),
    createInputNode('Card Number', 'text', {
      node_id: 'input-card-number',
      where: { region: 'main', group_id: groupId },
      attributes: { input_type: 'text', autocomplete: 'cc-number' },
    }),
    createInputNode('Expiry Date', 'text', {
      node_id: 'input-expiry',
      where: { region: 'main', group_id: groupId },
      attributes: { input_type: 'text', autocomplete: 'cc-exp' },
    }),
    createInputNode('CVV', 'text', {
      node_id: 'input-cvv',
      where: { region: 'main', group_id: groupId },
      attributes: { input_type: 'text', autocomplete: 'cc-csc' },
    }),
    createButtonNode('Pay Now', {
      node_id: 'btn-pay',
      where: { region: 'main', group_id: groupId },
    }),
  ];
}

/**
 * Create a contact form
 */
export function createContactForm(): ReadableNode[] {
  const groupId = 'form-contact';
  return [
    createFormNode('Contact Us', {
      node_id: 'form-contact',
      where: { region: 'main', group_id: groupId, heading_context: 'Contact Us' },
    }),
    createInputNode('Name', 'text', {
      node_id: 'input-name',
      where: { region: 'main', group_id: groupId },
      attributes: { input_type: 'text', autocomplete: 'name' },
    }),
    createInputNode('Email', 'email', {
      node_id: 'input-email',
      where: { region: 'main', group_id: groupId },
      attributes: { input_type: 'email', autocomplete: 'email' },
    }),
    createNode({
      node_id: 'textarea-message',
      kind: 'textarea',
      label: 'Message',
      where: { region: 'main', group_id: groupId },
      state: { visible: true, enabled: true },
    }),
    createButtonNode('Send Message', {
      node_id: 'btn-send',
      where: { region: 'main', group_id: groupId },
    }),
  ];
}

// ============================================================================
// Button/Link/Interactive Helpers
// ============================================================================

/**
 * Create a button node
 */
export function createButtonNode(
  label: string,
  overrides: Partial<ReadableNode> = {}
): ReadableNode {
  return createNode({
    kind: 'button',
    label,
    state: { visible: true, enabled: true },
    find: { primary: `getByRole('button', { name: '${label}' })` },
    ...overrides,
  });
}

/**
 * Create a link node
 */
export function createLinkNode(label: string, overrides: Partial<ReadableNode> = {}): ReadableNode {
  return createNode({
    kind: 'link',
    label,
    state: { visible: true, enabled: true },
    attributes: { href: '#' },
    find: { primary: `getByRole('link', { name: '${label}' })` },
    ...overrides,
  });
}

/**
 * Create a heading node
 */
export function createHeadingNode(
  label: string,
  level = 1,
  overrides: Partial<ReadableNode> = {}
): ReadableNode {
  return createNode({
    kind: 'heading',
    label,
    attributes: { heading_level: level },
    ...overrides,
  });
}

/**
 * Create a tab node
 */
export function createTabNode(
  label: string,
  selected = false,
  overrides: Partial<ReadableNode> = {}
): ReadableNode {
  return createNode({
    kind: 'tab',
    label,
    state: { visible: true, enabled: true, selected },
    ...overrides,
  });
}

/**
 * Create a checkbox node
 */
export function createCheckboxNode(
  label: string,
  checked = false,
  overrides: Partial<ReadableNode> = {}
): ReadableNode {
  return createNode({
    kind: 'checkbox',
    label,
    state: { visible: true, enabled: true, checked },
    ...overrides,
  });
}

/**
 * Create a select node
 */
export function createSelectNode(
  label: string,
  overrides: Partial<ReadableNode> = {}
): ReadableNode {
  return createNode({
    kind: 'select',
    label,
    state: { visible: true, enabled: true },
    ...overrides,
  });
}

// ============================================================================
// Page Structure Helpers
// ============================================================================

/**
 * Create a navigation region with links
 */
export function createNavigation(links: string[]): ReadableNode[] {
  const groupId = 'nav-main';
  return [
    createNode({
      node_id: 'nav-main',
      kind: 'navigation',
      label: 'Main Navigation',
      where: { region: 'nav', group_id: groupId },
    }),
    ...links.map((label, i) =>
      createLinkNode(label, {
        node_id: `nav-link-${i}`,
        where: { region: 'nav', group_id: groupId },
      })
    ),
  ];
}

/**
 * Create a header region
 */
export function createHeader(): ReadableNode[] {
  return [
    createHeadingNode('Site Title', 1, {
      node_id: 'header-title',
      where: { region: 'header' },
    }),
    createLinkNode('Logo', {
      node_id: 'header-logo',
      where: { region: 'header' },
    }),
    ...createSearchForm().map((n) => ({
      ...n,
      where: { ...n.where, region: 'header' as SemanticRegion },
    })),
  ];
}

/**
 * Create a footer region
 */
export function createFooter(): ReadableNode[] {
  return [
    createNode({
      node_id: 'footer',
      kind: 'section',
      label: 'Footer',
      where: { region: 'footer' },
    }),
    createLinkNode('Privacy Policy', {
      node_id: 'footer-privacy',
      where: { region: 'footer' },
    }),
    createLinkNode('Terms of Service', {
      node_id: 'footer-terms',
      where: { region: 'footer' },
    }),
    createLinkNode('Contact', {
      node_id: 'footer-contact',
      where: { region: 'footer' },
    }),
  ];
}

// ============================================================================
// Page Type Test Fixtures
// ============================================================================

/**
 * Create a product page snapshot
 */
export function createProductPageSnapshot(): BaseSnapshot {
  const nodes: ReadableNode[] = [
    ...createNavigation(['Home', 'Shop', 'About']),
    createHeadingNode('Premium Running Shoes', 1, {
      node_id: 'product-title',
      where: { region: 'main' },
    }),
    createNode({
      node_id: 'product-price',
      kind: 'text',
      label: '$129.99',
      where: { region: 'main' },
    }),
    createButtonNode('Add to Cart', {
      node_id: 'btn-add-to-cart',
      where: { region: 'main' },
      layout: { bbox: { x: 100, y: 300, w: 200, h: 50 } },
    }),
    createButtonNode('Buy Now', {
      node_id: 'btn-buy-now',
      where: { region: 'main' },
    }),
    createSelectNode('Size', {
      node_id: 'select-size',
      where: { region: 'main' },
    }),
    ...createFooter(),
  ];

  return createSnapshot(nodes, {
    // Use /product/ (singular) to match URL pattern
    url: 'https://shop.example.com/product/running-shoes',
    title: 'Premium Running Shoes - Shop',
  });
}

/**
 * Create a login page snapshot
 */
export function createLoginPageSnapshot(): BaseSnapshot {
  const nodes: ReadableNode[] = [
    createHeadingNode('Sign In', 1, {
      node_id: 'login-title',
      where: { region: 'main' },
    }),
    ...createLoginForm(),
    createLinkNode('Forgot Password?', {
      node_id: 'link-forgot-password',
      where: { region: 'main' },
    }),
    createLinkNode('Create Account', {
      node_id: 'link-create-account',
      where: { region: 'main' },
    }),
  ];

  return createSnapshot(nodes, {
    url: 'https://example.com/login',
    title: 'Sign In - Example',
  });
}

/**
 * Create a search results page snapshot
 */
export function createSearchResultsSnapshot(): BaseSnapshot {
  const nodes: ReadableNode[] = [
    ...createNavigation(['Home', 'Shop']),
    ...createSearchForm(),
    createHeadingNode('Search Results for "shoes"', 1, {
      node_id: 'search-results-title',
      where: { region: 'main' },
    }),
    createNode({
      node_id: 'result-count',
      kind: 'text',
      label: '42 results found',
      where: { region: 'main' },
    }),
    // Product cards
    ...Array.from({ length: 5 }, (_, i) =>
      createLinkNode(`Product ${i + 1}`, {
        node_id: `product-link-${i}`,
        where: { region: 'main', group_id: `product-card-${i}` },
      })
    ),
    ...createFooter(),
  ];

  return createSnapshot(nodes, {
    url: 'https://example.com/search?q=shoes',
    title: 'Search Results - Example',
  });
}

/**
 * Create an article page snapshot
 */
export function createArticlePageSnapshot(): BaseSnapshot {
  const nodes: ReadableNode[] = [
    ...createNavigation(['Home', 'Blog', 'About']),
    createHeadingNode('How to Choose Running Shoes', 1, {
      node_id: 'article-title',
      where: { region: 'main' },
    }),
    createNode({
      node_id: 'article-date',
      kind: 'text',
      label: 'Published: January 1, 2024',
      where: { region: 'main' },
    }),
    createNode({
      node_id: 'article-body',
      kind: 'paragraph',
      label: 'When choosing running shoes, consider your foot type...',
      where: { region: 'main' },
    }),
    ...createFooter(),
  ];

  return createSnapshot(nodes, {
    url: 'https://example.com/blog/how-to-choose-running-shoes',
    title: 'How to Choose Running Shoes - Blog',
  });
}

/**
 * Create a 404 error page snapshot
 */
export function createErrorPageSnapshot(): BaseSnapshot {
  const nodes: ReadableNode[] = [
    createHeadingNode('404 - Page Not Found', 1, {
      node_id: 'error-title',
      where: { region: 'main' },
    }),
    createNode({
      node_id: 'error-message',
      kind: 'paragraph',
      label: 'The page you are looking for does not exist.',
      where: { region: 'main' },
    }),
    createLinkNode('Go to Homepage', {
      node_id: 'link-home',
      where: { region: 'main' },
    }),
  ];

  return createSnapshot(nodes, {
    url: 'https://example.com/nonexistent',
    title: '404 - Not Found',
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

function isInteractiveKind(kind: NodeKind): boolean {
  const interactiveKinds: NodeKind[] = [
    'link',
    'button',
    'input',
    'textarea',
    'select',
    'combobox',
    'checkbox',
    'radio',
    'switch',
    'slider',
    'tab',
    'menuitem',
  ];
  return interactiveKinds.includes(kind);
}
