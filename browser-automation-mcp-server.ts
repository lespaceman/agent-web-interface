/**
 * Browser Automation MCP Server
 *
 * This server exposes browser automation capabilities through the Model Context Protocol.
 * It bridges between Claude and your Qt/CEF browser automation system.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type * as Types from './browser-automation-mcp-types.js';
import toolsManifest from './browser-automation-mcp-tools.json' with { type: 'json' };

// Import your CEF bridge (this would be your IPC/WebSocket connection to Qt/CEF)
import { CEFBridge } from './cef-bridge.js';

interface FrameTreeNode {
  frame: {
    id: string;
    name?: string;
    url?: string;
  };
  childFrames?: FrameTreeNode[];
}

interface FrameTreeResult {
  frameTree: FrameTreeNode;
}

interface AuditLogEntry {
  label: string;
  timestamp: string;
  screenshotPath: string;
  domDigestPath: string;
  harPath?: string;
}

class BrowserAutomationServer {
  private server: Server;
  private cefBridge: CEFBridge;

  constructor() {
    this.server = new Server(
      {
        name: 'browser-automation-toolkit',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize CEF bridge
    this.cefBridge = new CEFBridge();

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: await this.getToolDefinitions(),
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await this.routeToolCall(name, args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unexpected error';
        return {
          content: [
            {
              type: 'text',
              text: `Error executing ${name}: ${message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private getToolDefinitions(): Promise<typeof toolsManifest.tools> {
    return Promise.resolve(toolsManifest.tools);
  }

  private castParams<T>(params: unknown): T {
    return (params ?? {}) as T;
  }

  private async routeToolCall(name: string, args: unknown): Promise<unknown> {
    // Route to appropriate handler based on tool name
    switch (name) {
      // Perception & Understanding Tools
      case 'dom_get_tree':
        return this.handleDomGetTree(this.castParams<Types.DomGetTreeParams>(args));
      case 'ax_get_tree':
        return this.handleAxGetTree(this.castParams<Types.AxGetTreeParams>(args));
      case 'layout_get_box_model':
        return this.handleLayoutGetBoxModel(this.castParams<Types.LayoutGetBoxModelParams>(args));
      case 'layout_is_visible':
        return this.handleLayoutIsVisible(this.castParams<Types.LayoutIsVisibleParams>(args));
      case 'ui_discover':
        return this.handleUiDiscover(this.castParams<Types.UiDiscoverParams>(args));
      case 'vision_ocr':
        return this.handleVisionOcr(this.castParams<Types.VisionOcrParams>(args));
      case 'vision_find_by_text':
        return this.handleVisionFindByText(this.castParams<Types.VisionFindByTextParams>(args));
      case 'net_observe':
        return this.handleNetObserve(this.castParams<Types.NetObserveParams>(args));
      case 'net_get_response_body':
        return this.handleNetGetResponseBody(this.castParams<Types.NetGetResponseBodyParams>(args));
      case 'content_extract_main':
        return this.handleContentExtractMain(this.castParams<Types.ContentExtractMainParams>(args));
      case 'content_to_text':
        return this.handleContentToText(this.castParams<Types.ContentToTextParams>(args));

      // Interaction & Navigation Tools
      case 'targets_resolve':
        return this.handleTargetsResolve(this.castParams<Types.TargetsResolveParams>(args));
      case 'act_click':
        return this.handleActClick(this.castParams<Types.ActClickParams>(args));
      case 'act_type':
        return this.handleActType(this.castParams<Types.ActTypeParams>(args));
      case 'act_select':
        return this.handleActSelect(this.castParams<Types.ActSelectParams>(args));
      case 'act_scroll_into_view':
        return this.handleActScrollIntoView(this.castParams<Types.ActScrollIntoViewParams>(args));
      case 'act_upload':
        return this.handleActUpload(this.castParams<Types.ActUploadParams>(args));
      case 'nav_goto':
        return this.handleNavGoto(this.castParams<Types.NavGotoParams>(args));
      case 'nav_wait':
        return this.handleNavWait(this.castParams<Types.NavWaitParams>(args));
      case 'nav_frame':
        return this.handleNavFrame(this.castParams<Types.NavFrameParams>(args));
      case 'form_detect':
        return this.handleFormDetect(this.castParams<Types.FormDetectParams>(args));
      case 'form_fill':
        return this.handleFormFill(this.castParams<Types.FormFillParams>(args));
      case 'form_submit':
        return this.handleFormSubmit(this.castParams<Types.FormSubmitParams>(args));
      case 'kbd_press':
        return this.handleKbdPress(this.castParams<Types.KbdPressParams>(args));
      case 'kbd_type':
        return this.handleKbdType(this.castParams<Types.KbdTypeParams>(args));

      // Session, Memory & Safety Tools
      case 'session_save':
        return this.handleSessionSave(this.castParams<Types.SessionSaveParams>(args));
      case 'session_restore':
        return this.handleSessionRestore(this.castParams<Types.SessionRestoreParams>(args));
      case 'session_cookies_get':
        return this.handleSessionCookiesGet();
      case 'session_cookies_set':
        return this.handleSessionCookiesSet(this.castParams<Types.SessionCookiesSetParams>(args));
      case 'session_cookies_clear':
        return this.handleSessionCookiesClear();
      case 'memory_get_site_profile':
        return this.handleMemoryGetSiteProfile(
          this.castParams<Types.MemoryGetSiteProfileParams>(args)
        );
      case 'memory_put_site_profile':
        return this.handleMemoryPutSiteProfile(
          this.castParams<Types.MemoryPutSiteProfileParams>(args)
        );
      case 'safety_set_policy':
        return this.handleSafetySetPolicy(this.castParams<Types.SafetySetPolicyParams>(args));
      case 'audit_snapshot':
        return this.handleAuditSnapshot(this.castParams<Types.AuditSnapshotParams>(args));

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // ===== PERCEPTION & UNDERSTANDING HANDLERS =====

  private async handleDomGetTree(
    params: Types.DomGetTreeParams
  ): Promise<Types.DomGetTreeResponse> {
    // Call CDP DOM.getDocument, DOM.requestChildNodes
    const result = await this.cefBridge.executeDevToolsMethod<unknown>('DOM.getDocument', {
      depth: params.depth ?? -1,
      pierce: true,
    });

    // Transform CDP response to our format
    return this.transformDomTree(result, params);
  }

  private async handleAxGetTree(params: Types.AxGetTreeParams): Promise<Types.AxGetTreeResponse> {
    // Call CDP Accessibility.getFullAXTree
    const result = await this.cefBridge.executeDevToolsMethod<{ nodes?: Types.AxTreeNode[] }>(
      'Accessibility.getFullAXTree',
      {
        frameId: params.frameId,
      }
    );

    return { nodes: result.nodes ?? [] };
  }

  private async handleLayoutGetBoxModel(
    params: Types.LayoutGetBoxModelParams
  ): Promise<Types.LayoutGetBoxModelResponse> {
    const elementRef = await this.resolveTarget(params.target);

    if (typeof elementRef.nodeId !== 'number') {
      throw new Error('Element reference is missing nodeId for box model request');
    }

    const result = await this.cefBridge.executeDevToolsMethod<{
      model?: { content?: number[] };
    }>('DOM.getBoxModel', {
      nodeId: elementRef.nodeId,
    });

    const quad = result.model?.content ?? [0, 0, 0, 0, 0, 0, 0, 0];

    return {
      quad,
      bbox: this.quadToBBox(quad),
    };
  }

  private async handleLayoutIsVisible(
    params: Types.LayoutIsVisibleParams
  ): Promise<Types.LayoutIsVisibleResponse> {
    const elementRef = await this.resolveTarget(params.target);

    // Check computed style, box model, and viewport intersection
    const visible = await this.checkVisibility(elementRef);

    return { visible };
  }

  private async handleUiDiscover(
    params: Types.UiDiscoverParams
  ): Promise<Types.UiDiscoverResponse> {
    // Fuse DOM + AX + layout data
    const axTree = await this.handleAxGetTree({});
    const domTree = await this.handleDomGetTree({ visibleOnly: true });

    // Filter for interactive elements and create ElementRefs
    const elements = await this.fuseTreesAndDiscover(axTree, domTree, params.scope);

    return { elements };
  }

  private async handleVisionOcr(params: Types.VisionOcrParams): Promise<Types.VisionOcrResponse> {
    // Take screenshot, run OCR (Tesseract.js or cloud service)
    const screenshot = await this.cefBridge.captureScreenshot(params.region);
    const ocrResult = await this.performOCR(screenshot);

    return ocrResult;
  }

  private async handleVisionFindByText(
    params: Types.VisionFindByTextParams
  ): Promise<Types.VisionFindByTextResponse> {
    const ocrResult = await this.handleVisionOcr({ region: params.areaHint });

    // Find matching text span
    const matchingSpan = this.findTextSpan(ocrResult, params.text, params.fuzzy);

    if (!matchingSpan) {
      return { element: null };
    }

    // Try to map back to DOM element
    const element = await this.mapBBoxToElement(matchingSpan.bbox);

    return { element };
  }

  private async handleNetObserve(
    params: Types.NetObserveParams
  ): Promise<Types.NetObserveResponse> {
    // Enable Network domain and filter events
    await this.cefBridge.executeDevToolsMethod('Network.enable', {});

    // Return async iterable of network events
    return {
      events: this.cefBridge.observeNetworkEvents(params.patterns),
    };
  }

  private async handleNetGetResponseBody(
    params: Types.NetGetResponseBodyParams
  ): Promise<Types.NetGetResponseBodyResponse> {
    const result = await this.cefBridge.executeDevToolsMethod<Types.NetGetResponseBodyResponse>(
      'Network.getResponseBody',
      {
        requestId: params.requestId,
      }
    );

    return result;
  }

  private async handleContentExtractMain(
    params: Types.ContentExtractMainParams
  ): Promise<Types.ContentExtractMainResponse> {
    // Get page HTML
    const html = await this.cefBridge.executeDevToolsMethod<{ outerHTML?: string }>(
      'DOM.getOuterHTML',
      {
        nodeId: 1, // document node
      }
    );

    const sourceHtml = html.outerHTML ?? '';

    // Run through Readability or Trafilatura
    const extracted = await this.extractMainContent(sourceHtml, params.mode);

    return extracted;
  }

  private async handleContentToText(
    params: Types.ContentToTextParams
  ): Promise<Types.ContentToTextResponse> {
    // Use inscriptis or html-text library
    const text = await this.htmlToText(params.html, params.mode);

    return { text };
  }

  // ===== INTERACTION & NAVIGATION HANDLERS =====

  private async handleTargetsResolve(
    params: Types.TargetsResolveParams
  ): Promise<Types.TargetsResolveResponse> {
    // Resolve hint to ElementRef using multiple strategies
    const element = await this.resolveTarget(params.hint);

    return { element };
  }

  private async handleActClick(params: Types.ActClickParams): Promise<Types.ActClickResponse> {
    const strategy = params.strategy ?? 'ax';

    try {
      if (strategy === 'ax') {
        // Use accessibility click
        await this.clickViaAccessibility(params.target);
      } else if (strategy === 'dom') {
        // Use DOM.dispatchEvent
        await this.clickViaDom(params.target);
      } else {
        // Use Input.dispatchMouseEvent with bbox coordinates
        await this.clickViaBBox(params.target);
      }

      return { success: true };
    } catch (error: unknown) {
      console.error('Click failed:', error);
      return { success: false };
    }
  }

  private async handleActType(params: Types.ActTypeParams): Promise<Types.ActTypeResponse> {
    try {
      // Focus element first
      await this.focusElement(params.target);

      // Dispatch keyboard events for each character
      for (const char of params.text) {
        await this.cefBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
          type: 'keyDown',
          text: char,
        });
        await this.cefBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
          type: 'keyUp',
          text: char,
        });
      }

      // Submit if requested
      if (params.submit) {
        await this.handleKbdPress({ sequence: [params.submit] });
      }

      return { success: true };
    } catch (error: unknown) {
      console.error('Type failed:', error);
      return { success: false };
    }
  }

  private async handleActSelect(params: Types.ActSelectParams): Promise<Types.ActSelectResponse> {
    // Focus select element and dispatch selection
    await this.focusElement(params.target);

    // Use DOM.setAttributeValue or dispatchEvents
    // Implementation depends on whether you select by value, label, or index

    return { success: true };
  }

  private async handleActScrollIntoView(
    params: Types.ActScrollIntoViewParams
  ): Promise<Types.ActScrollIntoViewResponse> {
    const selector = params.target.selectors.css;
    if (!selector) {
      throw new Error('CSS selector required to scroll element into view');
    }

    const block = params.center ? 'center' : 'nearest';
    const expression = `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) {
          el.scrollIntoView({ block: ${JSON.stringify(block)} });
          return true;
        }
        return false;
      })()
    `;

    await this.cefBridge.executeDevToolsMethod('Runtime.evaluate', {
      expression,
    });

    return { success: true };
  }

  private async handleActUpload(params: Types.ActUploadParams): Promise<Types.ActUploadResponse> {
    // Validate files are in allowed directories
    this.validateFilePaths(params.files);

    // Use DOM.setFileInputFiles
    if (typeof params.target.nodeId !== 'number') {
      throw new Error('Element reference is missing nodeId for file upload');
    }

    await this.cefBridge.executeDevToolsMethod('DOM.setFileInputFiles', {
      files: params.files,
      nodeId: params.target.nodeId,
    });

    return { success: true };
  }

  private async handleNavGoto(params: Types.NavGotoParams): Promise<Types.NavGotoResponse> {
    await this.cefBridge.executeDevToolsMethod('Page.navigate', {
      url: params.url,
    });

    // Wait for load
    await this.handleNavWait({ for: 'network-idle' });

    return { success: true };
  }

  private async handleNavWait(params: Types.NavWaitParams): Promise<Types.NavWaitResponse> {
    const timeoutMs = params.timeoutMs ?? 30000;

    switch (params.for) {
      case 'network-idle':
        await this.waitForNetworkIdle(timeoutMs);
        break;
      case 'selector':
        if (!params.selector) {
          throw new Error('selector is required when waiting for a selector');
        }
        await this.waitForSelector(params.selector, timeoutMs);
        break;
      case 'ax-role':
        if (!params.roleName) {
          throw new Error('roleName is required when waiting for an accessibility role');
        }
        await this.waitForAccessibilityRole(params.roleName, timeoutMs);
        break;
      case 'route-change':
        await this.waitForRouteChange(timeoutMs);
        break;
      default: {
        const unreachable: never = params.for;
        void unreachable;
        throw new Error('Unsupported wait condition');
      }
    }

    return { success: true };
  }

  private async handleNavFrame(params: Types.NavFrameParams): Promise<Types.NavFrameResponse> {
    // Find frame by selector, URL, or name
    const frames = await this.cefBridge.executeDevToolsMethod<FrameTreeResult>(
      'Page.getFrameTree',
      {}
    );

    const frame = this.findMatchingFrame(frames, params);

    return { frameId: frame.id };
  }

  private async handleFormDetect(
    params: Types.FormDetectParams
  ): Promise<Types.FormDetectResponse> {
    // Find all form elements, inputs, and submit buttons
    const elements = await this.handleUiDiscover({ scope: params.scope });

    const fields = elements.elements.filter(
      (el) => el.role === 'textbox' || el.role === 'combobox' || el.role === 'searchbox'
    );

    const submitButtons = elements.elements.filter(
      (el) => el.role === 'button' && /submit|sign in|login|continue/i.test(el.label ?? '')
    );

    return { fields, submitButtons };
  }

  private async handleFormFill(params: Types.FormFillParams): Promise<Types.FormFillResponse> {
    const filled: string[] = [];

    for (const pair of params.pairs) {
      // Match slot to field using heuristics
      const field = await this.findFieldBySlot(pair.slot, params.scope);

      if (field) {
        await this.handleActType({ target: field, text: pair.text });
        filled.push(pair.slot);
      }
    }

    return { success: filled.length > 0, filled };
  }

  private async handleFormSubmit(
    params: Types.FormSubmitParams
  ): Promise<Types.FormSubmitResponse> {
    const strategy = params.strategy ?? 'button';

    if (strategy === 'button') {
      // Find and click submit button
      const form = await this.handleFormDetect({});
      if (form.submitButtons.length > 0) {
        await this.handleActClick({ target: form.submitButtons[0] });
      }
    } else {
      // Use form.requestSubmit()
      await this.cefBridge.executeDevToolsMethod('Runtime.evaluate', {
        expression: `document.querySelector('form').requestSubmit()`,
      });
    }

    return { success: true };
  }

  private async handleKbdPress(params: Types.KbdPressParams): Promise<void> {
    for (const key of params.sequence) {
      await this.cefBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
      });
      await this.cefBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
      });
    }
  }

  private async handleKbdType(params: Types.KbdTypeParams): Promise<void> {
    await this.cefBridge.executeDevToolsMethod('Input.insertText', {
      text: params.text,
    });
  }

  // ===== SESSION, MEMORY & SAFETY HANDLERS =====

  private async handleSessionSave(
    _params: Types.SessionSaveParams
  ): Promise<Types.SessionSaveResponse> {
    const cookies = await this.handleSessionCookiesGet();

    // Get storage
    const localStorage = await this.getLocalStorage();
    const sessionStorage = await this.getSessionStorage();

    return {
      state: {
        cookies: cookies.cookies,
        localStorage,
        sessionStorage,
      },
    };
  }

  private async handleSessionRestore(
    params: Types.SessionRestoreParams
  ): Promise<Types.SessionRestoreResponse> {
    // Restore cookies
    await this.handleSessionCookiesSet({ cookies: params.state.cookies });

    // Restore storage
    await this.setLocalStorage(params.state.localStorage);
    await this.setSessionStorage(params.state.sessionStorage);

    return { success: true };
  }

  private async handleSessionCookiesGet(): Promise<Types.SessionCookiesGetResponse> {
    const result = await this.cefBridge.executeDevToolsMethod<{
      cookies?: Types.BrowserCookie[];
    }>('Network.getCookies', {});
    return { cookies: result.cookies ?? [] };
  }

  private async handleSessionCookiesSet(
    params: Types.SessionCookiesSetParams
  ): Promise<Types.SessionCookiesSetResponse> {
    for (const cookie of params.cookies) {
      await this.cefBridge.executeDevToolsMethod('Network.setCookie', cookie);
    }
    return { success: true };
  }

  private async handleSessionCookiesClear(): Promise<Types.SessionCookiesClearResponse> {
    await this.cefBridge.executeDevToolsMethod('Network.clearBrowserCookies', {});
    return { success: true };
  }

  private async handleMemoryGetSiteProfile(
    params: Types.MemoryGetSiteProfileParams
  ): Promise<Types.MemoryGetSiteProfileResponse> {
    // Load from persistent storage (file, DB, etc.)
    const profile = await this.loadSiteProfile(params.domain);
    return { profile };
  }

  private async handleMemoryPutSiteProfile(
    params: Types.MemoryPutSiteProfileParams
  ): Promise<Types.MemoryPutSiteProfileResponse> {
    // Save to persistent storage
    await this.saveSiteProfile(params.domain, params.profile);
    return { success: true };
  }

  private handleSafetySetPolicy(
    params: Types.SafetySetPolicyParams
  ): Promise<Types.SafetySetPolicyResponse> {
    // Store policy in memory
    this.cefBridge.setSafetyPolicy(params);
    return Promise.resolve({ success: true });
  }

  private async handleAuditSnapshot(
    params: Types.AuditSnapshotParams
  ): Promise<Types.AuditSnapshotResponse> {
    const timestamp = new Date().toISOString();
    const screenshotPath = await this.cefBridge.captureScreenshot();
    const domDigest = await this.captureDomDigest();

    // Optionally capture HAR
    const harPath = await this.captureHAR();

    // Save audit log
    await this.saveAuditLog({
      label: params.label,
      timestamp,
      screenshotPath,
      domDigestPath: domDigest,
      harPath,
    });

    return { screenshotPath, domDigestPath: domDigest, harPath, timestamp };
  }

  // ===== HELPER METHODS =====

  private resolveTarget(hint: Types.ElementRef | Types.LocatorHint): Promise<Types.ElementRef> {
    if (this.isElementRef(hint)) {
      return Promise.resolve(hint);
    }

    const selectors: Types.Selectors = {};
    if ('css' in hint && hint.css) {
      selectors.css = hint.css;
    }
    if ('xpath' in hint && hint.xpath) {
      selectors.xpath = hint.xpath;
    }
    if ('ax' in hint && hint.ax) {
      selectors.ax = hint.ax;
    }

    const element: Types.ElementRef = {
      frameId: 'main',
      selectors,
    };

    if ('bbox' in hint && hint.bbox) {
      element.bbox = hint.bbox;
    }
    if ('role' in hint && hint.role) {
      element.role = hint.role;
    }
    if ('label' in hint && hint.label) {
      element.label = hint.label;
    }
    if ('name' in hint && hint.name) {
      element.name = hint.name;
    }

    return Promise.resolve(element);
  }

  private isElementRef(value: Types.ElementRef | Types.LocatorHint): value is Types.ElementRef {
    return (value as Types.ElementRef).selectors !== undefined;
  }

  private transformDomTree(
    _raw: unknown,
    _params: Types.DomGetTreeParams
  ): Types.DomGetTreeResponse {
    return { nodes: [] };
  }

  private quadToBBox(quad: number[]): Types.BBox {
    if (quad.length < 8) {
      return { x: 0, y: 0, w: 0, h: 0 };
    }

    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < quad.length; i += 2) {
      xs.push(quad[i] ?? 0);
      ys.push(quad[i + 1] ?? 0);
    }

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    };
  }

  private checkVisibility(_elementRef: Types.ElementRef): Promise<boolean> {
    return Promise.resolve(true);
  }

  private fuseTreesAndDiscover(
    _axTree: Types.AxGetTreeResponse,
    _domTree: Types.DomGetTreeResponse,
    _scope?: Types.LocatorHint
  ): Promise<Types.ElementRef[]> {
    return Promise.resolve([]);
  }

  private performOCR(_screenshotPath: string): Promise<Types.VisionOcrResponse> {
    return Promise.resolve({
      text: '',
      spans: [],
    });
  }

  private findTextSpan(
    ocrResult: Types.VisionOcrResponse,
    text: string,
    fuzzy?: boolean
  ): Types.VisionOcrResponse['spans'][number] | null {
    const query = text.trim().toLowerCase();
    if (!query) {
      return null;
    }

    const matcher = fuzzy
      ? (candidate: string) => candidate.includes(query)
      : (candidate: string) => candidate === query;

    return ocrResult.spans.find((span) => matcher(span.text.trim().toLowerCase())) ?? null;
  }

  private mapBBoxToElement(_bbox: Types.BBox): Promise<Types.ElementRef | null> {
    return Promise.resolve(null);
  }

  private async extractMainContent(
    html: string,
    mode?: string
  ): Promise<Types.ContentExtractMainResponse> {
    const text = await this.htmlToText(html, mode);
    return { title: '', html, text };
  }

  private htmlToText(html: string, _mode?: string): Promise<string> {
    const withoutTags = html.replace(/<[^>]+>/g, ' ');
    const normalized = withoutTags.replace(/\s+/g, ' ').trim();
    return Promise.resolve(normalized);
  }

  private async clickViaAccessibility(target: Types.ElementRef): Promise<void> {
    if (target.selectors.ax) {
      const expression = `
        (function() {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node && node.getAttribute && node.getAttribute('aria-label') === ${JSON.stringify(target.selectors.ax)}) {
              if (typeof node.click === 'function') {
                node.click();
              }
              break;
            }
          }
        })()
      `;
      await this.cefBridge.executeDevToolsMethod('Runtime.evaluate', { expression });
      return;
    }

    await this.clickViaDom(target);
  }

  private async clickViaDom(target: Types.ElementRef): Promise<void> {
    const selector = target.selectors.css;
    if (!selector) {
      throw new Error('CSS selector required for DOM click');
    }

    const expression = `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el && typeof el.click === 'function') {
          el.click();
          return true;
        }
        return false;
      })()
    `;

    await this.cefBridge.executeDevToolsMethod('Runtime.evaluate', { expression });
  }

  private async clickViaBBox(target: Types.ElementRef): Promise<void> {
    const bbox = target.bbox;
    if (!bbox) {
      throw new Error('Bounding box required for coordinate click');
    }

    const x = bbox.x + bbox.w / 2;
    const y = bbox.y + bbox.h / 2;

    await this.cefBridge.executeDevToolsMethod('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      x,
      y,
      clickCount: 1,
    });

    await this.cefBridge.executeDevToolsMethod('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      x,
      y,
      clickCount: 1,
    });
  }

  private async focusElement(target: Types.ElementRef): Promise<void> {
    const selector = target.selectors.css;
    if (!selector) {
      return;
    }

    const expression = `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el && typeof el.focus === 'function') {
          el.focus();
        }
      })()
    `;

    await this.cefBridge.executeDevToolsMethod('Runtime.evaluate', { expression });
  }

  private validateFilePaths(files: string[]): void {
    for (const file of files) {
      if (!file.startsWith('/')) {
        throw new Error(`Only absolute file paths are supported: ${file}`);
      }
    }
  }

  private waitForNetworkIdle(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, Math.min(timeoutMs, 1000));
    });
  }

  private async waitForSelector(selector: string, _timeoutMs: number): Promise<void> {
    const expression = `
      (function() {
        return Boolean(document.querySelector(${JSON.stringify(selector)}));
      })()
    `;
    await this.cefBridge.executeDevToolsMethod('Runtime.evaluate', { expression });
  }

  private async waitForAccessibilityRole(roleName: string, _timeoutMs: number): Promise<void> {
    const expression = `
      (function() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node && node.getAttribute && node.getAttribute('role') === ${JSON.stringify(roleName)}) {
            return true;
          }
        }
        return false;
      })()
    `;
    await this.cefBridge.executeDevToolsMethod('Runtime.evaluate', { expression });
  }

  private async waitForRouteChange(timeoutMs: number): Promise<void> {
    await this.waitForNetworkIdle(timeoutMs);
  }

  private findMatchingFrame(
    frames: FrameTreeResult,
    params: Types.NavFrameParams
  ): FrameTreeNode['frame'] {
    const nodes = this.flattenFrameTree(frames.frameTree);

    if (params.name) {
      const matchByName = nodes.find((node) => node.frame.name === params.name);
      if (matchByName) {
        return matchByName.frame;
      }
    }

    if (params.urlContains) {
      const fragment = params.urlContains;
      const matchByUrl = nodes.find(
        (node) => typeof node.frame.url === 'string' && node.frame.url.includes(fragment)
      );
      if (matchByUrl) {
        return matchByUrl.frame;
      }
    }

    return nodes[0]?.frame ?? { id: '' };
  }

  private flattenFrameTree(node: FrameTreeNode, acc: FrameTreeNode[] = []): FrameTreeNode[] {
    acc.push(node);
    for (const child of node.childFrames ?? []) {
      this.flattenFrameTree(child, acc);
    }
    return acc;
  }

  private async findFieldBySlot(
    slot: string,
    scope?: Types.LocatorHint
  ): Promise<Types.ElementRef | null> {
    const discovered = await this.handleUiDiscover(scope ? { scope } : {});
    const target = slot.trim().toLowerCase();

    const match =
      discovered.elements.find((element) => {
        const label = element.label?.toLowerCase() ?? '';
        const name = element.name?.toLowerCase() ?? '';
        return label.includes(target) || name.includes(target);
      }) ?? null;

    return match;
  }

  private getLocalStorage(): Promise<Types.StorageSnapshot> {
    return Promise.resolve({});
  }

  private getSessionStorage(): Promise<Types.StorageSnapshot> {
    return Promise.resolve({});
  }

  private setLocalStorage(_data: Types.StorageSnapshot): Promise<void> {
    return Promise.resolve();
  }

  private setSessionStorage(_data: Types.StorageSnapshot): Promise<void> {
    return Promise.resolve();
  }

  private loadSiteProfile(_domain: string): Promise<Types.SiteProfile | null> {
    return Promise.resolve(null);
  }

  private saveSiteProfile(_domain: string, _profile: Types.SiteProfile): Promise<void> {
    return Promise.resolve();
  }

  private captureDomDigest(): Promise<string> {
    return Promise.resolve('');
  }

  private captureHAR(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  private saveAuditLog(log: AuditLogEntry): Promise<void> {
    console.info('[Audit Snapshot]', log);
    return Promise.resolve();
  }

  private setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', () => {
      void this.server.close().then(
        () => process.exit(0),
        () => process.exit(1)
      );
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Browser Automation MCP Server running on stdio');
  }
}

// Start the server
const server = new BrowserAutomationServer();
server.run().catch(console.error);
