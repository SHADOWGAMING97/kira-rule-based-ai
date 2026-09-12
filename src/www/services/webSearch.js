/**
 * DuckDuckGo search — direct port of brain1/web_search.py. Uses
 * Capacitor's native HTTP bridge (same reasoning as the Life Change
 * project's FortyGuard client: native requests aren't subject to
 * WebView CORS policy at all, sidestepping an untestable question
 * rather than gambling on it). Goes through nativeHttp.js's direct
 * bridge call rather than importing '@capacitor/core' as a package —
 * see nativeHttp.js for why the package import doesn't work in this
 * bundler-free project.
 */

import { nativeHttpGet } from './nativeHttp.js';

export const MAX_FETCH_BYTES = 200_000; // matches Python's bounded-read cap
export const REQUEST_TIMEOUT_MS = 6000;

async function fetchUrl(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await nativeHttpGet({
    url,
    headers: { 'User-Agent': 'Kira-Brain1/1.0 (personal assistant)' },
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`fetch failed: HTTP ${response.status}`);
  }
  // CapacitorHttp auto-parses JSON; for the HTML fallback path we need
  // the raw text, so response.data may already be a string or an
  // object depending on content-type — normalize to string here.
  const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  // Bounded-size discipline, matching Python's chunked-read cap —
  // CapacitorHttp doesn't expose raw chunked reads, so this trims
  // after the fact; still bounds what downstream code processes.
  return text.length > MAX_FETCH_BYTES ? text.slice(0, MAX_FETCH_BYTES) : text;
}

/**
 * Tries DuckDuckGo Instant Answer API first, falls back to a
 * lightweight HTML scrape. Returns a short text summary or null.
 */
export async function duckduckgoSearch(query, maxChars = 600) {
  query = (query || '').trim();
  if (!query) return null;

  const clean = query
    .replace(/\b(search|internet|research|google|find|look up|web)\b/gi, '')
    .trim()
    .replace(/^[\s?!.]+|[\s?!.]+$/g, '') || query;

  // 1. Instant Answer API
  try {
    const params = new URLSearchParams({
      q: clean, format: 'json', no_redirect: '1', no_html: '1', skip_disambig: '1',
    });
    const raw = await fetchUrl(`https://api.duckduckgo.com/?${params}`, 5000);
    const data = JSON.parse(raw);

    const textParts = [];
    if (data.AbstractText) textParts.push(data.AbstractText);
    if (data.Answer) textParts.push(String(data.Answer));
    if (data.Definition) textParts.push(data.Definition);

    const related = data.RelatedTopics || [];
    for (const item of related.slice(0, 3)) {
      if (item && typeof item === 'object' && item.Text) textParts.push(item.Text);
    }

    if (textParts.length > 0) {
      return textParts.join(' ').slice(0, maxChars).trim();
    }
  } catch (e) {
    // fall through to HTML fallback
  }

  // 2. Lightweight HTML fallback
  try {
    const params = new URLSearchParams({ q: clean });
    const html = await fetchUrl(`https://html.duckduckgo.com/html/?${params}`, 6000);
    let snippets = [...html.matchAll(/class="result__snippet"[^>]*>(.*?)<\/a?snipp?et?>/gis)].map(m => m[1]);
    if (snippets.length === 0) {
      snippets = [...html.matchAll(/class="result__snippet">(.*?)</gis)].map(m => m[1]);
    }
    const cleaned = snippets.slice(0, 3)
      .map(s => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
      .filter(t => t.length > 0);
    if (cleaned.length > 0) return cleaned.join(' | ').slice(0, maxChars);
  } catch (e) {
    // both attempts failed
  }

  return null;
}

export function isSearchIntent(text) {
  const t = text.toLowerCase();
  const triggers = [
    'search', 'internet', 'research', 'look up', 'find about',
    'web search', 'google', 'what is', 'who is', 'tell me about',
  ];
  return triggers.some(k => t.includes(k));
}
