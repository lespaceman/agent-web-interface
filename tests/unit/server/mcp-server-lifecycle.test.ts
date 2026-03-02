import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUnderlyingServer, mockMcpServer } = vi.hoisted(() => {
  const mockUnderlyingServer = {
    oninitialized: undefined as (() => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    getClientVersion: vi.fn().mockReturnValue({ name: 'claude-code', version: '1.0' }),
    getClientCapabilities: vi.fn().mockReturnValue({}),
    setRequestHandler: vi.fn(),
    setNotificationHandler: vi.fn(),
    notification: vi.fn(),
  };

  const mockMcpServer = {
    server: mockUnderlyingServer,
    tool: vi.fn(),
    registerTool: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
  };

  return { mockUnderlyingServer, mockMcpServer };
});

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(function () {
    return mockMcpServer;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  SetLevelRequestSchema: { method: 'logging/setLevel' },
}));

vi.mock('../../../src/shared/services/logging.service.js', () => ({
  getLogger: vi.fn().mockReturnValue({
    setMcpServer: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    setMinLevel: vi.fn(),
  }),
}));

vi.mock('../../../src/tools/tool-result.types.js', () => ({
  isImageResult: vi.fn().mockReturnValue(false),
  isFileResult: vi.fn().mockReturnValue(false),
}));

import { BrowserAutomationServer } from '../../../src/server/mcp-server.js';

describe('BrowserAutomationServer lifecycle hooks', () => {
  let serverInstance: BrowserAutomationServer;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the hook assignments
    mockUnderlyingServer.oninitialized = undefined;
    mockUnderlyingServer.onclose = undefined;
    serverInstance = new BrowserAutomationServer({
      name: 'test',
      version: '1.0',
    });
  });

  it('should set oninitialized callback on underlying Server', () => {
    expect(mockUnderlyingServer.oninitialized).toBeTypeOf('function');
  });

  it('should set onclose callback on underlying Server', () => {
    expect(mockUnderlyingServer.onclose).toBeTypeOf('function');
  });

  it('should emit "session:start" when oninitialized fires', () => {
    const listener = vi.fn();
    serverInstance.on('session:start', listener);

    mockUnderlyingServer.oninitialized!();

    expect(listener).toHaveBeenCalledWith({
      clientInfo: { name: 'claude-code', version: '1.0' },
    });
  });

  it('should emit "session:end" when onclose fires', () => {
    const listener = vi.fn();
    serverInstance.on('session:end', listener);

    mockUnderlyingServer.onclose!();

    expect(listener).toHaveBeenCalled();
  });
});
