/**
 * Kind Mapping
 *
 * Maps AX roles and HTML tags to NodeKind values.
 *
 * @module snapshot/kind-mapping
 */

import type { NodeKind, SnapshotOptions } from './snapshot.types.js';

/**
 * Snapshot compiler options
 */
export interface CompileOptions extends Partial<SnapshotOptions> {
  /** Include readable content nodes (headings, paragraphs). Default: true */
  includeReadable?: boolean;
  /** Extract bounding boxes and layout info. Default: true */
  includeLayout?: boolean;
}

/**
 * Default compile options
 */
export const DEFAULT_OPTIONS: Required<CompileOptions> = {
  include_hidden: false,
  max_nodes: 2000,
  timeout: 30000,
  redact_sensitive: true,
  include_values: true, // Enable value extraction with password redaction
  includeReadable: true,
  includeLayout: true,
};

/** AX role → NodeKind lookup (hoisted to avoid per-call allocation) */
const ROLE_TO_KIND: Record<string, NodeKind> = {
  // Interactive
  button: 'button',
  link: 'link',
  textbox: 'input',
  searchbox: 'input',
  combobox: 'combobox',
  listbox: 'select',
  checkbox: 'checkbox',
  radio: 'radio',
  switch: 'switch',
  slider: 'slider',
  spinbutton: 'slider',
  tab: 'tab',
  menuitem: 'menuitem',
  menuitemcheckbox: 'menuitem',
  menuitemradio: 'menuitem',
  option: 'menuitem',
  // Readable
  heading: 'heading',
  paragraph: 'paragraph',
  text: 'text',
  statictext: 'text',
  list: 'list',
  listitem: 'listitem',
  tree: 'list',
  treeitem: 'listitem',
  image: 'image',
  img: 'image',
  figure: 'image',
  canvas: 'canvas',
  table: 'table',
  grid: 'table',
  treegrid: 'table',
  // Structural
  form: 'form',
  dialog: 'dialog',
  alertdialog: 'dialog',
  navigation: 'navigation',
  region: 'section',
  article: 'section',
  main: 'section',
  banner: 'section',
  complementary: 'section',
  contentinfo: 'section',
  // Live region / ephemeral feedback
  alert: 'alert',
  status: 'status',
  log: 'log',
  marquee: 'log',
  timer: 'timer',
  tooltip: 'tooltip',
  progressbar: 'progressbar',
};

/** HTML tag → NodeKind lookup (hoisted to avoid per-call allocation) */
const TAG_TO_KIND: Record<string, NodeKind> = {
  BUTTON: 'button',
  A: 'link',
  INPUT: 'input',
  TEXTAREA: 'textarea',
  SELECT: 'select',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  P: 'paragraph',
  IMG: 'image',
  TABLE: 'table',
  UL: 'list',
  OL: 'list',
  LI: 'listitem',
  FORM: 'form',
  DIALOG: 'dialog',
  NAV: 'navigation',
  OPTION: 'menuitem',
  CANVAS: 'canvas',
};

/**
 * Map AX role to NodeKind.
 */
export function mapRoleToKind(role: string | undefined): NodeKind | undefined {
  if (!role) return undefined;
  return ROLE_TO_KIND[role.toLowerCase()];
}

/**
 * Get NodeKind from HTML tag name.
 */
export function getKindFromTag(tagName: string): NodeKind | undefined {
  return TAG_TO_KIND[tagName.toUpperCase()];
}
