/**
 * PMI Naturalness Scorer — direct port of response_generator/pmi_scorer.py.
 */

import { storageAdapter } from './storage.js';

const PMI_TABLE_KEY = 'kira:pmi_table';

function defaultTable() {
  return { unigram_counts: {}, pair_counts: {}, total_pairs: 0 };
}

export class PMIScorer {
  constructor() {
    this.table = defaultTable();
    this._loaded = false;
  }

  async load() {
    if (this._loaded) return;
    const raw = await storageAdapter.get(PMI_TABLE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        this.table = parsed && typeof parsed === 'object' ? parsed : defaultTable();
      } catch (e) {
        this.table = defaultTable();
      }
    }
    this._loaded = true;
  }

  async _save() {
    await storageAdapter.set(PMI_TABLE_KEY, JSON.stringify(this.table));
  }

  async trainOnSentence(sentence) {
    const words = (sentence.match(/[a-zA-Z']+/g) || []).map(w => w.toLowerCase());
    for (const w of words) {
      this.table.unigram_counts[w] = (this.table.unigram_counts[w] || 0) + 1;
    }
    for (let i = 0; i < words.length - 1; i++) {
      const pairKey = `${words[i]}|${words[i + 1]}`;
      this.table.pair_counts[pairKey] = (this.table.pair_counts[pairKey] || 0) + 1;
      this.table.total_pairs += 1;
    }
    await this._save();
  }

  pmi(wordA, wordB) {
    wordA = wordA.toLowerCase();
    wordB = wordB.toLowerCase();
    const totalUnigrams = Object.values(this.table.unigram_counts).reduce((a, b) => a + b, 0) || 1;
    const totalPairs = this.table.total_pairs || 1;

    const pA = (this.table.unigram_counts[wordA] || 0) / totalUnigrams;
    const pB = (this.table.unigram_counts[wordB] || 0) / totalUnigrams;
    const pairKey = `${wordA}|${wordB}`;
    const pAB = (this.table.pair_counts[pairKey] || 0) / totalPairs;

    if (pAB === 0 || pA === 0 || pB === 0) return 0.0;
    return Math.log2(pAB / (pA * pB));
  }

  sentenceNaturalness(sentence) {
    const words = (sentence.match(/[a-zA-Z']+/g) || []).map(w => w.toLowerCase());
    if (words.length < 2) return 0.5;
    const scores = [];
    for (let i = 0; i < words.length - 1; i++) {
      scores.push(Math.max(0.0, this.pmi(words[i], words[i + 1])));
    }
    if (scores.length === 0) return 0.5;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return Math.min(1.0, avg / 5.0);
  }
}
