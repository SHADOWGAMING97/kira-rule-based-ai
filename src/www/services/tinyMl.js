/**
 * Tiny ML layer — direct port of brain1/tiny_ml.py. Pure JS, no
 * external ML library. Used for intent classification and picking
 * a canned reply when CBR/Markov are weak.
 */

import { storageAdapter } from './storage.js';

const WEIGHTS_KEY = 'kira:tiny_ml_weights';

export const INTENT_LABELS = ['greeting', 'thanks', 'battery', 'search', 'identity', 'unknown'];

const GREETING_WORDS = new Set(['hi', 'hello', 'hey', 'good', 'morning', 'night', 'namaste']);
const THANKS_WORDS = new Set(['thanks', 'thank', 'thx', 'dhanyavad']);
const BATTERY_WORDS = new Set(['battery', 'charge', 'power', 'percent', 'charging']);
const SEARCH_WORDS = new Set(['search', 'internet', 'research', 'google', 'find', 'lookup', 'what', 'who']);
const IDENTITY_WORDS = new Set(['who', 'you', 'name', 'lsa', 'kira', 'assistant']);

function textFeatures(text) {
  const t = (text || '').toLowerCase();
  const words = new Set(t.split(/\s+/).filter(w => w));
  const hasAny = (set) => [...words].some(w => set.has(w));
  return [
    hasAny(GREETING_WORDS) ? 1.0 : 0.0,
    hasAny(THANKS_WORDS) ? 1.0 : 0.0,
    hasAny(BATTERY_WORDS) ? 1.0 : 0.0,
    hasAny(SEARCH_WORDS) ? 1.0 : 0.0,
    hasAny(IDENTITY_WORDS) ? 1.0 : 0.0,
    Math.min(words.size / 10.0, 1.0),
    t.includes('?') ? 1.0 : 0.0,
    Math.min(t.length / 80.0, 1.0),
  ];
}

function sigmoid(x) {
  if (x < -40) return 0.0;
  if (x > 40) return 1.0;
  return 1.0 / (1.0 + Math.exp(-x));
}

export class TinyNet {
  constructor(nIn = 8, nH = 10, nOut = 6, lr = 0.15) {
    this.nIn = nIn; this.nH = nH; this.nOut = nOut; this.lr = lr;
    const lim1 = Math.sqrt(6 / (nIn + nH));
    const lim2 = Math.sqrt(6 / (nH + nOut));
    this.w1 = Array.from({ length: nIn }, () => Array.from({ length: nH }, () => (Math.random() * 2 - 1) * lim1));
    this.b1 = new Array(nH).fill(0.0);
    this.w2 = Array.from({ length: nH }, () => Array.from({ length: nOut }, () => (Math.random() * 2 - 1) * lim2));
    this.b2 = new Array(nOut).fill(0.0);
  }

  forward(x) {
    const h = [];
    for (let j = 0; j < this.nH; j++) {
      let s = this.b1[j];
      for (let i = 0; i < this.nIn; i++) s += x[i] * this.w1[i][j];
      h.push(Math.tanh(s));
    }
    const o = [];
    for (let k = 0; k < this.nOut; k++) {
      let s = this.b2[k];
      for (let j = 0; j < this.nH; j++) s += h[j] * this.w2[j][k];
      o.push(sigmoid(s));
    }
    return [o, h];
  }

  predict(x) {
    const [o] = this.forward(x);
    return o;
  }

  trainOne(x, target) {
    const [o, h] = this.forward(x);
    const dO = o.map((ok, k) => (ok - target[k]) * ok * (1 - ok));
    const dH = [];
    for (let j = 0; j < this.nH; j++) {
      let err = 0;
      for (let k = 0; k < this.nOut; k++) err += dO[k] * this.w2[j][k];
      dH.push(err * (1 - h[j] * h[j]));
    }
    for (let j = 0; j < this.nH; j++) {
      for (let k = 0; k < this.nOut; k++) this.w2[j][k] -= this.lr * dO[k] * h[j];
    }
    for (let k = 0; k < this.nOut; k++) this.b2[k] -= this.lr * dO[k];
    for (let i = 0; i < this.nIn; i++) {
      for (let j = 0; j < this.nH; j++) this.w1[i][j] -= this.lr * dH[j] * x[i];
    }
    for (let j = 0; j < this.nH; j++) this.b1[j] -= this.lr * dH[j];
    return o.reduce((sum, ok, k) => sum + (ok - target[k]) ** 2, 0);
  }

  toDict() {
    return { n_in: this.nIn, n_h: this.nH, n_out: this.nOut, lr: this.lr, w1: this.w1, b1: this.b1, w2: this.w2, b2: this.b2 };
  }

  static fromDict(d) {
    const net = new TinyNet(d.n_in, d.n_h, d.n_out, d.lr ?? 0.15);
    net.w1 = d.w1; net.b1 = d.b1; net.w2 = d.w2; net.b2 = d.b2;
    return net;
  }
}

const BOOTSTRAP_SAMPLES = [
  ['hello', 'greeting'], ['hi there', 'greeting'], ['good morning', 'greeting'],
  ['hey', 'greeting'], ['namaste', 'greeting'],
  ['thank you', 'thanks'], ['thanks a lot', 'thanks'], ['thx', 'thanks'],
  ['battery low', 'battery'], ['what is my battery', 'battery'],
  ['battery percent', 'battery'], ['charging status', 'battery'],
  ['search tesla', 'search'], ['internet research black hole', 'search'],
  ['look up python', 'search'], ['what is gravity', 'search'],
  ['who are you', 'identity'], ['what is your name', 'identity'],
  ['tell me about yourself', 'identity'], ['what should i call you', 'identity'],
  ['organize my files', 'unknown'], ['random stuff xyz', 'unknown'],
  // Negative examples for 'identity' — a real bug found while testing
  // this port: 'name' alone was enough to fire 'identity', so a user
  // stating THEIR OWN name ("my name is Lucky") misfired as a
  // question about Kira's identity. These teach the net that
  // possessive/self-referential phrasing ("my name") is NOT the same
  // signal as asking about Kira ("your name"/"who are you").
  ['my name is Lucky', 'unknown'], ['call me L', 'unknown'],
  ['my name is Ali', 'unknown'], ['just so you know my name is Sam', 'unknown'],
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class TinyIntentML {
  constructor() {
    this.net = null;
    this._loaded = false;
  }

  async load() {
    if (this._loaded) return;
    const raw = await storageAdapter.get(WEIGHTS_KEY);
    if (raw) {
      try {
        this.net = TinyNet.fromDict(JSON.parse(raw));
        this._loaded = true;
        return;
      } catch (e) { /* fall through to bootstrap */ }
    }
    this.net = new TinyNet();
    this._bootstrapTrain(this.net);
    await this._save();
    this._loaded = true;
  }

  async _save() {
    await storageAdapter.set(WEIGHTS_KEY, JSON.stringify(this.net.toDict()));
  }

  _bootstrapTrain(net, epochs = 40) {
    const labelIdx = Object.fromEntries(INTENT_LABELS.map((n, i) => [n, i]));
    for (let e = 0; e < epochs; e++) {
      for (const [text, lab] of shuffle(BOOTSTRAP_SAMPLES)) {
        const x = textFeatures(text);
        const target = new Array(INTENT_LABELS.length).fill(0.0);
        target[labelIdx[lab]] = 1.0;
        net.trainOne(x, target);
      }
    }
  }

  predictIntent(text) {
    const x = textFeatures(text);
    const scores = this.net.predict(x);
    let bestI = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bestI]) bestI = i;
    return [INTENT_LABELS[bestI], Math.round(scores[bestI] * 1000) / 1000];
  }

  async learn(text, intent) {
    if (!INTENT_LABELS.includes(intent)) return;
    const x = textFeatures(text);
    const target = new Array(INTENT_LABELS.length).fill(0.0);
    target[INTENT_LABELS.indexOf(intent)] = 1.0;
    this.net.trainOne(x, target);
    await this._save();
  }
}

export const INTENT_REPLIES = {
  greeting: ['Hello! How can I help you?', 'Hi! What do you need?', "Hey, I'm here."],
  thanks: ['You are welcome.', 'Anytime!', 'Glad I could help.'],
  battery: ['I can help with battery status. Tell me more.', 'Battery checks are available if you want.'],
  identity: ['I am Kira, your personal assistant.', "I'm Kira — built to help you on your phone."],
  search: ['Sure, tell me what to search.', 'I can look that up. What exactly?'],
  unknown: [],
};
