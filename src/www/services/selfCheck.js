/**
 * Self-Check layer — direct port of brain1/self_check.py.
 * Before sending, checks once: is this useful? Related? Clear?
 */

function overlap(a, b) {
  const wa = new Set((a || '').match(/[a-zA-Z']+/g)?.filter(w => w.length > 2).map(w => w.toLowerCase()) || []);
  const wb = new Set((b || '').match(/[a-zA-Z']+/g)?.filter(w => w.length > 2).map(w => w.toLowerCase()) || []);
  if (wa.size === 0) return 0.0;
  const intersection = [...wa].filter(w => wb.has(w)).length;
  return intersection / Math.max(1, wa.size);
}

/** Returns { ok, score, issues, fixed_reply } */
export function check(query, reply) {
  const issues = [];
  const q = (query || '').trim();
  const r = (reply || '').trim();

  if (!r) {
    return { ok: false, score: 0.0, issues: ['empty'], fixed_reply: "I don't know that one yet." };
  }

  const rel = overlap(q, r);
  if (rel < 0.08 && q.split(/\s+/).length > 2) {
    if (!['hi', 'hello', 'hey', 'thanks', 'thank'].some(x => q.toLowerCase().includes(x))) {
      issues.push('low_relevance');
    }
  }

  if (r.split(/\s+/).length < 2) issues.push('too_short');

  if (/\b(you are thank|i don't have a good answer)\b/i.test(r)) {
    issues.push('broken_phrase');
  }

  let score = 1.0;
  if (issues.includes('low_relevance')) score -= 0.35;
  if (issues.includes('too_short')) score -= 0.2;
  if (issues.includes('broken_phrase')) score -= 0.4;

  let fixed = r;
  if (issues.includes('broken_phrase')) {
    fixed = q.toLowerCase().includes('thank') ? 'You are welcome.' : 'I want to answer that better — can you rephrase?';
  }

  if (score < 0.5 && issues.includes('low_relevance')) {
    fixed = "I'm not sure that fully answers you. Want me to try a simpler version?";
  }

  const ok = score >= 0.55;
  return {
    ok,
    score: Math.round(Math.max(0.0, score) * 100) / 100,
    issues,
    fixed_reply: ok ? r : fixed,
  };
}
