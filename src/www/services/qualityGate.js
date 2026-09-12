/**
 * Quality Gate — direct port of brain1/quality_gate.py.
 * Scores candidate replies, picks the best, applies anti-echo cooldown.
 */

export const EARLY_STOP_THRESHOLD = 0.85;
export const COOLDOWN_TURNS = 3;
export const COOLDOWN_PENALTY = 0.2;

export class QualityGate {
  constructor() {
    this._recentPhrases = new Map(); // phrase -> turnsRemaining
  }

  _tickCooldowns() {
    for (const [phrase, remaining] of this._recentPhrases) {
      const next = remaining - 1;
      if (next <= 0) this._recentPhrases.delete(phrase);
      else this._recentPhrases.set(phrase, next);
    }
  }

  _cooldownPenalty(candidate) {
    return this._recentPhrases.has(candidate.trim().toLowerCase()) ? COOLDOWN_PENALTY : 1.0;
  }

  scoreCandidate(candidate, keywords, pmiScorer, queryText) {
    if (!candidate) return 0.0;
    const words = candidate.split(/\s+/);

    const kw = new Set(keywords.map(k => k.toLowerCase()));
    const candWords = new Set(words.map(w => w.toLowerCase().replace(/[.,!?]/g, '')));
    const keywordScore = kw.size > 0
      ? [...kw].filter(w => candWords.has(w)).length / kw.size
      : 0.5;

    const lengthScore = words.length >= 5 && words.length <= 25 ? 1.0 : 0.5;

    const repeatScore = candWords.size === words.length ? 1.0 : 0.6;

    const flowScore = pmiScorer.sentenceNaturalness(candidate);
    const pmiScore = flowScore; // same signal, spec keeps separate weight slot

    const varietyScore = Math.min(1.0, candWords.size / Math.max(1, words.length));

    const raw = keywordScore * 0.25 + lengthScore * 0.15 + repeatScore * 0.15 +
                flowScore * 0.20 + pmiScore * 0.15 + varietyScore * 0.10;

    return Math.round(raw * this._cooldownPenalty(candidate) * 1000) / 1000;
  }

  pickBest(candidates, keywords, pmiScorer, queryText) {
    this._tickCooldowns();
    let best = null, bestScore = -1.0;
    for (const cand of candidates) {
      const score = this.scoreCandidate(cand, keywords, pmiScorer, queryText);
      if (score > bestScore) { best = cand; bestScore = score; }
      if (score >= EARLY_STOP_THRESHOLD) break;
    }
    if (best) {
      this._recentPhrases.set(best.trim().toLowerCase(), COOLDOWN_TURNS);
    }
    return [best, bestScore];
  }
}
