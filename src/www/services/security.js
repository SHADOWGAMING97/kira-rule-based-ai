/**
 * Security Layer — first gate. Direct port of shared/security.py.
 * Pipeline: type-check -> size limit -> malformed encoding ->
 * banned words -> banned combos -> PII redaction (before anything
 * is ever written to memory).
 */

export const MAX_INPUT_LEN = 2000;

const BANNED_WORDS = ["rm -rf", "format c:", "wipe device", "factory reset"];

const BANNED_COMBOS = [
  new Set(["clean", "everything"]),
  new Set(["delete", "all", "files"]),
  new Set(["delete", "all", "data"]),
];

// PII patterns: redact BEFORE anything is written to memory
const PII_PATTERNS = [
  /password\s*[:=]\s*\S+/gi,
  /\botp\s*[:=]?\s*\d{4,8}\b/gi,
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, // card-like
  /\b\d{10}\b/g, // phone-like (10 digit)
];

const HIGH_ENTROPY_RE = /\b[A-Za-z0-9+/_=-]{24,}\b/g;

function isHighEntropy(token) {
  if (token.length < 24) return false;
  const hasLower = /[a-z]/.test(token);
  const hasUpper = /[A-Z]/.test(token);
  const hasDigit = /[0-9]/.test(token);
  const classes = [hasLower, hasUpper, hasDigit].filter(Boolean).length;
  return classes >= 2;
}

export class SecurityResult {
  constructor(passed, reason = "", cleanText = "") {
    this.passed = passed;
    this.reason = reason;
    this.cleanText = cleanText;
  }
}

function checkSize(text) {
  if (text.length > MAX_INPUT_LEN) return new SecurityResult(false, "input_too_long");
  return new SecurityResult(true);
}

function checkMalformedEncoding(text) {
  // JS strings are already UTF-16 internally, so there's no direct
  // equivalent of Python's encode/decode round-trip failure — the
  // meaningful check here is control characters, which is the actual
  // security-relevant part of the original function.
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    if (isControl && ch !== "\n" && ch !== "\t" && ch !== "\r") {
      return new SecurityResult(false, "malformed_encoding");
    }
  }
  return new SecurityResult(true);
}

function checkBannedWords(text) {
  const lowered = text.toLowerCase();
  for (const phrase of BANNED_WORDS) {
    if (lowered.includes(phrase)) return new SecurityResult(false, `banned_word:${phrase}`);
  }
  return new SecurityResult(true);
}

function checkBannedCombos(text) {
  const words = new Set((text.toLowerCase().match(/[a-z]+/g) || []));
  for (const combo of BANNED_COMBOS) {
    let allPresent = true;
    for (const w of combo) {
      if (!words.has(w)) { allPresent = false; break; }
    }
    if (allPresent) {
      return new SecurityResult(false, `banned_combo:${[...combo].sort().join(",")}`);
    }
  }
  return new SecurityResult(true);
}

export function redactPii(text) {
  let cleaned = text;
  for (const pattern of PII_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[REDACTED]");
  }
  cleaned = cleaned.replace(HIGH_ENTROPY_RE, (token) => (isHighEntropy(token) ? "[REDACTED]" : token));
  return cleaned;
}

/**
 * Runs all checks in spec order. Returns cleanText (PII-redacted) on
 * pass — caller must use cleanText for anything written to memory.
 * Fail-closed: non-string/null/undefined input is rejected here,
 * first line, before any check assumes it has a string to work with
 * (this guard already exists in the Python version after a prior
 * fuzz-testing round — ported here from day one instead of
 * discovering the same crash again).
 */
export function runSecurityGate(text) {
  if (typeof text !== "string") {
    return new SecurityResult(false, "invalid_input_type");
  }
  for (const check of [checkSize, checkMalformedEncoding, checkBannedWords, checkBannedCombos]) {
    const result = check(text);
    if (!result.passed) return result;
  }
  return new SecurityResult(true, "", redactPii(text));
}
