/**
 * Need Router — direct port of brain1/need_router.py, including the
 * imperative-phrase-matching + identity/social exclusion-list fix
 * from a prior fuzz-testing round (bare substring matching on words
 * like "call"/"set"/"start" false-positived constantly in natural
 * conversation before that fix).
 *
 * IMPORTANT SCOPE NOTE re: Sentinel's Issue 1 (Shadow Payload): this
 * build is thinking-brain-only, per explicit instruction. This module
 * only ever returns a classification label (info/automation/confirm/
 * research/chat) — there is no execution engine, Brain 2, or Safety
 * Chain in this codebase to attach an action to. An "automation"
 * classification here is inert data, not a trigger. Every call to
 * routeNeed() is logged to auditLog.js regardless of outcome, so if
 * Brain 2 is ever built and wired to this classification later, there
 * is already a visible trail of every classification decision this
 * router made — addressing the audit-trail half of Sentinel's
 * concern now, even though the actual Shadow Payload / execution
 * coupling itself doesn't exist yet to secure.
 */

import { logEvent } from './auditLog.js';

const AUTOMATION_PATTERNS = [
  /\b(open|close|launch)\s+(the\s+)?\w*\s*(app|wifi|bluetooth|camera|browser|settings)\b/,
  /\bturn\s+(on|off)\s+(the\s+)?(wifi|bluetooth|flashlight|data|hotspot|location|gps)\b/,
  /\b(enable|disable)\s+(the\s+)?(wifi|bluetooth|location|notifications|data)\b/,
  /\bdelete\s+(the\s+)?(file|photo|message|app|folder|all)\b/,
  /\bsend\s+(a\s+)?(message|text|email)\s+to\b/,
  /\bcall\s+(\w+\s+)?(on|via|using)\s+(whatsapp|phone|call)\b/,
  /\bset\s+(a\s+|an\s+)?(alarm|reminder|timer)\b/,
  /\bremind\s+me\s+to\b/,
  /\b(set|change|adjust)\s+(the\s+)?(brightness|volume)\b/,
  /\borganize\s+(my\s+)?files\b/,
  /\bclean\s+(up\s+)?(the\s+)?(storage|cache|files|junk)\b/,
  /\bkill\s+(the\s+)?app\b/,
  /\bstop\s+(the\s+)?(app|process|download|music|alarm)\b/,
  /\bstart\s+(the\s+)?(app|download|timer|recording)\b/,
];

const IDENTITY_SOCIAL_EXCLUSIONS = [
  /\bcall\s+me\b/,
  /\bwhat.{0,3}s?\s+my\s+name\b/,
  /\bmy\s+name\s+is\b/,
  /\b(he|she|they)\s+(calls?|called)\b/,
  /\bset\s+(the\s+)?mood\b/,
  /\blet'?s\s+start\s+over\b/,
  /\bstart(ed)?\s+(crying|laughing|talking|thinking)\b/,
];

const CONFIRM_HINTS = ['delete', 'format', 'reset', 'remove all', 'factory', 'erase'];
const RESEARCH_HINTS = ['research', 'deep', 'detail', 'explain in detail', 'sources'];
const INFO_HINTS = ['what', 'who', 'when', 'where', 'why', 'how', 'status', 'battery', 'tell me'];

export function routeNeed(text) {
  const t = (text || '').toLowerCase().trim();
  let result;

  if (t.startsWith('/deep') || t.startsWith('deep ')) {
    result = { need: 'research', risk: 'low', ask_first: false, reason: 'deep_mode' };
  } else if (IDENTITY_SOCIAL_EXCLUSIONS.some(pat => pat.test(t))) {
    // identity/social phrases always win over automation pattern
    // matches, even if an automation-looking word appears in them —
    // fall through to info/chat classification below
    result = classifyRemaining(t);
  } else if (AUTOMATION_PATTERNS.some(pat => pat.test(t))) {
    const risk = CONFIRM_HINTS.some(h => t.includes(h)) ? 'high' : 'low';
    result = { need: 'automation', risk, ask_first: risk === 'high', reason: 'action_verbs' };
  } else {
    result = classifyRemaining(t);
  }

  logEvent('need_classification', { text_len: t.length, ...result });
  return result;
}

function classifyRemaining(t) {
  if (RESEARCH_HINTS.some(h => t.includes(h))) {
    return { need: 'research', risk: 'low', ask_first: false, reason: 'research_words' };
  }
  if (INFO_HINTS.some(h => t.includes(h)) || t.endsWith('?')) {
    return { need: 'info', risk: 'low', ask_first: false, reason: 'question' };
  }
  if (['hi', 'hello', 'hey', 'thanks', 'thank you', 'good morning'].some(h => t.includes(h))) {
    return { need: 'chat', risk: 'low', ask_first: false, reason: 'social' };
  }
  return { need: 'info', risk: 'low', ask_first: false, reason: 'default' };
}
