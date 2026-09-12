/**
 * Word Knowledge — categorize a word, learn unknowns, save locally.
 * Direct port of understanding/word_knowledge.py, with Sentinel's
 * Issue 2 fix applied: unbounded per-word internet fetch had no
 * rate-limit/cap and no audit trail, which is (a) a silent
 * battery/data drain risk if many unknown words appear in one
 * conversation, and (b) a privacy leak surface (private conversation
 * words going to an external server with no visibility).
 *
 * Fix: a per-day fetch cap (same "max sessions per day" pattern
 * already used for Sleep Consolidation elsewhere in this
 * architecture), and every fetch attempt — successful, failed, or
 * blocked by the cap — is logged to auditLog.js.
 *
 * fetch is injected (fetchFn) so this module has zero network
 * coupling — caller decides HOW to fetch.
 */

import { storageAdapter } from './storage.js';
import { logEvent } from './auditLog.js';

const WORD_MAP_KEY = 'kira:word_categories';
const FETCH_COUNT_KEY = 'kira:word_fetch_count';

// Sentinel Issue 2 fix — hard daily cap on unknown-word internet
// lookups, mirroring the Sleep Consolidation "max sessions per day"
// pattern already used elsewhere in this architecture.
export const MAX_WORD_FETCHES_PER_DAY = 40;

const DEFAULT_CATEGORIES = {
  person: ['ali', 'lucky', 'mom', 'dad', 'friend'],
  device: ['phone', 'wifi', 'bluetooth', 'battery', 'charger'],
  action: ['send', 'open', 'call', 'delete', 'check', 'turn', 'show'],
  state: ['low', 'high', 'critical', 'full', 'empty', 'on', 'off'],
  time: ['today', 'tomorrow', 'yesterday', 'now', 'later'],
  object: ['message', 'file', 'photo', 'app', 'note'],
};

function defaultWordMap() {
  const map = {};
  for (const [cat, words] of Object.entries(DEFAULT_CATEGORIES)) {
    for (const w of words) map[w] = cat;
  }
  return map;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function loadWordMap() {
  const raw = await storageAdapter.get(WORD_MAP_KEY);
  if (!raw) return defaultWordMap();
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : defaultWordMap();
  } catch (e) {
    return defaultWordMap();
  }
}

async function saveWordMap(map) {
  await storageAdapter.set(WORD_MAP_KEY, JSON.stringify(map));
}

async function getTodayFetchCount() {
  const raw = await storageAdapter.get(FETCH_COUNT_KEY);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.day === todayKey() ? parsed.count : 0;
  } catch (e) {
    return 0;
  }
}

async function incrementTodayFetchCount() {
  const current = await getTodayFetchCount();
  await storageAdapter.set(FETCH_COUNT_KEY, JSON.stringify({ day: todayKey(), count: current + 1 }));
  return current + 1;
}

/**
 * @param {string} word
 * @param {() => boolean} isOnlineFn
 * @param {(word: string) => Promise<string|null>} fetchFn
 * @returns {Promise<string>} category, or "unknown_needs_clarification"
 */
export async function categorizeWord(word, isOnlineFn = null, fetchFn = null) {
  if (typeof word !== 'string') return 'unknown_needs_clarification';
  word = word.toLowerCase().trim();
  if (!word) return 'unknown_needs_clarification';

  const wordMap = await loadWordMap();
  if (word in wordMap) return wordMap[word];

  if (isOnlineFn && fetchFn && isOnlineFn()) {
    const fetchCount = await getTodayFetchCount();
    if (fetchCount >= MAX_WORD_FETCHES_PER_DAY) {
      // Sentinel Issue 2 — cap enforced, and the block itself is
      // audited too, not just successful fetches, so a pattern of
      // hitting the cap repeatedly is visible for review.
      logEvent('word_fetch', { word, outcome: 'blocked_daily_cap', fetchCount });
      return 'unknown_needs_clarification';
    }

    let category = null;
    try {
      category = await fetchFn(word);
    } catch (e) {
      category = null;
    }
    await incrementTodayFetchCount();

    if (category) {
      wordMap[word] = category;
      await saveWordMap(wordMap);
      logEvent('word_fetch', { word, outcome: 'success', category });
      return category;
    }
    logEvent('word_fetch', { word, outcome: 'failed' });
  }

  return 'unknown_needs_clarification';
}

export async function knownWords() {
  return loadWordMap();
}

/** Manual/explicit teach — e.g. after clarification from the user. */
export async function learnWord(word, category) {
  const wordMap = await loadWordMap();
  wordMap[word.toLowerCase().trim()] = category;
  await saveWordMap(wordMap);
}

/** Exposed for a settings/debug screen — how many fetches used today. */
export async function todayFetchUsage() {
  const count = await getTodayFetchCount();
  return { used: count, max: MAX_WORD_FETCHES_PER_DAY, remaining: Math.max(0, MAX_WORD_FETCHES_PER_DAY - count) };
}
