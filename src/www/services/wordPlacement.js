/**
 * Word Placement — category + sentence position -> role understanding.
 * Direct port of understanding/word_placement.py. Uses the real
 * tokenizer (tokenizer.js) rather than a bare regex, matching the
 * already-hardened Python version.
 */

import { categorizeWord } from './wordKnowledge.js';
import { wordsOnly } from './tokenizer.js';

const SLOT_FOR_CATEGORY = {
  person: 'actor_or_target',
  action: 'action',
  object: 'object',
  device: 'object',
  state: 'state',
  time: 'time',
};

/**
 * @returns {Promise<{action, object, actor_or_target, state, time, unknown_words}>}
 */
export async function buildSlots(text, isOnlineFn = null, fetchFn = null) {
  const slots = { action: null, object: null, actor_or_target: null, state: null, time: null };
  const unknown = [];

  for (const token of wordsOnly(text)) {
    const category = await categorizeWord(token, isOnlineFn, fetchFn);
    if (category === 'unknown_needs_clarification') {
      unknown.push(token);
      continue;
    }
    const slot = SLOT_FOR_CATEGORY[category];
    if (slot && slots[slot] === null) {
      slots[slot] = token.toLowerCase();
    }
  }

  slots.unknown_words = unknown;
  return slots;
}
