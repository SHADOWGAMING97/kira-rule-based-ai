/**
 * Response Organizer + Tiny Style NN — direct port of
 * brain1/response_organizer.py. Makes fetched/raw knowledge sound
 * friendly, controls short/medium/long length, online-learns from
 * simple good/bad feedback. Includes the make_friendly() fix from a
 * prior fuzz-testing round: canned confidence-fallback replies must
 * never get an opener/closer bolted on (that produced the
 * "Here's what I found — i don't have enough info" garble).
 */

import { storageAdapter } from './storage.js';

const WEIGHTS_KEY = 'kira:style_nn_weights';

const UNDECORATED_REPLIES = new Set([
  "i don't know that one.",
  "i don't have enough info on that yet.",
  "i don't have a good answer for that right now.",
]);

function sigmoid(x) {
  if (x < -40) return 0.0;
  if (x > 40) return 1.0;
  return 1.0 / (1.0 + Math.exp(-x));
}

/** Very small net: features -> score how 'friendly/natural' a reply is. */
export class StyleNet {
  constructor(nIn = 6, nH = 8, lr = 0.12) {
    this.nIn = nIn;
    this.nH = nH;
    this.lr = lr;
    const lim1 = Math.sqrt(6 / (nIn + nH));
    const lim2 = Math.sqrt(6 / (nH + 1));
    this.w1 = Array.from({ length: nIn }, () => Array.from({ length: nH }, () => (Math.random() * 2 - 1) * lim1));
    this.b1 = new Array(nH).fill(0.0);
    this.w2 = Array.from({ length: nH }, () => (Math.random() * 2 - 1) * lim2);
    this.b2 = 0.0;
  }

  _feat(text) {
    const t = text || '';
    const words = t.split(/\s+/).filter(w => w.length > 0);
    return [
      Math.min(words.length / 25.0, 1.0),
      /\bi \b|i'm|let|sure|here/i.test(t) ? 1.0 : 0.0,
      /^[A-Z]/.test(t) ? 1.0 : 0.0,
      /[.!?]$/.test(t.trim()) ? 1.0 : 0.0,
      /\b(source:|http|www\.)/i.test(t) ? 1.0 : 0.0,
      Math.min((t.match(/,/g) || []).length / 4.0, 1.0),
    ];
  }

  score(text) {
    const x = this._feat(text);
    const h = [];
    for (let j = 0; j < this.nH; j++) {
      let s = this.b1[j];
      for (let i = 0; i < this.nIn; i++) s += x[i] * this.w1[i][j];
      h.push(Math.tanh(s));
    }
    let o = this.b2;
    for (let j = 0; j < this.nH; j++) o += h[j] * this.w2[j];
    return sigmoid(o);
  }

  train(text, target) {
    const x = this._feat(text);
    const h = [];
    for (let j = 0; j < this.nH; j++) {
      let s = this.b1[j];
      for (let i = 0; i < this.nIn; i++) s += x[i] * this.w1[i][j];
      h.push(Math.tanh(s));
    }
    let oRaw = this.b2;
    for (let j = 0; j < this.nH; j++) oRaw += h[j] * this.w2[j];
    const o = sigmoid(oRaw);
    const dO = (o - target) * o * (1 - o);
    const dH = h.map((hj, j) => dO * this.w2[j] * (1 - hj * hj));

    for (let j = 0; j < this.nH; j++) this.w2[j] -= this.lr * dO * h[j];
    this.b2 -= this.lr * dO;
    for (let i = 0; i < this.nIn; i++) {
      for (let j = 0; j < this.nH; j++) this.w1[i][j] -= this.lr * dH[j] * x[i];
    }
    for (let j = 0; j < this.nH; j++) this.b1[j] -= this.lr * dH[j];
  }

  toDict() {
    return { w1: this.w1, b1: this.b1, w2: this.w2, b2: this.b2, nIn: this.nIn, nH: this.nH, lr: this.lr };
  }

  static fromDict(d) {
    const n = new StyleNet(d.nIn, d.nH, d.lr ?? 0.12);
    n.w1 = d.w1; n.b1 = d.b1; n.w2 = d.w2; n.b2 = d.b2;
    return n;
  }
}

export class ResponseOrganizer {
  constructor() {
    this.net = new StyleNet();
    this._pendingReply = null;
    this._loaded = false;
  }

  async load() {
    if (this._loaded) return;
    const raw = await storageAdapter.get(WEIGHTS_KEY);
    if (raw) {
      try {
        this.net = StyleNet.fromDict(JSON.parse(raw));
      } catch (e) {
        this.net = new StyleNet();
      }
    }
    this._loaded = true;
  }

  async _save() {
    try {
      await storageAdapter.set(WEIGHTS_KEY, JSON.stringify(this.net.toDict()));
    } catch (e) { /* non-fatal */ }
  }

  /** Lowercases only the first letter, and only when that doesn't
   * turn a standalone "I" into "i" — found this producing "Quick
   * answer: i understood..." while testing this port; "I" should
   * never be lowercased regardless of sentence position. */
  _lowerFirstSafe(text) {
    if (!text) return text;
    const firstWordMatch = text.match(/^[A-Za-z']+/);
    if (firstWordMatch && firstWordMatch[0] === 'I') return text;
    return text[0].toLowerCase() + text.slice(1);
  }

  _trimWords(text, maxWords) {
    const words = text.split(/\s+/);
    if (words.length <= maxWords) return text.trim();
    let cut = words.slice(0, maxWords).join(' ').replace(/[,;:]+$/, '');
    if (!/[.!?]$/.test(cut)) cut += '.';
    return cut;
  }

  /** Returns 'short' | 'medium' | 'long' */
  decideLength(query, prefer = null) {
    if (['short', 'medium', 'long'].includes(prefer)) return prefer;
    const q = (query || '').toLowerCase();
    if (['short', 'briefly', 'one line', 'chota', 'short me'].some(w => q.includes(w))) return 'short';
    if (['detail', 'explain', 'long', 'poora', 'samjhao', 'why', 'how'].some(w => q.includes(w))) return 'long';
    if (q.split(/\s+/).filter(w => w).length <= 3) return 'short';
    return 'medium';
  }

  /** Friendly rewrite of fetched/raw text. */
  makeFriendly(raw, query = '', length = 'medium') {
    if (!raw || typeof raw !== 'string') return raw || '';

    let text = raw.trim();

    const normalized = text.toLowerCase();
    if (UNDECORATED_REPLIES.has(normalized.replace(/\.$/, '') + '.') || UNDECORATED_REPLIES.has(normalized)) {
      return text;
    }

    text = text.replace(/\(source:.*?\)/gi, '');
    text = text.replace(/https?:\/\/\S+/g, '');
    text = text.replace(/\s+/g, ' ').trim();

    const low = text.toLowerCase();
    const hasOpener = ["here's", 'sure', 'okay', 'quick'].some(o => low.startsWith(o));

    const maxWordsMap = { short: 14, medium: 35, long: 70 };
    const maxWords = maxWordsMap[length] ?? 35;
    let body = this._trimWords(text, maxWords);

    if (length === 'short') {
      if (!hasOpener && body.split(/\s+/).length > 4 && body) {
        body = 'Quick answer: ' + this._lowerFirstSafe(body);
      }
      return body;
    }

    if (length === 'long') {
      if (!/[.!?]$/.test(body)) body += '.';
      if (!body.toLowerCase().includes('hope that helps')) body += ' Hope that helps.';
      return body;
    }

    if (!hasOpener && body.split(/\s+/).length > 6 && body) {
      body = "Here's what I found — " + this._lowerFirstSafe(body);
    }
    if (!/[.!?]$/.test(body)) body += '.';
    return body;
  }

  organize(candidates, query, length = null) {
    const resolvedLength = this.decideLength(query, length);
    const cleaned = (candidates || [])
      .filter(c => typeof c === 'string' && c.trim())
      .map(c => c.trim());
    if (cleaned.length === 0) return '';

    const scored = cleaned.map(c => [c, this.net.score(c)]);
    scored.sort((a, b) => b[1] - a[1]);
    const best = scored[0][0];
    return this.makeFriendly(best, query, resolvedLength);
  }

  noteReply(reply) {
    this._pendingReply = reply;
  }

  async learnFromFeedback(userText) {
    if (!this._pendingReply) return false;
    const t = (userText || '').toLowerCase();
    const pos = ['good', 'nice', 'great', 'perfect', 'thanks', 'acha', 'sahi', 'love'].some(w => t.includes(w));
    const neg = ['bad', 'wrong', 'stupid', 'garbage', 'bura', 'galat', 'useless'].some(w => t.includes(w));

    if (pos && !neg) {
      this.net.train(this._pendingReply, 0.9);
      await this._save();
      this._pendingReply = null;
      return true;
    }
    if (neg && !pos) {
      this.net.train(this._pendingReply, 0.15);
      await this._save();
      this._pendingReply = null;
      return true;
    }
    this._pendingReply = null;
    return false;
  }
}
