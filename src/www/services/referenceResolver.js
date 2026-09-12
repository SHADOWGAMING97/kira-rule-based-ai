/**
 * Reference Resolution — direct port of understanding/reference_resolver.py.
 */

const PRONOUNS = new Set(['he', 'she', 'it', 'him', 'her', 'they', 'them']);
const DEMONSTRATIVES = new Set(['that', 'this']);
const REPEAT_PHRASES = ['do it again', 'same again', 'again', 'repeat that', 'repeat it'];

const RELATIVE_TIME = { yesterday: -1, tomorrow: 1, today: 0 };

function isoDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * @param {string} text
 * @param {{last_entity?, last_command?, last_topic?, now?: Date}} conversationState
 * @returns {object} non-destructive resolution description
 */
export function resolve(text, conversationState = {}) {
  const lowered = (text || '').toLowerCase().trim();
  const now = conversationState.now || new Date();
  const resolved = {};

  for (const phrase of REPEAT_PHRASES) {
    if (lowered.includes(phrase)) {
      resolved.repeat_command = conversationState.last_command;
      break;
    }
  }

  const words = lowered.match(/[a-zA-Z']+/g) || [];
  for (const w of words) {
    if (PRONOUNS.has(w) && !('resolved_entity' in resolved)) {
      resolved.resolved_entity = conversationState.last_entity;
    }
    if (DEMONSTRATIVES.has(w) && !('resolved_reference' in resolved)) {
      resolved.resolved_reference = conversationState.last_topic;
    }
    if (w in RELATIVE_TIME && !('resolved_time' in resolved)) {
      const delta = RELATIVE_TIME[w];
      const d = new Date(now);
      d.setDate(d.getDate() + delta);
      resolved.resolved_time = isoDateOnly(d);
    }
  }

  return resolved;
}
