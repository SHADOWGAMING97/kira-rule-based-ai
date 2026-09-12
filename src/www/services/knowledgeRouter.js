/**
 * Knowledge Router — direct port of brain1/knowledge_router.py.
 * Priority: short-term -> daily memory -> CBR -> internet fallback.
 */

import { buildFingerprint } from './cbrAdaptation.js';
import { duckduckgoSearch, isSearchIntent } from './webSearch.js';

export class KnowledgeResult {
  constructor(source, content, trust) {
    this.source = source; // "short_term" | "daily_memory" | "cbr" | "internet" | "none"
    this.content = content;
    this.trust = trust;   // "offline" | "online" | "markov_only"
  }
}

export async function route(queryText, conversationState, shortTerm, dailyMemory, cbrStore, isOnlineFn = null, fetchFn = null) {
  // 1. Short-term memory — direct reference in last turns
  const lastBot = shortTerm.lastBotReply();
  if (lastBot) {
    const queryWords = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const lastBotLower = lastBot.toLowerCase();
    if (queryWords.some(w => lastBotLower.includes(w))) {
      return new KnowledgeResult('short_term', lastBot, 'offline');
    }
  }

  // 2. Daily memory
  const keywords = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const facts = await dailyMemory.search(keywords);
  if (facts.length > 0) {
    return new KnowledgeResult('daily_memory', facts[facts.length - 1].text, 'offline');
  }

  // 3. CBR case store
  const fingerprint = buildFingerprint(queryText, conversationState);
  const [caseMatch] = await cbrStore.findMostSimilar(fingerprint);
  if (caseMatch) {
    return new KnowledgeResult('cbr', caseMatch.response, 'offline');
  }

  // 4. Internet fallback
  if (isSearchIntent(queryText)) {
    let online = true;
    if (isOnlineFn) {
      try { online = Boolean(isOnlineFn()); } catch (e) { online = true; }
    }

    if (online) {
      let fetched = null;
      if (fetchFn) {
        try { fetched = await fetchFn(queryText, 'quick'); } catch (e) { fetched = null; }
      }
      if (!fetched) {
        try { fetched = await duckduckgoSearch(queryText); } catch (e) { fetched = null; }
      }

      if (fetched) {
        try { await dailyMemory.addFact(fetched); } catch (e) { /* non-fatal */ }
        return new KnowledgeResult('internet', fetched, 'online');
      }
    }
  }

  return new KnowledgeResult('none', '', 'markov_only');
}
