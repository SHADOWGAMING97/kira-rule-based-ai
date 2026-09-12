/**
 * General Learning Engine — direct port of understanding/learning_engine.py.
 * Reusable weighted-signal scorer, not fixed rules — weights update
 * from real (signals, outcome) feedback. Storage-adapter-backed
 * (Capacitor Preferences) instead of file-backed, same pattern as
 * every other persisted store in this port.
 */

import { storageAdapter } from './storage.js';

export class GeneralLearningEngine {
  constructor(name, initialWeight = 0.5, learningRate = 0.1) {
    this.name = name;
    this.learningRate = learningRate;
    this._key = `kira:learned_weights_${name}`;
    this._initialWeight = initialWeight;
    this.weights = {}; // populated by load(); call before first use
  }

  async load() {
    const raw = await storageAdapter.get(this._key);
    if (!raw) { this.weights = {}; return; }
    try {
      const parsed = JSON.parse(raw);
      this.weights = parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      this.weights = {};
    }
  }

  async _save() {
    await storageAdapter.set(this._key, JSON.stringify(this.weights));
  }

  _weightFor(signal) {
    return signal in this.weights ? this.weights[signal] : this._initialWeight;
  }

  /** outcome=true means the signal correctly predicted the target
   * (e.g. confusion confirmed). Nudges weight toward 1.0 or 0.0. */
  async updateWeight(signal, outcome) {
    const current = this._weightFor(signal);
    const target = outcome ? 1.0 : 0.0;
    this.weights[signal] = current + this.learningRate * (target - current);
    await this._save();
  }

  async learn(signals, outcome) {
    for (const signal of signals) {
      await this.updateWeight(signal, outcome);
    }
  }

  calculateProbability(signals) {
    if (!signals || signals.length === 0) return 0.0;
    const total = signals.reduce((sum, s) => sum + this._weightFor(s), 0);
    return Math.min(1.0, total / signals.length);
  }

  predict(signals) {
    return this.calculateProbability(signals);
  }
}
