#!/usr/bin/env node

/**
 * Browser Automation MCP Server
 *
 * Main entry point - initializes all services and starts the MCP server
 */

import { CEFBridge } from './bridge/cef-bridge.js';
import { BrowserAutomationServer } from './server/mcp-server.js';
import type { Handlers } from './server/tool-registry.js';

// Services
import { ElementResolverService } from './shared/services/element-resolver.service.js';
import { SelectorBuilderService } from './shared/services/selector-builder.service.js';
import { DomTransformerService } from './shared/services/dom-transformer.service.js';
import { VisibilityCheckerService } from './shared/services/visibility-checker.service.js';
import { ElementFusionService } from './shared/services/element-fusion.service.js';
import { FormDetectorService } from './shared/services/form-detector.service.js';

// Perception handlers
import { DomTreeHandler } from './domains/perception/handlers/dom-tree.handler.js';
import { AxTreeHandler } from './domains/perception/handlers/ax-tree.handler.js';
import { UiDiscoverHandler } from './domains/perception/handlers/ui-discover.handler.js';
import { LayoutHandler } from './domains/perception/handlers/layout.handler.js';
import { VisionHandler } from './domains/perception/handlers/vision.handler.js';
import { ContentHandler } from './domains/perception/handlers/content.handler.js';
import { NetworkHandler } from './domains/perception/handlers/network.handler.js';

// Interaction handlers and strategies
import { ActionHandler } from './domains/interaction/handlers/action.handler.js';
import { FormHandler } from './domains/interaction/handlers/form.handler.js';
import { KeyboardHandler } from './domains/interaction/handlers/keyboard.handler.js';
import { AccessibilityClickStrategy } from './domains/interaction/strategies/accessibility-click.strategy.js';
import { DomClickStrategy } from './domains/interaction/strategies/dom-click.strategy.js';
import { BBoxClickStrategy } from './domains/interaction/strategies/bbox-click.strategy.js';

// Navigation handlers
import { NavigationHandler } from './domains/navigation/handlers/navigation.handler.js';

// Session handlers
import { SessionHandler } from './domains/session/handlers/session.handler.js';

/**
 * Initialize all services and handlers
 */
function initializeServer(): BrowserAutomationServer {
  // Step 1: Create CDP bridge
  const cdpBridge = new CEFBridge();

  // Step 2: Create shared services
  const selectorBuilder = new SelectorBuilderService(cdpBridge);
  const visibilityChecker = new VisibilityCheckerService(cdpBridge);
  const elementResolver = new ElementResolverService(cdpBridge, selectorBuilder);
  const domTransformer = new DomTransformerService();
  const elementFusion = new ElementFusionService(elementResolver, selectorBuilder);
  const formDetector = new FormDetectorService(cdpBridge, selectorBuilder, visibilityChecker);

  // Step 3: Create perception handlers
  const domTreeHandler = new DomTreeHandler(cdpBridge, domTransformer);
  const axTreeHandler = new AxTreeHandler(cdpBridge);
  const uiDiscoverHandler = new UiDiscoverHandler(domTreeHandler, axTreeHandler, elementFusion);
  const layoutHandler = new LayoutHandler(cdpBridge, elementResolver, visibilityChecker);
  const visionHandler = new VisionHandler(cdpBridge);
  const contentHandler = new ContentHandler(cdpBridge);
  const networkHandler = new NetworkHandler(cdpBridge);

  // Step 4: Create interaction handlers
  const accessibilityStrategy = new AccessibilityClickStrategy(cdpBridge);
  const domStrategy = new DomClickStrategy(cdpBridge);
  const bboxStrategy = new BBoxClickStrategy(cdpBridge);

  const actionHandler = new ActionHandler(
    cdpBridge,
    elementResolver,
    accessibilityStrategy,
    domStrategy,
    bboxStrategy
  );
  const formHandler = new FormHandler(formDetector, domTreeHandler, axTreeHandler, actionHandler);
  const keyboardHandler = new KeyboardHandler(cdpBridge);

  // Step 5: Create navigation handlers
  const navigationHandler = new NavigationHandler(cdpBridge);

  // Step 6: Create session handlers
  const sessionHandler = new SessionHandler(cdpBridge, navigationHandler);

  // Step 7: Create handlers collection
  const handlers: Handlers = {
    // Perception
    domTree: domTreeHandler,
    axTree: axTreeHandler,
    uiDiscover: uiDiscoverHandler,
    layout: layoutHandler,
    vision: visionHandler,
    content: contentHandler,
    network: networkHandler,

    // Interaction
    action: actionHandler,
    form: formHandler,
    keyboard: keyboardHandler,

    // Navigation
    navigation: navigationHandler,

    // Session
    session: sessionHandler,
  };

  // Step 8: Create MCP server with modern McpServer implementation
  const server = new BrowserAutomationServer(
    {
      name: 'browser-automation-mcp-server',
      version: '2.0.0',
      capabilities: {
        tools: {},
        logging: {}, // Enable logging capability for observability
      },
    },
    handlers
  );

  return server;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const server = initializeServer();
    await server.start();

    // Handle shutdown gracefully
    const shutdown = (signal: NodeJS.Signals) => {
      console.error(`Shutting down... (${signal})`);
      void (async () => {
        try {
          await server.stop();
          process.exit(0);
        } catch (shutdownError) {
          console.error('Error during shutdown:', shutdownError);
          process.exit(1);
        }
      })();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start server
void main();
