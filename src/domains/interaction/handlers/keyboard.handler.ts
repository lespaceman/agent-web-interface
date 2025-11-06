/**
 * Keyboard Handler
 *
 * Handles keyboard-related tools:
 * - kb_press: Press individual keys or key combinations
 * - kb_hotkey: Execute common hotkeys (Ctrl+C, Ctrl+V, etc.)
 */

import type {
  KbPressParams,
  KbPressResponse,
  KbHotkeyParams,
  KbHotkeyResponse,
} from '../interaction.types.js';

interface CdpBridge {
  executeDevToolsMethod<T>(method: string, params?: unknown): Promise<T>;
}

/**
 * Key modifier bitmask values for CDP
 */
const KeyModifiers = {
  Alt: 1,
  Ctrl: 2,
  Meta: 4, // Cmd on Mac
  Shift: 8,
} as const;

/**
 * Common hotkey mappings
 */
const Hotkeys: Record<string, { key: string; code: string; modifiers: number }> = {
  copy: { key: 'c', code: 'KeyC', modifiers: KeyModifiers.Ctrl },
  paste: { key: 'v', code: 'KeyV', modifiers: KeyModifiers.Ctrl },
  cut: { key: 'x', code: 'KeyX', modifiers: KeyModifiers.Ctrl },
  selectAll: { key: 'a', code: 'KeyA', modifiers: KeyModifiers.Ctrl },
  undo: { key: 'z', code: 'KeyZ', modifiers: KeyModifiers.Ctrl },
  redo: { key: 'y', code: 'KeyY', modifiers: KeyModifiers.Ctrl },
  save: { key: 's', code: 'KeyS', modifiers: KeyModifiers.Ctrl },
  find: { key: 'f', code: 'KeyF', modifiers: KeyModifiers.Ctrl },
  refresh: { key: 'F5', code: 'F5', modifiers: 0 },
  newTab: { key: 't', code: 'KeyT', modifiers: KeyModifiers.Ctrl },
  closeTab: { key: 'w', code: 'KeyW', modifiers: KeyModifiers.Ctrl },
};

/**
 * Keyboard Handler
 *
 * Handles keyboard input simulation using CDP Input domain
 */
export class KeyboardHandler {
  constructor(private readonly cdpBridge: CdpBridge) {}

  /**
   * Handle kb_press tool
   *
   * Press a single key or key combination
   */
  async press(params: KbPressParams): Promise<KbPressResponse> {
    try {
      // Calculate modifier bitmask
      let modifiers = 0;
      if (params.modifiers) {
        if (params.modifiers.includes('Alt')) modifiers |= KeyModifiers.Alt;
        if (params.modifiers.includes('Ctrl')) modifiers |= KeyModifiers.Ctrl;
        if (params.modifiers.includes('Meta')) modifiers |= KeyModifiers.Meta;
        if (params.modifiers.includes('Shift')) modifiers |= KeyModifiers.Shift;
      }

      // Press key down
      await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: params.key,
        code: params.code ?? this.keyToCode(params.key),
        modifiers,
      });

      // Small delay to simulate human typing
      await this.sleep(params.delayMs ?? 50);

      // Release key
      await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: params.key,
        code: params.code ?? this.keyToCode(params.key),
        modifiers,
      });

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle kb_hotkey tool
   *
   * Execute common hotkeys (Ctrl+C, Ctrl+V, etc.)
   */
  async hotkey(params: KbHotkeyParams): Promise<KbHotkeyResponse> {
    try {
      const hotkeyDef = Hotkeys[params.hotkey];
      if (!hotkeyDef) {
        return {
          success: false,
          error: `Unknown hotkey: ${params.hotkey}. Available: ${Object.keys(Hotkeys).join(', ')}`,
        };
      }

      // Press modifier keys first
      if (hotkeyDef.modifiers) {
        if (hotkeyDef.modifiers & KeyModifiers.Ctrl) {
          await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
            type: 'rawKeyDown',
            key: 'Control',
            code: 'ControlLeft',
            modifiers: KeyModifiers.Ctrl,
          });
        }
        if (hotkeyDef.modifiers & KeyModifiers.Alt) {
          await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
            type: 'rawKeyDown',
            key: 'Alt',
            code: 'AltLeft',
            modifiers: KeyModifiers.Alt,
          });
        }
        if (hotkeyDef.modifiers & KeyModifiers.Meta) {
          await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
            type: 'rawKeyDown',
            key: 'Meta',
            code: 'MetaLeft',
            modifiers: KeyModifiers.Meta,
          });
        }
        if (hotkeyDef.modifiers & KeyModifiers.Shift) {
          await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
            type: 'rawKeyDown',
            key: 'Shift',
            code: 'ShiftLeft',
            modifiers: KeyModifiers.Shift,
          });
        }
      }

      // Press main key
      await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: hotkeyDef.key,
        code: hotkeyDef.code,
        modifiers: hotkeyDef.modifiers,
      });

      await this.sleep(50);

      // Release main key
      await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: hotkeyDef.key,
        code: hotkeyDef.code,
        modifiers: hotkeyDef.modifiers,
      });

      // Release modifier keys
      if (hotkeyDef.modifiers) {
        if (hotkeyDef.modifiers & KeyModifiers.Shift) {
          await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Shift',
            code: 'ShiftLeft',
            modifiers: 0,
          });
        }
        if (hotkeyDef.modifiers & KeyModifiers.Meta) {
          await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Meta',
            code: 'MetaLeft',
            modifiers: 0,
          });
        }
        if (hotkeyDef.modifiers & KeyModifiers.Alt) {
          await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Alt',
            code: 'AltLeft',
            modifiers: 0,
          });
        }
        if (hotkeyDef.modifiers & KeyModifiers.Ctrl) {
          await this.cdpBridge.executeDevToolsMethod('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Control',
            code: 'ControlLeft',
            modifiers: 0,
          });
        }
      }

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Convert key name to key code
   *
   * This is a simple mapping for common keys
   */
  private keyToCode(key: string): string {
    // Special keys
    const specialKeys: Record<string, string> = {
      Enter: 'Enter',
      Tab: 'Tab',
      Backspace: 'Backspace',
      Escape: 'Escape',
      ArrowUp: 'ArrowUp',
      ArrowDown: 'ArrowDown',
      ArrowLeft: 'ArrowLeft',
      ArrowRight: 'ArrowRight',
      Delete: 'Delete',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      ' ': 'Space',
    };

    if (specialKeys[key]) {
      return specialKeys[key];
    }

    // Function keys
    if (key.startsWith('F') && key.length <= 3) {
      return key; // F1, F2, ..., F12
    }

    // Letters
    if (key.length === 1 && /[a-zA-Z]/.test(key)) {
      return `Key${key.toUpperCase()}`;
    }

    // Numbers
    if (key.length === 1 && /[0-9]/.test(key)) {
      return `Digit${key}`;
    }

    // Default: return key as-is
    return key;
  }

  /**
   * Sleep for a specified number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
