/**
 * Navigation Domain Zod Schemas
 *
 * Schemas for all navigation-related tools
 */

import { z } from 'zod';

// ===== NAV GOTO =====

export const NavGotoInputSchema = z.object({
  url: z.string().url().describe('URL to navigate to'),
  waitUntil: z
    .enum(['load', 'domcontentloaded', 'networkidle'])
    .optional()
    .default('load')
    .describe('Event to wait for after navigation'),
  timeout: z.number().optional().default(30000).describe('Navigation timeout in milliseconds'),
});

export const NavGotoOutputSchema = z.object({
  success: z.boolean().describe('Whether navigation succeeded'),
  url: z.string().optional().describe('Final URL after navigation'),
  error: z.string().optional().describe('Error message if failed'),
});

// ===== NAV BACK =====

export const NavBackInputSchema = z.object({});

export const NavBackOutputSchema = z.object({
  success: z.boolean().describe('Whether navigation back succeeded'),
  currentUrl: z.string().optional().describe('Current URL after going back'),
  error: z.string().optional().describe('Error message if failed'),
});

// ===== NAV FORWARD =====

export const NavForwardInputSchema = z.object({});

export const NavForwardOutputSchema = z.object({
  success: z.boolean().describe('Whether navigation forward succeeded'),
  currentUrl: z.string().optional().describe('Current URL after going forward'),
  error: z.string().optional().describe('Error message if failed'),
});

// ===== NAV RELOAD =====

export const NavReloadInputSchema = z.object({
  ignoreCache: z.boolean().optional().default(false).describe('Whether to bypass cache'),
});

export const NavReloadOutputSchema = z.object({
  success: z.boolean().describe('Whether reload succeeded'),
  url: z.string().optional().describe('Current URL after reload'),
  error: z.string().optional().describe('Error message if failed'),
});

// ===== NAV GET URL =====

export const NavGetUrlInputSchema = z.object({});

export const NavGetUrlOutputSchema = z.object({
  url: z.string().describe('Current page URL'),
  title: z.string().optional().describe('Current page title'),
});

// ===== NAV WAIT FOR NAVIGATION =====

export const NavWaitForNavigationInputSchema = z.object({
  waitUntil: z
    .enum(['load', 'domcontentloaded', 'networkidle'])
    .optional()
    .default('load')
    .describe('Event to wait for'),
  timeout: z.number().optional().default(30000).describe('Wait timeout in milliseconds'),
});

export const NavWaitForNavigationOutputSchema = z.object({
  success: z.boolean().describe('Whether wait completed successfully'),
  url: z.string().optional().describe('Current URL after navigation'),
  error: z.string().optional().describe('Error message if failed'),
});
