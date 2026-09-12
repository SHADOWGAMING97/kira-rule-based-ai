/**
 * Confidence Engine — direct port of brain1/confidence_engine.py.
 * 4-signal weighted truth filter.
 */

const WEIGHTS = {
  offline: { W1: 0.50, W2: 0.20, W3: 0.30, max: 10 },
  online: { W1: 0.30, W2: 0.50, W3: 0.20, max: 8 },
  markov_only: { W1: 0.00, W2: 0.60, W3: 0.40, max: 6 },
};

const STOPWORDS = new Set(['the', 'a', 'is', 'hai', 'ka', 'ki', 'ko', 'and', 'aur', 'to']);

export function extractKeywords(text) {
  return (text.match(/[a-zA-Z']+/g) || [])
    .map(w => w.toLowerCase())
    .filter(w => !STOPWORDS.has(w) && w.length > 2);
}

/** Keyword overlap between query and reply, +0.1 bonus if a keyword
 * leads the matched fact — stops Markov from answering fluently but wrong. */
export function queryRelevance(queryText, candidateReply) {
  const qKeywords = extractKeywords(queryText);
  if (qKeywords.length === 0) return 0.5;
  const replyWords = extractKeywords(candidateReply);
  const qSet = new Set(qKeywords);
  const overlap = replyWords.filter(w => qSet.has(w)).length / qKeywords.length;
  const bonus = replyWords.length > 0 && qSet.has(replyWords[0]) ? 0.1 : 0.0;
  return Math.min(1.0, overlap + bonus);
}

/** 1.0 if we actually have retrieved content backing the reply, else 0. */
export function factMatch(knowledgeResult) {
  return knowledgeResult.source !== 'none' && knowledgeResult.content ? 1.0 : 0.0;
}

export function computeConfidence(knowledgeResult, candidateReply, queryText, markovCoherence) {
  const trustKey = knowledgeResult.trust in WEIGHTS ? knowledgeResult.trust : 'markov_only';
  const w = WEIGHTS[trustKey];

  const fm = factMatch(knowledgeResult);
  const qr = queryRelevance(queryText, candidateReply);
  const mc = Math.max(0.0, Math.min(1.0, markovCoherence));

  const raw = fm * w.W1 + qr * w.W2 + mc * w.W3;
  const score = Math.round(raw * w.max * 10) / 10;

  let action;
  if (score >= 8) action = 'send';
  else if (score >= 6) action = 'send_tagged';
  else if (score >= 4) action = 'insufficient_info';
  else action = 'dont_know';

  return { score, action, trust: trustKey, source: knowledgeResult.source };
}
