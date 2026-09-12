/**
 * Memory tier stores — direct port of brain1/data_stores.py.
 * ShortTermMemory stays in-memory (matches Python's RAM-only deque);
 * DailyMemory/CBRCaseStore/IdentityStore are storage-adapter-backed
 * instead of file-backed. Includes the CBR similarity fix from a
 * prior fuzz-testing round: topic match is REQUIRED, tone/user_state
 * alone must never trigger a case reuse.
 */

import { storageAdapter } from './storage.js';

export const DAILY_MEMORY_MAX_WORDS = 1000;
export const CBR_MAX_CASES = 500;
export const IDENTITY_MAX_WORDS = 500;

const DAILY_MEMORY_KEY = 'kira:daily_memory';
const CBR_CASES_KEY = 'kira:cbr_cases';
const IDENTITY_KEY = 'kira:identity';

async function loadJson(key, fallback) {
  const raw = await storageAdapter.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

async function saveJson(key, data) {
  await storageAdapter.set(key, JSON.stringify(data));
}

// ---------- Short-Term Memory (RAM, last 2 exchanges) ----------

export class ShortTermMemory {
  constructor(maxlen = 2) {
    this._maxlen = maxlen;
    this._turns = [];
  }

  addTurn(userText, botReply) {
    this._turns.push({ user: userText, bot: botReply, ts: Date.now() / 1000 });
    if (this._turns.length > this._maxlen) this._turns.shift();
  }

  getTurns() {
    return [...this._turns];
  }

  lastBotReply() {
    return this._turns.length > 0 ? this._turns[this._turns.length - 1].bot : '';
  }

  lastUserText() {
    return this._turns.length > 0 ? this._turns[this._turns.length - 1].user : '';
  }
}

// ---------- Daily Memory (storage, FIFO by word budget) ----------

export class DailyMemory {
  constructor(maxWords = DAILY_MEMORY_MAX_WORDS) {
    this.maxWords = maxWords;
    this._facts = null; // lazily loaded
  }

  async _ensureLoaded() {
    if (this._facts === null) this._facts = await loadJson(DAILY_MEMORY_KEY, []);
  }

  _totalWords() {
    return this._facts.reduce((sum, f) => sum + f.text.split(/\s+/).length, 0);
  }

  async addFact(text) {
    await this._ensureLoaded();
    this._facts.push({ text, ts: Date.now() / 1000 });
    while (this._totalWords() > this.maxWords && this._facts.length > 0) {
      this._facts.shift(); // FIFO
    }
    await saveJson(DAILY_MEMORY_KEY, this._facts);
  }

  async allFacts() {
    await this._ensureLoaded();
    return [...this._facts];
  }

  async search(keywords) {
    await this._ensureLoaded();
    const kw = new Set(keywords.map(k => k.toLowerCase()));
    return this._facts.filter(f => {
      const words = new Set(f.text.toLowerCase().split(/\s+/));
      return [...kw].some(k => words.has(k));
    });
  }
}

// ---------- CBR Case Store (storage, FIFO, similarity match) ----------

export class CBRCaseStore {
  constructor(maxCases = CBR_MAX_CASES) {
    this.maxCases = maxCases;
    this._cases = null;
  }

  async _ensureLoaded() {
    if (this._cases === null) this._cases = await loadJson(CBR_CASES_KEY, []);
  }

  async addCase(fingerprint, response) {
    await this._ensureLoaded();
    this._cases.push({ fingerprint, response, ts: Date.now() / 1000 });
    if (this._cases.length > this.maxCases) this._cases.shift(); // FIFO
    await saveJson(CBR_CASES_KEY, this._cases);
  }

  _similarity(a, b) {
    // Topic match is required — tone/user_state alone must never
    // trigger a case reuse (fix from a prior fuzz-testing round: this
    // is how unrelated turns got confused for each other before).
    if (!a.topic || a.topic !== b.topic) return 0.0;
    let score = 0.5; // topic match baseline
    const weights = { tone: 0.3, user_state: 0.2 };
    for (const [key, w] of Object.entries(weights)) {
      if (a[key] && a[key] === b[key]) score += w;
    }
    return score;
  }

  async findMostSimilar(fingerprint, minScore = 0.5) {
    await this._ensureLoaded();
    let best = null, bestScore = 0.0;
    for (const c of this._cases) {
      const score = this._similarity(fingerprint, c.fingerprint);
      if (score > bestScore) { best = c; bestScore = score; }
    }
    if (best && bestScore >= minScore) return [best, bestScore];
    return [null, 0.0];
  }

  async allCases() {
    await this._ensureLoaded();
    return [...this._cases];
  }
}

// ---------- Identity Store (core facts, permanent-ish, capped) ----------

export class IdentityStore {
  constructor(maxWords = IDENTITY_MAX_WORDS) {
    this.maxWords = maxWords;
    this._facts = null;
  }

  async _ensureLoaded() {
    if (this._facts === null) this._facts = await loadJson(IDENTITY_KEY, {});
  }

  async setFact(key, value, protectedFact = false) {
    await this._ensureLoaded();
    this._facts[key] = { value, protected: protectedFact, ts: Date.now() / 1000 };
    this._enforceCap();
    await saveJson(IDENTITY_KEY, this._facts);
  }

  async getFact(key) {
    await this._ensureLoaded();
    const entry = this._facts[key];
    return entry ? entry.value : null;
  }

  async allFacts() {
    await this._ensureLoaded();
    return { ...this._facts };
  }

  _enforceCap() {
    let totalWords = Object.values(this._facts).reduce((sum, v) => sum + String(v.value).split(/\s+/).length, 0);
    if (totalWords <= this.maxWords) return;

    const evictable = Object.keys(this._facts)
      .filter(k => !this._facts[k].protected)
      .sort((a, b) => this._facts[a].ts - this._facts[b].ts);

    for (const k of evictable) {
      if (totalWords <= this.maxWords) break;
      totalWords -= String(this._facts[k].value).split(/\s+/).length;
      delete this._facts[k];
    }
  }
}
