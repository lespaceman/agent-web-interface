/**
 * Strongly typed definitions for Browser Automation MCP tools.
 */

// Shared domain types -------------------------------------------------------

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Selectors {
  ax?: string;
  css?: string;
  xpath?: string;
}

export interface ElementRef {
  frameId: string;
  nodeId?: number;
  selectors: Selectors;
  bbox?: BBox;
  role?: string;
  label?: string;
  name?: string;
}

export type LocatorHint =
  | {
      role?: string;
      label?: string;
      name?: string;
      nearText?: string;
    }
  | {
      css?: string;
      xpath?: string;
      ax?: string;
    }
  | {
      bbox?: BBox;
    };

export interface DomTreeNode {
  id: string;
  tag: string;
  attrs: Record<string, string>;
  text?: string;
  children: DomTreeNode[];
}

export interface AxTreeNode {
  nodeId: string;
  role: string;
  name?: string;
  states?: string[];
  relationships?: Record<string, string[]>;
}

export interface NetworkEvent {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  headers?: Record<string, string>;
}

export interface BrowserCookie extends Record<string, unknown> {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  expires?: number;
}

export interface SessionState {
  cookies: BrowserCookie[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export interface SiteProfile {
  knownSelectors?: Record<string, LocatorHint>;
  flows?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type StorageSnapshot = Record<string, string>;

export type NavWaitCondition = 'network-idle' | 'selector' | 'ax-role' | 'route-change';

export type WaitMatch =
  | { type: 'network-idle' }
  | { type: 'selector'; selector: string }
  | { type: 'ax-role'; roleName: string }
  | { type: 'route-change'; url: string };

// Tool parameter types ------------------------------------------------------

export interface DomGetTreeParams {
  frameId?: string;
  depth?: number;
  visibleOnly?: boolean;
}

export interface AxGetTreeParams {
  frameId?: string;
}

export interface LayoutGetBoxModelParams {
  target: ElementRef | LocatorHint;
}

export interface LayoutIsVisibleParams {
  target: ElementRef | LocatorHint;
}

export interface UiDiscoverParams {
  scope?: LocatorHint;
}

export interface VisionOcrParams {
  region?: BBox;
}

export interface VisionFindByTextParams {
  text: string;
  fuzzy?: boolean;
  areaHint?: BBox;
}

export interface NetObserveParams {
  patterns?: string[];
}

export interface NetGetResponseBodyParams {
  requestId: string;
}

export interface ContentExtractMainParams {
  mode?: 'readability' | 'trafilatura';
}

export interface ContentToTextParams {
  html: string;
  mode?: 'inscriptis' | 'html-text';
}

export interface TargetsResolveParams {
  hint: LocatorHint;
}

export interface ActClickParams {
  target: ElementRef;
  strategy?: 'ax' | 'dom' | 'bbox';
}

export interface ActTypeParams {
  target: ElementRef;
  text: string;
  submit?: 'Enter' | 'Tab' | null;
}

export interface ActSelectParams {
  target: ElementRef;
  value?: string;
  label?: string;
  index?: number;
}

export interface ActScrollIntoViewParams {
  target: ElementRef;
  center?: boolean;
}

export interface ActUploadParams {
  target: ElementRef;
  files: string[];
}

export interface NavGotoParams {
  url: string;
}

export interface NavWaitParams {
  for: NavWaitCondition;
  selector?: string;
  roleName?: string;
  timeoutMs?: number;
}

export interface NavFrameParams {
  selector?: string;
  urlContains?: string;
  name?: string;
}

export interface FormDetectParams {
  scope?: LocatorHint;
}

export interface FormFillParams {
  pairs: {
    slot: string;
    text: string;
  }[];
  scope?: LocatorHint;
}

export interface FormSubmitParams {
  strategy?: 'button' | 'formRequestSubmit';
}

export interface KbdPressParams {
  sequence: string[];
}

export interface KbdTypeParams {
  text: string;
}

export interface SessionSaveParams {
  domain: string;
}

export interface SessionRestoreParams {
  state: SessionState;
}

export interface SessionCookiesSetParams {
  cookies: BrowserCookie[];
}

export interface MemoryGetSiteProfileParams {
  domain: string;
}

export interface MemoryPutSiteProfileParams {
  domain: string;
  profile: SiteProfile;
}

export interface SafetySetPolicyParams {
  allowlist: string[];
  actionBudgetPerMinute: number;
  blockedPatterns?: string[];
}

export interface AuditSnapshotParams {
  label: string;
}

// Tool response types -------------------------------------------------------

export interface DomGetTreeResponse {
  nodes: DomTreeNode[];
}

export interface AxGetTreeResponse {
  nodes: AxTreeNode[];
}

export interface LayoutGetBoxModelResponse {
  quad: number[];
  bbox: BBox;
}

export interface LayoutIsVisibleResponse {
  visible: boolean;
}

export interface UiDiscoverResponse {
  elements: ElementRef[];
}

export interface VisionOcrResponse {
  text: string;
  spans: {
    text: string;
    bbox: BBox;
    confidence?: number;
  }[];
}

export interface VisionFindByTextResponse {
  element: ElementRef | null;
}

export interface NetObserveResponse {
  events: AsyncIterable<NetworkEvent>;
}

export interface NetGetResponseBodyResponse {
  body: string;
  base64Encoded: boolean;
}

export interface ContentExtractMainResponse {
  title?: string;
  html: string;
  text: string;
}

export interface ContentToTextResponse {
  text: string;
}

export interface TargetsResolveResponse {
  element: ElementRef;
}

export interface ActClickResponse {
  success: boolean;
}

export interface ActTypeResponse {
  success: boolean;
}

export interface ActSelectResponse {
  success: boolean;
}

export interface ActScrollIntoViewResponse {
  success: boolean;
}

export interface ActUploadResponse {
  success: boolean;
}

export interface NavGotoResponse {
  success: boolean;
}

export interface NavWaitResponse {
  success: boolean;
  matched?: WaitMatch;
}

export interface NavFrameResponse {
  frameId: string;
}

export interface FormDetectResponse {
  fields: ElementRef[];
  submitButtons: ElementRef[];
}

export interface FormFillResponse {
  success: boolean;
  filled: string[];
}

export interface FormSubmitResponse {
  success: boolean;
}

export interface SessionSaveResponse {
  state: SessionState;
}

export interface SessionRestoreResponse {
  success: boolean;
}

export interface SessionCookiesGetResponse {
  cookies: BrowserCookie[];
}

export interface SessionCookiesSetResponse {
  success: boolean;
}

export interface SessionCookiesClearResponse {
  success: boolean;
}

export interface MemoryGetSiteProfileResponse {
  profile: SiteProfile | null;
}

export interface MemoryPutSiteProfileResponse {
  success: boolean;
}

export interface SafetySetPolicyResponse {
  success: boolean;
}

export interface AuditSnapshotResponse {
  screenshotPath: string;
  domDigestPath: string;
  harPath?: string;
  timestamp: string;
}

// MCP tool call/response envelopes -----------------------------------------

export interface MCPToolCall<T = unknown> {
  name: string;
  arguments: T;
}

export interface MCPToolResponse {
  content: {
    type: 'text';
    text: string;
  }[];
  isError?: boolean;
}

// Helper types --------------------------------------------------------------

export type ToolHandler<P, R> = (params: P) => Promise<R>;

export interface ToolRegistry {
  dom_get_tree: ToolHandler<DomGetTreeParams, DomGetTreeResponse>;
  ax_get_tree: ToolHandler<AxGetTreeParams, AxGetTreeResponse>;
  layout_get_box_model: ToolHandler<LayoutGetBoxModelParams, LayoutGetBoxModelResponse>;
  layout_is_visible: ToolHandler<LayoutIsVisibleParams, LayoutIsVisibleResponse>;
  ui_discover: ToolHandler<UiDiscoverParams, UiDiscoverResponse>;
  vision_ocr: ToolHandler<VisionOcrParams, VisionOcrResponse>;
  vision_find_by_text: ToolHandler<VisionFindByTextParams, VisionFindByTextResponse>;
  net_observe: ToolHandler<NetObserveParams, NetObserveResponse>;
  net_get_response_body: ToolHandler<NetGetResponseBodyParams, NetGetResponseBodyResponse>;
  content_extract_main: ToolHandler<ContentExtractMainParams, ContentExtractMainResponse>;
  content_to_text: ToolHandler<ContentToTextParams, ContentToTextResponse>;
  targets_resolve: ToolHandler<TargetsResolveParams, TargetsResolveResponse>;
  act_click: ToolHandler<ActClickParams, ActClickResponse>;
  act_type: ToolHandler<ActTypeParams, ActTypeResponse>;
  act_select: ToolHandler<ActSelectParams, ActSelectResponse>;
  act_scroll_into_view: ToolHandler<ActScrollIntoViewParams, ActScrollIntoViewResponse>;
  act_upload: ToolHandler<ActUploadParams, ActUploadResponse>;
  nav_goto: ToolHandler<NavGotoParams, NavGotoResponse>;
  nav_wait: ToolHandler<NavWaitParams, NavWaitResponse>;
  nav_frame: ToolHandler<NavFrameParams, NavFrameResponse>;
  form_detect: ToolHandler<FormDetectParams, FormDetectResponse>;
  form_fill: ToolHandler<FormFillParams, FormFillResponse>;
  form_submit: ToolHandler<FormSubmitParams, FormSubmitResponse>;
  kbd_press: ToolHandler<KbdPressParams, void>;
  kbd_type: ToolHandler<KbdTypeParams, void>;
  session_save: ToolHandler<SessionSaveParams, SessionSaveResponse>;
  session_restore: ToolHandler<SessionRestoreParams, SessionRestoreResponse>;
  session_cookies_get: ToolHandler<Record<string, never>, SessionCookiesGetResponse>;
  session_cookies_set: ToolHandler<SessionCookiesSetParams, SessionCookiesSetResponse>;
  session_cookies_clear: ToolHandler<Record<string, never>, SessionCookiesClearResponse>;
  memory_get_site_profile: ToolHandler<MemoryGetSiteProfileParams, MemoryGetSiteProfileResponse>;
  memory_put_site_profile: ToolHandler<MemoryPutSiteProfileParams, MemoryPutSiteProfileResponse>;
  safety_set_policy: ToolHandler<SafetySetPolicyParams, SafetySetPolicyResponse>;
  audit_snapshot: ToolHandler<AuditSnapshotParams, AuditSnapshotResponse>;
}
