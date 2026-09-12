/**
 * Audit Log — new module, added specifically to close the audit-trail
 * gaps Sentinel flagged in the architecture review:
 * - Issue 1: Shadow Payload attach events (pass AND reject) need their
 *   own audit entry, not just "must pass through Safety Chain."
 * - Issue 2: external word-lookup fetches need to be logged, since
 *   private conversation words leaving the device to an external
 *   server is a privacy-relevant event even when the fetch succeeds.
 * - Issue 3: /learn link fetches need the same treatment, plus the
 *   URL-validation outcome (blocked as private-IP vs. allowed).
 *
 * Bounded by design — this is a rolling log, not unbounded growth:
 * capped entry count, oldest entries drop first (FIFO), same
 * discipline as every other capped store in this architecture
 * (Daily Memory, CBR Case Store, etc).
 */

const MAX_ENTRIES = 500;

let _log = [];

export function logEvent(category, detail) {
  _log.push({
    category,   // e.g. "word_fetch", "learn_link_fetch", "shadow_payload"
    detail,     // plain object, category-specific shape
    ts: Date.now() / 1000,
  });
  if (_log.length > MAX_ENTRIES) {
    _log.splice(0, _log.length - MAX_ENTRIES); // drop oldest, keep newest MAX_ENTRIES
  }
}

export function getLog(category = null) {
  if (category) return _log.filter(e => e.category === category);
  return [..._log];
}

export function clearLog() {
  _log = [];
}
