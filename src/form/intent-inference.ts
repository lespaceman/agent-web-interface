/**
 * Intent Inference
 *
 * Infers the intent (login, signup, search, etc.) of a form
 * based on field labels, headings, and keyword matching.
 *
 * @module form/intent-inference
 */

import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type { FormIntent } from './types.js';

/**
 * Weighted keywords that indicate form intent.
 * Higher weight = more explicit signal (e.g., "create account" is more explicitly signup than "email")
 * Lower weight = ambiguous signal that appears in multiple form types
 */
export const INTENT_KEYWORDS: Record<FormIntent, { keyword: string; weight: number }[]> = {
  login: [
    { keyword: 'log in', weight: 3 },
    { keyword: 'login', weight: 3 },
    { keyword: 'sign in', weight: 3 },
    { keyword: 'signin', weight: 3 },
    // These are ambiguous - they appear in both login and signup forms
    { keyword: 'email', weight: 0.5 },
    { keyword: 'password', weight: 0.5 },
    { keyword: 'username', weight: 0.5 },
  ],
  signup: [
    { keyword: 'sign up', weight: 3 },
    { keyword: 'signup', weight: 3 },
    { keyword: 'register', weight: 3 },
    { keyword: 'create account', weight: 3 },
    { keyword: 'join', weight: 2 },
  ],
  search: [
    { keyword: 'search', weight: 3 },
    { keyword: 'find', weight: 2 },
    { keyword: 'lookup', weight: 2 },
    { keyword: 'query', weight: 2 },
  ],
  checkout: [
    { keyword: 'checkout', weight: 3 },
    { keyword: 'payment', weight: 2 },
    { keyword: 'order', weight: 2 },
    { keyword: 'purchase', weight: 2 },
    { keyword: 'buy now', weight: 3 },
  ],
  filter: [
    { keyword: 'filter', weight: 3 },
    { keyword: 'sort', weight: 2 },
    { keyword: 'refine', weight: 2 },
    { keyword: 'narrow', weight: 2 },
  ],
  settings: [
    { keyword: 'settings', weight: 3 },
    { keyword: 'preferences', weight: 2 },
    { keyword: 'configuration', weight: 2 },
    { keyword: 'options', weight: 1 },
  ],
  contact: [
    { keyword: 'contact', weight: 3 },
    { keyword: 'message', weight: 1 },
    { keyword: 'feedback', weight: 2 },
    { keyword: 'inquiry', weight: 2 },
  ],
  subscribe: [
    { keyword: 'subscribe', weight: 3 },
    { keyword: 'newsletter', weight: 3 },
    { keyword: 'email updates', weight: 2 },
  ],
  shipping: [
    { keyword: 'shipping', weight: 3 },
    { keyword: 'delivery', weight: 2 },
    { keyword: 'address', weight: 1 },
  ],
  payment: [
    { keyword: 'payment', weight: 3 },
    { keyword: 'credit card', weight: 3 },
    { keyword: 'billing', weight: 2 },
    { keyword: 'card number', weight: 3 },
  ],
  profile: [
    { keyword: 'profile', weight: 3 },
    { keyword: 'account', weight: 1 },
    { keyword: 'personal info', weight: 2 },
  ],
  unknown: [],
};

/**
 * Infer the intent of a form.
 */
export function inferIntent(
  snapshot: BaseSnapshot,
  fieldEids: string[],
  formNode?: ReadableNode
): FormIntent {
  // Collect all relevant text to analyze
  const textToAnalyze: string[] = [];

  // Add form node label if available
  if (formNode?.label) {
    textToAnalyze.push(formNode.label);
  }

  // Add form heading context
  if (formNode?.where.heading_context) {
    textToAnalyze.push(formNode.where.heading_context);
  }

  // Add field labels
  for (const eid of fieldEids) {
    const node = snapshot.nodes.find((n) => n.node_id === eid);
    if (node?.label) {
      textToAnalyze.push(node.label);
    }
    if (node?.attributes?.placeholder) {
      textToAnalyze.push(node.attributes.placeholder);
    }
  }

  const combinedText = textToAnalyze.join(' ').toLowerCase();

  // Score each intent using weighted keywords
  let bestIntent: FormIntent = 'unknown';
  let bestScore = 0;

  for (const [intent, keywordEntries] of Object.entries(INTENT_KEYWORDS)) {
    if (intent === 'unknown') continue;

    let score = 0;
    for (const entry of keywordEntries) {
      if (combinedText.includes(entry.keyword)) {
        score += entry.weight;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent as FormIntent;
    }
  }

  return bestIntent;
}

/**
 * Check if text contains any of the given keywords.
 */
export function hasIntentKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}
