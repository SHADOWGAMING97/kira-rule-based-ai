/**
 * /deep research mode — direct port of brain1/deep_research.py.
 * Fetches a few sources (3-8, not 50-60), returns structured chunks.
 */

import { duckduckgoSearch } from './webSearch.js';

export function isDeep(text) {
  const t = (text || '').trim().toLowerCase();
  return t.startsWith('/deep') || t.startsWith('deep research');
}

export function extractTopic(text) {
  let t = (text || '').trim();
  t = t.replace(/^\/deep\s*/i, '');
  t = t.replace(/^deep research\s*/i, '');
  return t.trim() || 'general topic';
}

export async function runDeep(topic, fetchFn = null, maxChunks = 4) {
  topic = (topic || '').trim();
  if (!topic) return 'Tell me a topic after /deep. Example: /deep black holes';

  const pieces = [];

  let primary = null;
  if (fetchFn) {
    try { primary = await fetchFn(topic, 'deep'); } catch (e) { primary = null; }
  }
  if (!primary) {
    try { primary = await duckduckgoSearch(topic, 700); } catch (e) { primary = null; }
  }
  if (primary) pieces.push(primary);

  const relatedQueries = [`${topic} overview`, `${topic} key facts`, `${topic} simple explanation`];
  for (const rq of relatedQueries) {
    if (pieces.length >= maxChunks) break;
    let extra = null;
    try { extra = await duckduckgoSearch(rq, 350); } catch (e) { extra = null; }
    if (extra && !pieces.includes(extra)) pieces.push(extra);
  }

  if (pieces.length === 0) {
    return `Deep research: ${topic}\n\nI could not fetch sources right now. Check internet / try again.`;
  }

  const lines = [`Deep research: ${topic}`, ''];
  lines.push('Overview:');
  lines.push(pieces[0].slice(0, 500));
  lines.push('');

  if (pieces.length > 1) {
    lines.push('More points:');
    pieces.slice(1).forEach((p, i) => lines.push(`${i + 1}. ${p.slice(0, 280)}`));
    lines.push('');
  }

  lines.push('Note: Based on a few web sources (not 50+). Say /deep <topic> again to refine.');
  return lines.join('\n');
}
