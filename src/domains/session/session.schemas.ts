/**
 * Session Domain Zod Schemas
 *
 * Schemas for session management tools (cookies, state, lifecycle)
 */

import { z } from 'zod';
import { BrowserCookieSchema, SessionStateSchema } from '../../shared/schemas/index.js';

// ===== SESSION COOKIES GET =====

export const SessionCookiesGetInputSchema = z.object({
  urls: z.array(z.string().url()).optional().describe('URLs to filter cookies by'),
});

export const SessionCookiesGetOutputSchema = z.object({
  cookies: z.array(BrowserCookieSchema).describe('Retrieved cookies'),
});

// ===== SESSION COOKIES SET =====

export const SessionCookiesSetInputSchema = z.object({
  cookies: z
    .array(
      z.object({
        name: z.string().describe('Cookie name'),
        value: z.string().describe('Cookie value'),
        url: z.string().url().optional().describe('Cookie URL'),
        domain: z.string().optional().describe('Cookie domain'),
        path: z.string().optional().default('/').describe('Cookie path'),
        secure: z.boolean().optional().default(false).describe('Secure flag'),
        httpOnly: z.boolean().optional().default(false).describe('HttpOnly flag'),
        sameSite: z.enum(['Strict', 'Lax', 'None']).optional().default('Lax').describe('SameSite attribute'),
        expires: z.number().optional().describe('Expiration timestamp'),
      }),
    )
    .describe('Cookies to set'),
});

export const SessionCookiesSetOutputSchema = z.object({
  success: z.boolean().describe('Whether cookies were set successfully'),
  error: z.string().optional().describe('Error message if failed'),
});

// ===== SESSION STATE GET =====

export const SessionStateGetInputSchema = z.object({});

export const SessionStateGetOutputSchema = z.object({
  state: SessionStateSchema.describe('Current session state snapshot'),
});

// ===== SESSION STATE SET =====

export const SessionStateSetInputSchema = z.object({
  state: SessionStateSchema.describe('Session state to restore'),
});

export const SessionStateSetOutputSchema = z.object({
  success: z.boolean().describe('Whether state was restored successfully'),
  error: z.string().optional().describe('Error message if failed'),
});

// ===== SESSION CLOSE =====

export const SessionCloseInputSchema = z.object({
  saveState: z.boolean().optional().default(false).describe('Whether to save state before closing'),
});

export const SessionCloseOutputSchema = z.object({
  success: z.boolean().describe('Whether session was closed successfully'),
  state: SessionStateSchema.optional().describe('Saved session state if saveState was true'),
  error: z.string().optional().describe('Error message if failed'),
});
