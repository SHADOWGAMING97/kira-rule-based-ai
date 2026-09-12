/**
 * Trigram Markov Engine — direct port of response_generator/markov_engine.py.
 * HOW to say it, never WHAT to say. Trained on the user's messages
 * only, never on Kira's own replies (prevents feedback-loop decay).
 * Includes both bug fixes found during prior fuzz-testing rounds:
 * (1) stop at the FIRST sentence-end token, not after 2 keyword hits
 * — this is what prevented cross-topic sentence stitching; (2) the
 * punctuation-as-first-token render fix (avoids a crash on
 * out[-1]-when-empty).
 */

import { storageAdapter } from './storage.js';

const MARKOV_TABLE_KEY = 'kira:markov_table';
export const SENTENCE_END = new Set(['.', '!', '?']);

function tokenize(text) {
  return text.match(/[a-zA-Z']+|[.!?]/g) || [];
}

export class MarkovEngine {
  constructor() {
    this.table = {};
    this._loaded = false;
  }

  async load() {
    if (this._loaded) return;
    const raw = await storageAdapter.get(MARKOV_TABLE_KEY);
    if (raw) {
      try {
        this.table = JSON.parse(raw) || {};
      } catch (e) {
        this.table = {};
      }
    }
    this._loaded = true;
  }

  async _save() {
    await storageAdapter.set(MARKOV_TABLE_KEY, JSON.stringify(this.table));
  }

  /** Train ONLY on the user's own messages — never bot replies. */
  async trainOnSentence(sentence) {
    const tokens = tokenize(sentence);
    if (tokens.length < 3) return;
    for (let i = 0; i < tokens.length - 2; i++) {
      const key = `${tokens[i].toLowerCase()}|${tokens[i + 1].toLowerCase()}`;
      const nxt = tokens[i + 2].toLowerCase();
      if (!this.table[key]) this.table[key] = {};
      this.table[key][nxt] = (this.table[key][nxt] || 0) + 1;
    }
    await this._save();
  }

  _weightedChoice(bucket, temperature) {
    const words = Object.keys(bucket);
    const weights = words.map(w => Math.pow(bucket[w], 1.0 / Math.max(temperature, 0.01)));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return words[Math.floor(Math.random() * words.length)];
    let r = Math.random() * total;
    for (let i = 0; i < words.length; i++) {
      r -= weights[i];
      if (r <= 0) return words[i];
    }
    return words[words.length - 1];
  }

  predictNext(prevTwo, temperature = 0.5) {
    const key = prevTwo.length >= 2 ? `${prevTwo[0].toLowerCase()}|${prevTwo[1].toLowerCase()}` : null;
    const bucket = key ? this.table[key] : null;
    if (!bucket || Object.keys(bucket).length === 0) return null;
    return this._weightedChoice(bucket, temperature);
  }

  /**
   * @param {string[]|null} seedWords - last 2 tokens to start from, or
   *   null to pick a topical bigram containing a keyword
   * @param {string[]} keywords - words that (loosely) should appear
   * @param {number} temperature
   * @param {number} maxLen
   */
  generate(seedWords, keywords, temperature = 0.5, maxLen = 40) {
    const kwSet = new Set(keywords.map(k => k.toLowerCase()));
    const sentence = this._pickSeed(seedWords, kwSet);
    if (sentence.length === 0) return '';

    while (sentence.length < maxLen) {
      const nxt = this.predictNext(sentence.slice(-2), temperature);
      if (nxt === null) break;
      sentence.push(nxt);
      // Stop at the FIRST sentence-end token — bug fix from prior
      // fuzz testing: waiting for 2 keyword hits before stopping let
      // the chain wander into an unrelated trained sentence and
      // stitch two topics together. One generated clause = one sentence.
      if (SENTENCE_END.has(nxt)) break;
    }

    return this._render(sentence);
  }

  _pickSeed(seedWords, kwSet) {
    if (seedWords && seedWords.length >= 2) {
      return seedWords.slice(-2);
    }
    const keys = Object.keys(this.table);
    const candidates = keys.filter(k => k.split('|').some(part => kwSet.has(part)));
    if (candidates.length > 0) {
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];
      return chosen.split('|');
    }
    if (keys.length > 0) {
      const chosen = keys[Math.floor(Math.random() * keys.length)];
      return chosen.split('|');
    }
    return [];
  }

  /** Bug fix from prior fuzz testing: punctuation as the very first
   * token used to crash on out[-1] against an empty array. */
  _render(tokens) {
    const out = [];
    for (const tok of tokens) {
      if (SENTENCE_END.has(tok)) {
        if (out.length > 0) {
          out[out.length - 1] = out[out.length - 1] + tok;
        } else {
          out.push(tok); // punctuation was first token — don't crash, keep it
        }
      } else {
        out.push(tok);
      }
    }
    let text = out.join(' ');
    if (text) text = text[0].toUpperCase() + text.slice(1);
    if (text && !SENTENCE_END.has(text[text.length - 1])) text += '.';
    return text;
  }
}
