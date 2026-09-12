/**
 * Silent Identity Learning — direct port of response_generator/style_learner.py.
 * Extracts first-person facts automatically. Only fires on clear,
 * non-uncertain first-person statements.
 */

const IDENTITY_PATTERNS = [
  [/\bi am (\w+)\b/i, 'name'],
  [/\bmy name is (\w+)\b/i, 'name'],
  [/\bcall me (\w+)\b/i, 'nickname'],
  [/\bi work at ([\w\s]+?)(?:\.|$)/i, 'workplace'],
  [/\bi want to ([\w\s]+?)(?:\.|$)/i, 'goal'],
  [/\bmy (\w+) is ([A-Z][\w]+)\b/, 'relationship'],
  [/\bi usually (\w[\w\s]*?)(?:\.|$)/i, 'habit'],
];

const UNCERTAINTY_WORDS = ['maybe', 'probably', 'i think', 'not sure', 'shayad', 'lagta hai'];
const PROTECTED_KEYS = new Set(['name', 'nickname', 'goal']);

function hasUncertainty(text) {
  const lowered = text.toLowerCase();
  return UNCERTAINTY_WORDS.some(u => lowered.includes(u));
}

/** Returns list of [key, value, protected] tuples. Caller writes to
 * IdentityStore — kept separate so this module has no storage coupling. */
export function extractIdentityFacts(text) {
  if (hasUncertainty(text)) return [];

  const facts = [];
  for (const [pattern, key] of IDENTITY_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      if (key === 'relationship') {
        const [, relKey, value] = match;
        facts.push([relKey.toLowerCase(), value, false]);
      } else {
        const value = match[1].trim();
        facts.push([key, value, PROTECTED_KEYS.has(key)]);
      }
    }
  }
  return facts;
}
