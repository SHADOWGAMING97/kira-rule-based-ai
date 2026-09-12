/**
 * Confusion Detection — direct port of understanding/confusion_learner.py.
 * Learned, not hardcoded. Signals feed the GeneralLearningEngine; the
 * user's confirmation supplies the training outcome.
 */

import { GeneralLearningEngine } from './learningEngine.js';

const QUESTION_INDICATORS = ['kya', 'kyu', 'kaise', 'matlab', 'what', 'why', 'how', 'mean', '?'];
const NEGATIVE_WORDS = ['nahi', 'nope', 'no', 'wrong', 'galat'];
const CONFIRM_UNDERSTOOD = ['haan samajh aaya', 'samajh gaya', 'got it', 'makes sense', 'ok got it'];
const CONFIRM_STILL_CONFUSED = ['phir bhi nahi', 'still confused', "still don't get it", 'nahi samjha'];

export const LEARNED_THRESHOLD = 0.55;

// module-level singleton, mirrors the Python pattern. Call
// ensureLoaded() once before first use (async load from storage).
export const confusionEngine = new GeneralLearningEngine('confusion', 0.5);
let _loaded = false;
export async function ensureLoaded() {
  if (!_loaded) {
    await confusionEngine.load();
    _loaded = true;
  }
}

export function hasQuestionIndicators(text) {
  const lowered = text.toLowerCase();
  return QUESTION_INDICATORS.some(ind => lowered.includes(ind));
}

export function negativeToneWithReference(text) {
  const lowered = text.toLowerCase();
  const hasNegative = NEGATIVE_WORDS.some(w => lowered.includes(w));
  const hasReference = lowered.includes('that') || lowered.includes('matlab') || lowered.includes('vo');
  return hasNegative && hasReference;
}

export function shortAfterLongExplanation(text, lastBotReply) {
  return Boolean(lastBotReply) && lastBotReply.split(/\s+/).length > 25 && text.split(/\s+/).length <= 4;
}

export function repeatedSimilarQuestion(text, lastUserText) {
  if (!lastUserText) return false;
  const a = new Set(text.toLowerCase().split(/\s+/));
  const b = new Set(lastUserText.toLowerCase().split(/\s+/));
  if (a.size === 0 || b.size === 0) return false;
  const intersection = [...a].filter(x => b.has(x)).length;
  const overlap = intersection / Math.max(a.size, b.size);
  return overlap > 0.5;
}

export function detectSignals(inputText, conversationState = {}) {
  const signals = [];
  const lastBotReply = conversationState.last_bot_reply || '';
  const lastUserText = conversationState.last_user_text || '';

  if (shortAfterLongExplanation(inputText, lastBotReply)) signals.push('short_after_long');
  if (hasQuestionIndicators(inputText)) signals.push('has_question');
  if (repeatedSimilarQuestion(inputText, lastUserText)) signals.push('repeated_question');
  if (negativeToneWithReference(inputText)) signals.push('negative_reference');
  return signals;
}

export async function detectConfusionSmart(inputText, conversationState = {}) {
  await ensureLoaded();
  const signals = detectSignals(inputText, conversationState);
  return confusionEngine.predict(signals) > LEARNED_THRESHOLD;
}

/** Call this on the NEXT turn after a confusion-handling reply.
 * Returns true if a training signal was found and applied. */
export async function trainFromConfirmation(inputText, conversationState = {}) {
  await ensureLoaded();
  const lowered = inputText.toLowerCase();
  const signals = conversationState.last_confusion_signals || [];
  if (signals.length === 0) return false;

  if (CONFIRM_UNDERSTOOD.some(p => lowered.includes(p))) {
    await confusionEngine.learn(signals, true);
    return true;
  }
  if (CONFIRM_STILL_CONFUSED.some(p => lowered.includes(p))) {
    await confusionEngine.learn(signals, true); // confusion signal WAS confusion, still unresolved
    return true;
  }
  return false;
}

function simplifyPart(part) {
  const words = part.split(/\s+/);
  if (words.length > 12) return words.slice(0, 12).join(' ') + '...';
  return part;
}

/** Simplify, don't repeat verbatim. */
export function handleConfusion(lastExplanation) {
  if (!lastExplanation) return "Can you tell me what part didn't make sense?";

  const parts = lastExplanation
    .split(/\s+(?:and|because|so|kyunki|aur)\s+/i)
    .map(p => p.trim().replace(/\.$/, ''))
    .filter(p => p.length > 0);

  if (parts.length > 1) {
    return parts.map((p, i) => `${i + 1}. ${simplifyPart(p)}`).join('\n');
  }
  return simplifyPart(lastExplanation);
}
