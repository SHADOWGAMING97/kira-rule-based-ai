/**
 * Response Shape Decider — direct port of understanding/response_shape.py.
 */

import { wordsOnly } from './tokenizer.js';

const STATUS_WORDS = ['kitna', 'kitni', 'how much', 'how many', 'what time', 'kab', 'kahan', 'where', 'is it', 'hai kya'];
const EXPLAIN_WORDS = ['why', 'kyu', 'kyun', 'kaise', 'how does', 'how do', 'explain', 'matlab', 'what does', 'samjhao'];
const CASUAL_GREETING = ['hi', 'hey', 'hello', 'yo', 'sup', 'hola'];

export const SHORT_MAX_WORDS = 12;
export const MEDIUM_MAX_WORDS = 30;

export function classifyQuestionType(text) {
  if (typeof text !== 'string' || !text) return 'general';
  const lowered = text.toLowerCase();
  const trimmed = lowered.trim();

  if (CASUAL_GREETING.some(g => trimmed === g || trimmed.startsWith(g + ' '))) return 'casual';
  if (STATUS_WORDS.some(p => lowered.includes(p))) return 'status';
  if (EXPLAIN_WORDS.some(p => lowered.includes(p))) return 'explain';
  return 'general';
}

export function decideTargetShape(queryText) {
  const qtype = classifyQuestionType(queryText);

  if (qtype === 'status' || qtype === 'casual') {
    return { shape: 'short', max_words: SHORT_MAX_WORDS, structured: false };
  }
  if (qtype === 'explain') {
    const wordCount = wordsOnly(queryText).length;
    if (wordCount > 8) return { shape: 'long', max_words: 80, structured: true };
    return { shape: 'medium', max_words: MEDIUM_MAX_WORDS, structured: false };
  }
  return { shape: 'medium', max_words: MEDIUM_MAX_WORDS, structured: false };
}

/** Trims (never pads/invents) a candidate reply to fit the target
 * shape's word budget. Cuts at a sentence boundary when possible. */
export function fitToShape(replyText, shape) {
  if (typeof replyText !== 'string' || !replyText) return '';

  const words = replyText.split(/\s+/);
  const maxWords = shape.max_words ?? MEDIUM_MAX_WORDS;
  if (words.length <= maxWords) return replyText;

  const truncated = words.slice(0, maxWords).join(' ');
  const lastEnd = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'));
  if (lastEnd > 0) return truncated.slice(0, lastEnd + 1);
  return truncated.replace(/[,;:]+$/, '') + '.';
}
