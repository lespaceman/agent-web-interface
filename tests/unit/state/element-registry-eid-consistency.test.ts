/**
 * Element Registry EID Consistency Tests
 *
 * Tests that EIDs returned in XML response match what's stored in ElementRegistry.
 * This is critical for the action flow: navigate() returns EID → click(eid) looks up in registry.
 *
 * Bug being tested: formatActionables() recomputes EIDs independently from ElementRegistry,
 * causing collision suffixes to diverge when node ordering differs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager } from '../../../src/state/state-manager.js';
import type { BaseSnapshot, ReadableNode } from '../../../src/snapshot/snapshot.types.js';

/**
 * Create a test snapshot with configurable nodes.
 */
function createTestSnapshot(options: {
  url?: string;
  snapshotId?: string;
  nodes: Partial<ReadableNode>[];
}): BaseSnapshot {
  const nodes = options.nodes.map((partial, idx) => ({
    node_id: partial.node_id ?? `node-${idx}`,
    backend_node_id: partial.backend_node_id ?? 100 + idx,
    frame_id: 'main-frame',
    loader_id: 'loader-1',
    kind: partial.kind ?? 'button',
    label: partial.label ?? `Element ${idx}`,
    where: partial.where ?? { region: 'main' },
    layout: partial.layout ?? {
      bbox: { x: 0, y: idx * 50, w: 100, h: 40 },
      display: 'block',
      screen_zone: 'top-center' as const,
    },
    state: partial.state ?? { visible: true, enabled: true },
    find: partial.find ?? { primary: `#el-${idx}`, alternates: [] },
    attributes: partial.attributes,
  })) as ReadableNode[];

  return {
    snapshot_id: options.snapshotId ?? `snap-${Date.now()}`,
    url: options.url ?? 'https://example.com/',
    title: 'Test Page',
    captured_at: new Date().toISOString(),
    viewport: { width: 1280, height: 720 },
    nodes,
    meta: {
      node_count: nodes.length,
      interactive_count: nodes.filter((n) => n.state?.visible).length,
    },
  };
}

/**
 * Extract EIDs from XML response.
 * Matches patterns like id="abc123" in the XML output.
 */
function extractEidsFromXml(xml: string): string[] {
  const matches = xml.matchAll(/id="([a-f0-9]{12}(?:-\d+)?)"/g);
  return Array.from(matches, (m) => m[1]);
}

/**
 * Extract EIDs with focused flag from XML.
 * Parses XML more carefully to find focused elements.
 */
function extractEidsWithFocusFlag(xml: string): { eid: string; focused: boolean; label: string }[] {
  const results: { eid: string; focused: boolean; label: string }[] = [];
  // Match full element tags
  const tagRegex = /<(btn|link|inp|chk|rad|sel|img|h|elt)([^>]*)>([^<]*)<\/\1>/g;

  let match;
  while ((match = tagRegex.exec(xml)) !== null) {
    const attrs = match[2];
    const label = match[3].trim();

    // Extract id using exec instead of match
    const idRegex = /id="([a-f0-9]{12}(?:-\d+)?)"/;
    const idMatch = idRegex.exec(attrs);
    if (!idMatch) continue;

    // Check for focused="true"
    const hasFocus = attrs.includes('focused="true"');

    results.push({
      eid: idMatch[1],
      focused: hasFocus,
      label,
    });
  }
  return results;
}

describe('ElementRegistry EID Consistency', () => {
  let stateManager: StateManager;

  beforeEach(() => {
    stateManager = new StateManager({ pageId: 'test-page-eid' });
  });

  describe('EID lookup after generateResponse', () => {
    it('should find all EIDs from XML response in the registry', () => {
      // Create snapshot with multiple buttons that could collide
      const snapshot = createTestSnapshot({
        snapshotId: 'snap-eid-test-1',
        nodes: [
          {
            node_id: 'btn-1',
            backend_node_id: 100,
            kind: 'button',
            label: 'Submit',
            where: { region: 'main' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'btn-2',
            backend_node_id: 101,
            kind: 'button',
            label: 'Cancel',
            where: { region: 'main' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'link-1',
            backend_node_id: 102,
            kind: 'link',
            label: 'Learn more',
            where: { region: 'main' },
            state: { visible: true, enabled: true },
          },
        ],
      });

      // Generate response (updates registry + formats XML)
      const xml = stateManager.generateResponse(snapshot);
      const registry = stateManager.getElementRegistry();

      // Extract all EIDs from the XML response
      const eidsInXml = extractEidsFromXml(xml);

      // Verify each EID from XML can be found in registry
      for (const eid of eidsInXml) {
        const elementRef = registry.getByEid(eid);
        expect(elementRef, `EID "${eid}" from XML should exist in registry`).toBeDefined();
      }
    });

    it('should handle EID collisions consistently between registry and XML', () => {
      // Create snapshot with elements that will produce EID collisions
      // (same label, same kind, same region → same base EID)
      const snapshot = createTestSnapshot({
        snapshotId: 'snap-collision-test',
        nodes: [
          {
            node_id: 'submit-btn-1',
            backend_node_id: 100,
            kind: 'button',
            label: 'Submit',
            where: { region: 'main' },
            layout: {
              bbox: { x: 0, y: 0, w: 100, h: 40 },
              display: 'block',
              screen_zone: 'top-left' as const,
            },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'submit-btn-2',
            backend_node_id: 101,
            kind: 'button',
            label: 'Submit', // Same label - will cause collision
            where: { region: 'main' },
            layout: {
              bbox: { x: 0, y: 50, w: 100, h: 40 },
              display: 'block',
              screen_zone: 'top-left' as const, // Same screen zone
            },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'submit-btn-3',
            backend_node_id: 102,
            kind: 'button',
            label: 'Submit', // Same label - will cause collision
            where: { region: 'main' },
            layout: {
              bbox: { x: 0, y: 100, w: 100, h: 40 },
              display: 'block',
              screen_zone: 'top-left' as const, // Same screen zone
            },
            state: { visible: true, enabled: true },
          },
        ],
      });

      // Generate response
      const xml = stateManager.generateResponse(snapshot);
      const registry = stateManager.getElementRegistry();

      // Extract EIDs from XML
      const eidsInXml = extractEidsFromXml(xml);

      // Should have 3 EIDs (one for each button)
      expect(eidsInXml.length).toBe(3);

      // Each EID should be unique (collision resolution worked)
      const uniqueEids = new Set(eidsInXml);
      expect(uniqueEids.size).toBe(3);

      // CRITICAL: Each EID from XML must be findable in registry
      for (const eid of eidsInXml) {
        const elementRef = registry.getByEid(eid);
        expect(
          elementRef,
          `Collision-resolved EID "${eid}" from XML should exist in registry`
        ).toBeDefined();
      }
    });

    it('should allow clicking elements using EID from XML response', () => {
      // This simulates the actual workflow:
      // 1. navigate() returns XML with EIDs
      // 2. click(eid) looks up in registry
      // 3. Gets backend_node_id to target the element

      const snapshot = createTestSnapshot({
        snapshotId: 'snap-click-test',
        nodes: [
          {
            node_id: 'btn-target',
            backend_node_id: 42,
            kind: 'button',
            label: 'Click Me',
            where: { region: 'main' },
            state: { visible: true, enabled: true },
          },
        ],
      });

      // Generate response (like navigate() does)
      const xml = stateManager.generateResponse(snapshot);
      const registry = stateManager.getElementRegistry();

      // Extract EID from XML (like LLM would parse)
      const eidsInXml = extractEidsFromXml(xml);
      expect(eidsInXml.length).toBeGreaterThan(0);

      const eid = eidsInXml[0];

      // Simulate click handler: look up EID in registry
      const elementRef = registry.getByEid(eid);
      expect(elementRef, `EID "${eid}" should be found`).toBeDefined();

      // Verify we can get the backend_node_id for CDP click
      expect(elementRef!.ref.backend_node_id).toBe(42);
    });
  });

  describe('Critical: EID-to-backend_node_id mapping', () => {
    it('should return correct backend_node_id when clicking focused element by EID from XML', () => {
      // This is THE critical test for the bug:
      // User sees XML with focused element, clicks it using EID from XML,
      // and the click should target the correct backend_node_id.

      const snapshot = createTestSnapshot({
        snapshotId: 'snap-click-focused',
        nodes: [
          {
            node_id: 'btn-1',
            backend_node_id: 100, // First button
            kind: 'button',
            label: 'Submit',
            where: { region: 'main' },
            layout: {
              bbox: { x: 0, y: 0, w: 100, h: 40 },
              display: 'block',
              screen_zone: 'top-left' as const,
            },
            state: { visible: true, enabled: true, focused: false },
          },
          {
            node_id: 'btn-2',
            backend_node_id: 200, // Second button - THE ONE USER WANTS TO CLICK
            kind: 'button',
            label: 'Submit', // Same label as btn-1 for collision
            where: { region: 'main' },
            layout: {
              bbox: { x: 0, y: 50, w: 100, h: 40 },
              display: 'block',
              screen_zone: 'top-left' as const,
            },
            state: { visible: true, enabled: true, focused: true }, // FOCUSED
          },
        ],
      });

      const xml = stateManager.generateResponse(snapshot);
      const registry = stateManager.getElementRegistry();

      // Find the focused element in XML
      const elementsInXml = extractEidsWithFocusFlag(xml);
      const focusedInXml = elementsInXml.find((e) => e.focused);

      // There should be a focused element in XML
      expect(focusedInXml, 'Should have a focused element in XML').toBeDefined();

      // Simulate click workflow: Look up the focused element's EID in registry
      const elementRef = registry.getByEid(focusedInXml!.eid);

      // CRITICAL: The registry lookup must return the CORRECT backend_node_id
      // The focused element in the snapshot has backend_node_id=200
      // If we get 100 instead, it means the EID mapping is wrong due to reordering
      expect(
        elementRef,
        `Focused element EID "${focusedInXml!.eid}" should exist in registry`
      ).toBeDefined();
      expect(
        elementRef!.ref.backend_node_id,
        'Clicking focused element EID should target the focused button (backend_node_id=200)'
      ).toBe(200);
    });
  });

  describe('EID consistency with reordering', () => {
    it('should maintain EID consistency when focused element is reordered to front', () => {
      // This test demonstrates the bug:
      // 1. Snapshot has [ButtonA, ButtonB] both labeled "Submit"
      // 2. updateFromSnapshot() computes: ButtonA="abc123", ButtonB="abc123-2"
      // 3. ButtonB is focused, so selectActionablesWithFocusGuarantee() returns [ButtonB, ButtonA]
      // 4. formatActionables() computes: ButtonB="abc123", ButtonA="abc123-2" (SWAPPED!)
      // 5. XML shows ButtonB with "abc123", but registry has ButtonA with "abc123"

      const snapshot = createTestSnapshot({
        snapshotId: 'snap-reorder-test',
        nodes: [
          {
            node_id: 'submit-btn-1',
            backend_node_id: 100,
            kind: 'button',
            label: 'Submit',
            where: { region: 'main' },
            layout: {
              bbox: { x: 0, y: 0, w: 100, h: 40 },
              display: 'block',
              screen_zone: 'top-left' as const,
            },
            state: { visible: true, enabled: true, focused: false },
          },
          {
            node_id: 'submit-btn-2',
            backend_node_id: 101,
            kind: 'button',
            label: 'Submit', // Same label - causes collision
            where: { region: 'main' },
            layout: {
              bbox: { x: 0, y: 50, w: 100, h: 40 },
              display: 'block',
              screen_zone: 'top-left' as const, // Same screen zone - maximizes collision
            },
            state: { visible: true, enabled: true, focused: true }, // FOCUSED - will be reordered to front
          },
        ],
      });

      // Generate response
      const xml = stateManager.generateResponse(snapshot);
      const registry = stateManager.getElementRegistry();

      // Extract EIDs from XML in order
      const eidsInXml = extractEidsFromXml(xml);

      // Look up what EID the registry has for each backend_node_id
      const eidForBtn1 = registry.getEidBySnapshotAndBackendNodeId('snap-reorder-test', 100);
      const eidForBtn2 = registry.getEidBySnapshotAndBackendNodeId('snap-reorder-test', 101);

      expect(eidForBtn1, 'Registry should have EID for button 1').toBeDefined();
      expect(eidForBtn2, 'Registry should have EID for button 2').toBeDefined();

      // Check if collision occurred (both buttons should have same base EID due to identical props)
      const baseEid1 = eidForBtn1!.split('-')[0];
      const baseEid2 = eidForBtn2!.split('-')[0];

      // If base EIDs are the same, we have a collision scenario
      if (baseEid1 === baseEid2) {
        // Registry processes in snapshot order: btn1 first (gets base), btn2 second (gets -2)
        // XML may have different order due to focus reordering
        // The test verifies that XML EIDs can be looked up in registry

        // CRITICAL: Each EID from XML must resolve to correct element
        for (const eid of eidsInXml) {
          const elementRef = registry.getByEid(eid);
          expect(elementRef, `EID "${eid}" from XML should be in registry`).toBeDefined();
        }

        // Verify the backend_node_ids are correct
        const refForBtn1 = registry.getByEid(eidForBtn1!);
        const refForBtn2 = registry.getByEid(eidForBtn2!);

        expect(refForBtn1?.ref.backend_node_id).toBe(100);
        expect(refForBtn2?.ref.backend_node_id).toBe(101);
      }
    });

    it('should maintain EID consistency when close affordances are prioritized', () => {
      // Similar issue with close buttons being reordered to front
      const snapshot = createTestSnapshot({
        snapshotId: 'snap-close-reorder',
        nodes: [
          {
            node_id: 'btn-1',
            backend_node_id: 100,
            kind: 'button',
            label: 'Action',
            where: { region: 'main' },
            layout: {
              bbox: { x: 0, y: 0, w: 100, h: 40 },
              display: 'block',
              screen_zone: 'top-center' as const,
            },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'close-btn',
            backend_node_id: 101,
            kind: 'button',
            label: 'Close',
            where: { region: 'main' },
            layout: {
              bbox: { x: 200, y: 0, w: 50, h: 40 },
              display: 'block',
              screen_zone: 'top-center' as const,
            },
            state: { visible: true, enabled: true },
          },
        ],
      });

      const xml = stateManager.generateResponse(snapshot);
      const registry = stateManager.getElementRegistry();

      const eidsInXml = extractEidsFromXml(xml);

      // All EIDs from XML should be findable in registry
      for (const eid of eidsInXml) {
        const elementRef = registry.getByEid(eid);
        expect(elementRef, `EID "${eid}" should be in registry`).toBeDefined();
      }
    });
  });

  describe('EID reverse lookup', () => {
    it('should look up EID by backend_node_id after generateResponse', () => {
      const snapshot = createTestSnapshot({
        snapshotId: 'snap-reverse-lookup',
        nodes: [
          {
            node_id: 'btn-1',
            backend_node_id: 123,
            kind: 'button',
            label: 'Test Button',
            where: { region: 'main' },
            state: { visible: true, enabled: true },
          },
        ],
      });

      stateManager.generateResponse(snapshot);
      const registry = stateManager.getElementRegistry();

      // Reverse lookup should work
      const eid = registry.getEidBySnapshotAndBackendNodeId('snap-reverse-lookup', 123);
      expect(eid).toBeDefined();

      // Forward lookup with that EID should return the element
      const elementRef = registry.getByEid(eid!);
      expect(elementRef).toBeDefined();
      expect(elementRef!.ref.backend_node_id).toBe(123);
    });
  });
});
