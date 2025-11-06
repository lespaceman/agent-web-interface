/**
 * Perception Domain Types
 *
 * Types for DOM, Accessibility, Layout, Vision, Network, and Content extraction tools
 */

import type {
  BBox,
  ElementRef,
  LocatorHint,
  DomTreeNode,
  AxTreeNode,
  NetworkEvent,
} from '../../shared/types/index.js';

// ===== DOM TREE =====

export interface DomGetTreeParams {
  frameId?: string;
  depth?: number;
  visibleOnly?: boolean;
}

export interface DomGetTreeResponse {
  nodes: DomTreeNode[];
}

// ===== ACCESSIBILITY TREE =====

export interface AxGetTreeParams {
  frameId?: string;
}

export interface AxGetTreeResponse {
  nodes: AxTreeNode[];
}

// ===== LAYOUT =====

export interface LayoutGetBoxModelParams {
  target: ElementRef | LocatorHint;
}

export interface LayoutGetBoxModelResponse {
  quad: number[];
  bbox: BBox;
}

export interface LayoutIsVisibleParams {
  target: ElementRef | LocatorHint;
}

export interface LayoutIsVisibleResponse {
  visible: boolean;
}

// ===== UI DISCOVERY =====

export interface UiDiscoverParams {
  scope?: LocatorHint;
}

export interface UiDiscoverResponse {
  elements: ElementRef[];
}

// ===== VISION (OCR) =====

export interface VisionOcrParams {
  region?: BBox;
}

export interface VisionOcrResponse {
  text: string;
  spans: {
    text: string;
    bbox: BBox;
    confidence?: number;
  }[];
}

export interface VisionFindByTextParams {
  text: string;
  fuzzy?: boolean;
  areaHint?: BBox;
}

export interface VisionFindByTextResponse {
  element: ElementRef | null;
}

// ===== NETWORK =====

export interface NetObserveParams {
  patterns?: string[];
}

export interface NetObserveResponse {
  events: AsyncIterable<NetworkEvent>;
}

export interface NetGetResponseBodyParams {
  requestId: string;
}

export interface NetGetResponseBodyResponse {
  body: string;
  base64Encoded: boolean;
}

// ===== CONTENT EXTRACTION =====

export interface ContentExtractMainParams {
  mode?: 'readability' | 'trafilatura';
}

export interface ContentExtractMainResponse {
  title: string;
  author?: string;
  content: string;
  textContent: string;
  excerpt?: string;
  siteName?: string;
}

export interface ContentToTextParams {
  html: string;
  mode?: 'inscriptis' | 'html-text';
}

export interface ContentToTextResponse {
  text: string;
}
