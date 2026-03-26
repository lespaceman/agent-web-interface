import type { Response } from 'express';

/**
 * Send a JSON-RPC 2.0 error response.
 */
export function sendJsonRpcError(
  res: Response,
  httpStatus: number,
  code: number,
  message: string
): void {
  res.status(httpStatus).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}
