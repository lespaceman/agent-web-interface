/**
 * Tool Registry
 *
 * Exports handler interfaces and types
 * Tool registration is now handled by BrowserAutomationServer using modern McpServer API
 */

// Import all handler types
import type {
  DomTreeHandler,
  AxTreeHandler,
  UiDiscoverHandler,
  LayoutHandler,
  VisionHandler,
  ContentHandler,
  NetworkHandler,
} from '../domains/perception/handlers/index.js';
import type {
  ActionHandler,
  FormHandler,
  KeyboardHandler,
} from '../domains/interaction/handlers/index.js';
import type { NavigationHandler } from '../domains/navigation/handlers/index.js';
import type { SessionHandler } from '../domains/session/handlers/index.js';

/**
 * Handler collection interface
 *
 * Aggregates all domain-specific handlers for dependency injection
 */
export interface Handlers {
  // Perception
  domTree: DomTreeHandler;
  axTree: AxTreeHandler;
  uiDiscover: UiDiscoverHandler;
  layout: LayoutHandler;
  vision: VisionHandler;
  content: ContentHandler;
  network: NetworkHandler;

  // Interaction
  action: ActionHandler;
  form: FormHandler;
  keyboard: KeyboardHandler;

  // Navigation
  navigation: NavigationHandler;

  // Session
  session: SessionHandler;
}

/**
 * Legacy ToolRegistry class for backward compatibility
 * @deprecated Use BrowserAutomationServer directly
 */
export class ToolRegistry {
  constructor(private readonly handlers: Handlers) {
    console.warn(
      'ToolRegistry is deprecated. Tool registration is now handled by BrowserAutomationServer.'
    );
  }

  /**
   * Get all tools - deprecated, kept for compatibility
   * @deprecated
   */
  getAllTools(): unknown[] {
    return [];
  }

  /**
   * Get tool by name - deprecated, kept for compatibility
   * @deprecated
   */
  getTool(_name: string): unknown {
    return undefined;
  }

  /**
   * Check if tool exists - deprecated, kept for compatibility
   * @deprecated
   */
  hasTool(_name: string): boolean {
    return false;
  }
}
