/**
 * Interaction Domain Types
 *
 * Types for click, type, select, scroll, upload, form, and keyboard tools
 */

import type { ElementRef, LocatorHint } from '../../shared/types/index.js';

// ===== TARGET RESOLUTION =====

export interface TargetsResolveParams {
  hint: LocatorHint;
  frameId?: string;
}

export interface TargetsResolveResponse {
  element: ElementRef;
}

// ===== ACTIONS =====

export interface ActClickParams {
  target: ElementRef | LocatorHint;
  strategy?: 'ax' | 'dom' | 'bbox';
  frameId?: string;
  waitAfterMs?: number;
}

export interface ActClickResponse {
  success: boolean;
  target?: ElementRef;
  error?: string;
}

export interface ActTypeParams {
  target: ElementRef | LocatorHint;
  text: string;
  submit?: 'Enter' | 'Tab' | null;
  clearFirst?: boolean;
  pressEnterAfter?: boolean;
  simulateTyping?: boolean;
  frameId?: string;
}

export interface ActTypeResponse {
  success: boolean;
  target?: ElementRef;
  error?: string;
}

export interface ActSelectParams {
  target: ElementRef;
  value?: string;
  label?: string;
  index?: number;
}

export interface ActSelectResponse {
  success: boolean;
}

export interface ActScrollIntoViewParams {
  target: ElementRef | LocatorHint;
  center?: boolean;
  frameId?: string;
}

export interface ActScrollIntoViewResponse {
  success: boolean;
  target?: ElementRef;
  error?: string;
}

export interface ActUploadParams {
  target: ElementRef | LocatorHint;
  files: string[];
  frameId?: string;
}

export interface ActUploadResponse {
  success: boolean;
  target?: ElementRef;
  filesUploaded?: number;
  error?: string;
}

// ===== FORMS =====

export interface FormField {
  element: ElementRef;
  type: string;
  label?: string;
  name?: string;
  placeholder?: string;
  required: boolean;
  value?: string;
}

export interface SubmitButton {
  element: ElementRef;
  text?: string;
  type: string;
}

export interface FormDetectParams {
  scope?: LocatorHint;
  frameId?: string;
  visibleOnly?: boolean;
  maxDepth?: number;
}

export interface FormDetectResponse {
  forms: {
    element: ElementRef;
    fields: FormField[];
    submitButton?: SubmitButton;
  }[];
}

export interface FormFillParams {
  fields: Record<string, string>;
  scope?: LocatorHint;
  submit?: boolean;
  frameId?: string;
}

export interface FormFillResponse {
  success: boolean;
  results?: { field: string; success: boolean; error?: string }[];
  error?: string;
}

export interface FormSubmitParams {
  strategy?: 'button' | 'formRequestSubmit';
}

export interface FormSubmitResponse {
  success: boolean;
}

// ===== KEYBOARD =====

export interface KbPressParams {
  key: string;
  code?: string;
  modifiers?: ('Alt' | 'Ctrl' | 'Meta' | 'Shift')[];
  delayMs?: number;
}

export interface KbPressResponse {
  success: boolean;
  error?: string;
}

export interface KbHotkeyParams {
  hotkey:
    | 'copy'
    | 'paste'
    | 'cut'
    | 'selectAll'
    | 'undo'
    | 'redo'
    | 'save'
    | 'find'
    | 'refresh'
    | 'newTab'
    | 'closeTab';
}

export interface KbHotkeyResponse {
  success: boolean;
  error?: string;
}
