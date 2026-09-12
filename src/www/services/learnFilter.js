/**
 * /learn Content Quality Filter — direct port of the spec's
 * filter_learn_input(), with Sentinel's Issue 3 fix applied: fetching
 * an arbitrary "link" source with no URL validation is a lightweight
 * SSRF risk — a malicious or confused input could point at a private/
 * loopback address and accidentally probe the device's own local
 * services (which this architecture's own Loopback-Only rule says
 * should never be reachable this way).
 *
 * Fix: validateLearnUrl() blocks private/loopback/link-local ranges
 * BEFORE any fetch is attempted. Every link-source /learn attempt is
 * also audit-logged (Sentinel's audit-trail requirement), including
 * blocked ones — a repeated pattern of someone trying private IPs is
 * exactly the kind of thing that should be visible for review.
 */

import { CapacitorHttp } from '@capacitor/core';
import { redactPii } from './security.js';
import { extractKeywords } from './confidenceEngine.js';
import { logEvent } from './auditLog.js';

export const REJECT = 'reject';
export const ACCEPT = 'accept';

export const MIN_CONTENT_LENGTH = 10;
export const MAX_CONTENT_LENGTH = 2000;
export const MIN_RELEVANCE_THRESHOLD = 0.15;
const FETCH_TIMEOUT_MS = 6000;
const MAX_FETCH_BYTES = 200_000;

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd00:/i,
];

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);

/** Validates a URL is public-internet-only before any fetch. */
export function validateLearnUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { ok: false, reason: 'empty_url' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (e) {
    return { ok: false, reason: 'unparseable_url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'non_http_scheme' };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: 'blocked_hostname' };
  }

  if (PRIVATE_IP_PATTERNS.some(pat => pat.test(hostname))) {
    return { ok: false, reason: 'private_ip_range' };
  }

  return { ok: true };
}

async function fetchLink(url) {
  const validation = validateLearnUrl(url);
  if (!validation.ok) {
    logEvent('learn_link_fetch', { url, outcome: 'blocked', reason: validation.reason });
    throw new Error(`link rejected before fetch: ${validation.reason}`);
  }

  try {
    const response = await CapacitorHttp.get({
      url,
      connectTimeout: FETCH_TIMEOUT_MS,
      readTimeout: FETCH_TIMEOUT_MS,
    });
    if (response.status < 200 || response.status >= 300) {
      logEvent('learn_link_fetch', { url, outcome: 'http_error', status: response.status });
      throw new Error(`HTTP ${response.status}`);
    }
    const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    const bounded = text.length > MAX_FETCH_BYTES ? text.slice(0, MAX_FETCH_BYTES) : text;
    logEvent('learn_link_fetch', { url, outcome: 'success', bytes: bounded.length });
    return bounded;
  } catch (e) {
    if (!(e instanceof Error && e.message.startsWith('link rejected'))) {
      logEvent('learn_link_fetch', { url, outcome: 'fetch_error', error: e.message });
    }
    throw e;
  }
}

/** Cheap HTML-noise stripper — tags, scripts, common boilerplate. */
export function stripHtmlNoise(html) {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/** Coherence proxy: is there a reasonable ratio of real word
 * characters, and does it contain actual sentence-like structure? */
export function looksLikeRealSentences(text) {
  const words = text.match(/[a-zA-Z']{2,}/g) || [];
  if (words.length < 3) return false;
  const totalChars = text.replace(/\s/g, '').length;
  const wordChars = words.join('').length;
  if (totalChars === 0) return false;
  const ratio = wordChars / totalChars;
  return ratio > 0.5;
}

function keywordOverlap(text, pendingTopic) {
  if (!pendingTopic) return 1.0;
  const textKw = new Set(extractKeywords(text));
  const topicKw = extractKeywords(pendingTopic);
  if (topicKw.length === 0) return 1.0;
  const matched = topicKw.filter(k => textKw.has(k)).length;
  return matched / topicKw.length;
}

/**
 * @param {string} rawContentOrUrl - text content, or a URL if sourceType is 'link'
 * @param {'text'|'link'} sourceType
 * @param {string} pendingTopic - the topic that triggered the /learn request
 */
export async function filterLearnInput(rawContentOrUrl, sourceType, pendingTopic) {
  let rawContent = rawContentOrUrl;

  if (sourceType === 'link') {
    let fetched;
    try {
      fetched = await fetchLink(rawContentOrUrl);
    } catch (e) {
      return { status: REJECT, reason: `link fetch failed: ${e.message}` };
    }
    rawContent = stripHtmlNoise(fetched);
  }

  if (typeof rawContent !== 'string') {
    return { status: REJECT, reason: 'no content' };
  }

  if (rawContent.length < MIN_CONTENT_LENGTH || rawContent.length > MAX_CONTENT_LENGTH) {
    return { status: REJECT, reason: 'too short/long to be useful training data' };
  }

  if (!looksLikeRealSentences(rawContent)) {
    return { status: REJECT, reason: "doesn't look like coherent text" };
  }

  const relevance = keywordOverlap(rawContent, pendingTopic);
  if (relevance < MIN_RELEVANCE_THRESHOLD) {
    return { status: REJECT, reason: "doesn't seem related to what was asked" };
  }

  const cleaned = redactPii(rawContent);

  return { status: ACCEPT, content: cleaned };
}
