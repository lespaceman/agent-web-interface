import { describe, it, expect } from 'vitest';
import { formatToolError } from '../../../src/server/tool-result-handler.js';
import { BrowserSessionError } from '../../../src/shared/errors/browser-session.error.js';

describe('formatToolError', () => {
  it('formats auto-connect unavailable into actionable guidance', () => {
    const error = BrowserSessionError.connectionFailed(
      new Error('DevToolsActivePort file not found at /tmp/DevToolsActivePort'),
      { operation: 'autoConnect', endpointUrl: 'channel:chrome' }
    );

    expect(formatToolError(error)).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error:
              'Could not connect to your existing Chrome session. Open Chrome first and enable remote debugging. Or set AWI_BROWSER_MODE=persistent to launch a dedicated browser.',
          }),
        },
      ],
      isError: true,
    });
  });

  it('formats external browser disconnect into actionable guidance', () => {
    const error = BrowserSessionError.browserDisconnected({ connectionMode: 'external' });

    expect(formatToolError(error)).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error:
              'The connected Chrome session was closed. Open Chrome again, or set AWI_BROWSER_MODE=persistent to launch a dedicated browser.',
          }),
        },
      ],
      isError: true,
    });
  });

  it('preserves generic browser session errors', () => {
    const error = BrowserSessionError.connectionFailed(new Error('Connection refused'), {
      operation: 'connect',
    });

    expect(formatToolError(error)).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Failed to connect to browser: Connection refused',
          }),
        },
      ],
      isError: true,
    });
  });
});
