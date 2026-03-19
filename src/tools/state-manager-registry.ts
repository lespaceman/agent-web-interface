/**
 * State Manager Registry
 *
 * Global registry of state managers (one per page).
 *
 * @module tools/state-manager-registry
 */

import { StateManager } from '../state/state-manager.js';

/**
 * Global registry of state managers (one per page).
 */
const stateManagers = new Map<string, StateManager>();

/**
 * Get or create state manager for a page.
 *
 * @param pageId - Page ID
 * @returns State manager instance
 */
export function getStateManager(pageId: string): StateManager {
  if (!stateManagers.has(pageId)) {
    stateManagers.set(pageId, new StateManager({ pageId }));
  }
  return stateManagers.get(pageId)!;
}

/**
 * Remove state manager for a page (call on page close).
 *
 * @param pageId - Page ID
 */
export function removeStateManager(pageId: string): void {
  stateManagers.delete(pageId);
}

/**
 * Clear all state managers (call on session close).
 */
export function clearAllStateManagers(): void {
  stateManagers.clear();
}
