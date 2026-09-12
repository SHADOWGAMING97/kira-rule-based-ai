/**
 * Tokenizer — direct port of understanding/tokenizer.py.
 * Keeps contractions whole, extracts numbers, treats punctuation as
 * intensity-aware signal tokens instead of dropping it.
 */

const TOKEN_RE = /[a-zA-Z]+(?:'[a-zA-Z]+)?|\d+(?:\.\d+)?|[.!?]+|[^\sa-zA-Z0-9.!?]/g;
export const SENTENCE_END = new Set([".", "!", "?"]);

export class Token {
  constructor(text, kind) {
    this.text = text;
    this.kind = kind; // "word" | "number" | "punct" | "other"
  }
}

function classify(raw) {
  if (/[0-9]/.test(raw[0])) return "number";
  if (/[a-zA-Z]/.test(raw[0])) return "word";
  if (SENTENCE_END.has(raw[0])) return "punct";
  return "other";
}

/** Returns list of Token objects. Non-string/empty input -> []. */
export function tokenize(text) {
  if (typeof text !== "string" || !text) return [];

  const tokens = [];
  const matches = text.match(TOKEN_RE) || [];
  for (const raw of matches) {
    const kind = classify(raw);
    if (kind === "punct") {
      tokens.push(new Token(raw[0], "punct")); // collapse "!!!" to one signal
    } else {
      tokens.push(new Token(raw, kind));
    }
  }
  return tokens;
}

/** Backward-compatible helper: plain lowercase word strings. */
export function wordsOnly(text) {
  return tokenize(text).filter(t => t.kind === "word").map(t => t.text.toLowerCase());
}

/** Intensity-aware punctuation counts — distinguishes '?' from '???'. */
export function punctuationSignals(text) {
  if (typeof text !== "string" || !text) {
    return { questionMarks: 0, exclamationMarks: 0, periods: 0 };
  }
  return {
    questionMarks: (text.match(/\?/g) || []).length,
    exclamationMarks: (text.match(/!/g) || []).length,
    periods: (text.match(/\./g) || []).length,
  };
}

/** Extracts numeric tokens as floats. */
export function numbersIn(text) {
  return tokenize(text).filter(t => t.kind === "number").map(t => parseFloat(t.text));
}
