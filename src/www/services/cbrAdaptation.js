/**
 * CBR + Adaptation Engine — direct port of understanding/cbr_adaptation.py.
 * Retrieve closest past case, ADAPT it to the new input rather than
 * copy-pasting. Includes the extract_topic() stopword-list fix from a
 * prior fuzz-testing round (avoids "how"/"i" false-matching CBR cases).
 */

const TONE_KEYWORDS = {
  frustrated: ['ugh', 'argh', 'kyu nahi', 'not working', 'phir se'],
  happy: ['yay', 'great', 'thanks', 'nice', 'mast'],
  urgent: ['jaldi', 'abhi', 'now', 'urgent', 'asap'],
};

export const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'am', 'are', 'was', 'were', 'be', 'been',
  'hai', 'ka', 'ki', 'ko', 'and', 'aur', 'to', 'kya', 'how', 'what',
  'why', 'when', 'where', 'who', 'my', 'i', 'me', 'you', 'your',
  'it', 'this', 'that', 'of', 'in', 'on', 'at', 'do', 'does', 'did',
]);

/** Prefers the longest content word — cheap proxy for "most specific
 * noun" without a POS tagger, avoids short function-word false
 * matches ("how"/"i") polluting CBR similarity. */
export function extractTopic(text) {
  const words = (text.match(/[a-zA-Z']+/g) || [])
    .map(w => w.toLowerCase())
    .filter(w => !STOPWORDS.has(w));
  if (words.length === 0) return 'general';
  return words.reduce((longest, w) => (w.length > longest.length ? w : longest), words[0]);
}

export function detectEmotionalTone(text) {
  const lowered = text.toLowerCase();
  for (const [tone, keywords] of Object.entries(TONE_KEYWORDS)) {
    if (keywords.some(k => lowered.includes(k))) return tone;
  }
  return 'neutral';
}

export function buildFingerprint(text, conversationState = {}) {
  return {
    topic: extractTopic(text),
    tone: detectEmotionalTone(text),
    user_state: conversationState.activity || 'idle',
  };
}

/** Splits into clause-level chunks to swap keywords into later. */
export function extractStructure(oldCaseResponse) {
  return oldCaseResponse
    .split(/(?<=[.!?])\s+/)
    .map(c => c.trim())
    .filter(c => c.length > 0);
}

/** Replaces the old case's topic word with the new input's topic word
 * across the retrieved structure — cheap but effective adaptation. */
export function swapKeywords(structure, newInput) {
  const newTopic = extractTopic(newInput);
  const adapted = structure.map(clause => {
    const words = clause.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const bare = words[i].toLowerCase().replace(/[.,!?]/g, '');
      if (!STOPWORDS.has(bare) && words[i].length > 2) {
        words[i] = newTopic;
        break;
      }
    }
    return words.join(' ');
  });
  return adapted.join(' ');
}

export function adjustTone(response, currentTone) {
  if (currentTone === 'urgent' && !/[!.]$/.test(response)) {
    response += '!';
  }
  if (currentTone === 'frustrated') {
    response = response.replace(/[.!]+$/, '') + ", let's fix it.";
  }
  return response;
}

export function adaptCase(oldCaseResponse, newInput, currentTone) {
  const structure = extractStructure(oldCaseResponse);
  if (structure.length === 0) return oldCaseResponse;
  let newResponse = swapKeywords(structure, newInput);
  newResponse = adjustTone(newResponse, currentTone);
  return newResponse;
}

/** Rough overlap-based confidence: does the adapted response still
 * touch the new input's topic? 0.0-1.0. */
export function confidenceScorer(adaptedResponse, newInput) {
  const topic = extractTopic(newInput);
  return adaptedResponse.toLowerCase().includes(topic) ? 0.85 : 0.5;
}
