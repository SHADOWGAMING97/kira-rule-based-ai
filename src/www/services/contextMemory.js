/**
 * Context Memory — direct port of brain1/context_memory.py.
 * Keeps ~50-100 words of recent conversation for continuity.
 */

export const MAX_WORDS = 100;
export const MAX_TURNS = 6;

export class ContextMemory {
  constructor(maxWords = MAX_WORDS, maxTurns = MAX_TURNS) {
    this.maxWords = maxWords;
    this.maxTurns = maxTurns;
    this._turns = [];
  }

  add(user, bot) {
    this._turns.push({ user: (user || '').trim(), bot: (bot || '').trim() });
    if (this._turns.length > this.maxTurns) this._turns.shift();
    this._trimWords();
  }

  _wordCount() {
    return this._turns.reduce((n, t) => n + t.user.split(/\s+/).filter(Boolean).length + t.bot.split(/\s+/).filter(Boolean).length, 0);
  }

  _trimWords() {
    while (this._wordCount() > this.maxWords && this._turns.length > 1) {
      this._turns.shift();
    }
  }

  asText() {
    const parts = [];
    for (const t of this._turns) {
      if (t.user) parts.push('User: ' + t.user);
      if (t.bot) parts.push("Kira: " + t.bot);
    }
    return parts.join('\n');
  }

  recentUserWords() {
    const joined = this._turns.filter(t => t.user).map(t => t.user).join(' ');
    return joined.slice(-400);
  }

  lastTopicHint() {
    if (this._turns.length === 0) return '';
    const words = this._turns[this._turns.length - 1].user.split(/\s+/);
    return words.filter(w => w.length > 3).join(' ').slice(0, 80);
  }
}
