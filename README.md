# Kira — Brain 1 (thinking brain only)

A Capacitor Android port of Kira's Brain 1 (chat/conversation engine),
following the same pattern as the LSA_Life_Change_Backend Capacitor
project: plain JS, no bundler, everything co-located inside `webDir`
from the start.

**Scope: thinking-brain only.** Per explicit instruction, this build
does NOT include Brain 2 (automation/execution), the Safety Chain, the
Sandbox, or Sleep Consolidation. The Need Router still classifies
messages (including "automation"-shaped ones), but that classification
is inert data here — there is no execution engine anywhere in this
codebase for it to trigger anything.

## Sentinel's 3 flagged gaps — how each was addressed

A prior architecture review (Sentinel) flagged 3 gaps in the full
Kira spec. All 3 are inside this build's actual scope and are now
substantively addressed in code, not just noted as future work:

### Issue 1 — Shadow Payload / audit trail (Section 1.8)

The full spec's Shadow Payload (a hidden execution trigger riding
inside a chat reply) doesn't exist in this build at all — there's no
Brain 2 to attach an action to, so there's nothing to secure yet.

What *is* addressed now: **every Need Router classification is
audit-logged**, including "automation" classifications, regardless of
outcome (`needRouter.js` → `auditLog.js`, category `need_classification`).
If Brain 2 is ever built and wired to this classification later, there
will already be a complete, visible trail of every classification
decision this router made from day one — this is the audit-trail half
of Sentinel's concern, done now rather than retrofitted later.

### Issue 2 — `categorize_word()` unbounded internet fetch (1.3.1)

**Fixed.** `wordKnowledge.js` enforces `MAX_WORD_FETCHES_PER_DAY = 40`
— the same "max sessions per day" pattern the spec already uses for
Sleep Consolidation elsewhere. Every fetch attempt (success, failure,
or blocked-by-cap) is audit-logged under category `word_fetch`.

Tested: known words never touch the fetch counter; the 41st unknown
word in a day is correctly blocked (falls back to
`unknown_needs_clarification`, no crash) without incrementing the
counter further; the block itself is audited; offline/null/bad input
all fail closed.

### Issue 3 — `/learn`'s "link" source_type, no URL validation (4.3)

**Fixed.** `learnFilter.js`'s `validateLearnUrl()` blocks private,
loopback, and link-local IP ranges — `127.x`, `10.x`, `192.168.x`,
`172.16-31.x`, `169.254.x`, `::1`, `fe80:`, `fc00:`, `fd00:`,
`localhost` — **before any fetch is attempted**. This includes
`169.254.169.254`, the cloud-metadata endpoint that's a classic
real-world SSRF target — not explicitly named in the spec, but caught
by the same pattern. Only `http:`/`https:` schemes are allowed at all
(rejects `file://`, etc.). Every link-fetch attempt is audit-logged
under `learn_link_fetch`, including blocked attempts.

Tested comprehensively: all listed private ranges blocked; the cloud
metadata IP specifically blocked; public URLs (Wikipedia, example.com)
correctly allowed; empty/null/non-http-scheme/unparseable URLs all
fail closed; the full 5-stage `filterLearnInput()` pipeline (length →
coherence → relevance → PII redaction) tested end-to-end with both
accept and reject cases, including PII correctly redacted on accepted
content.

## Real bugs found while testing this port (not in the original spec)

Testing the assembled pipeline — not just each module in isolation —
surfaced 2 real bugs that unit tests on individual files wouldn't have
caught:

1. **TinyML misclassified self-naming as an identity question.**
   `"my name is Lucky"` was scoring as `identity` intent (the same
   bucket as `"who are you"`) because the bootstrap training set only
   had positive examples for the word "name," never a negative example
   distinguishing "my name" (user stating their own name) from "your
   name" (asking about Kira). Fixed by adding negative bootstrap
   examples. Verified: self-naming now correctly falls through to
   normal handling, while genuine identity questions still classify
   correctly.

2. **`makeFriendly()`'s decoration lowercased a standalone "I".**
   Sentences starting with the pronoun "I" (e.g. "I understood this
   as...") got the opener/closer decoration's `body[0].toLowerCase()`
   applied indiscriminately, producing "Quick answer: i understood...".
   Fixed with `_lowerFirstSafe()`, which skips lowercasing when the
   first word is exactly "I". Verified across both decoration paths
   (short-answer prefix and medium-answer prefix).

Both were caught by actually running `Brain1.respond()` end-to-end
with realistic inputs, not just testing each ported module against
its Python original in isolation — worth keeping in mind for future
rounds, since module-level parity tests alone wouldn't have surfaced
either one.

## What was ported

Direct 1:1 ports from the existing Brain 1 Python codebase
(`LsA_Brain1_Complete_Fixed.zip`), including bug fixes from prior
rounds carried over and re-verified in JS:

- `security.js` — PII redaction, banned words/combos, fail-closed on
  bad input (the None-guard from an earlier fuzz-testing round).
- `tokenizer.js`, `wordPlacement.js`, `referenceResolver.js` —
  understanding layer.
- `wordKnowledge.js` — **Sentinel Issue 2 fix** (see above).
- `learningEngine.js`, `confusionLearner.js` — weighted-signal
  confusion detection; the learning-loop math verified to match the
  Python original's exact numeric output.
- `cbrAdaptation.js` — includes the `extractTopic()` stopword fix
  from a prior round (avoids "how"/"i" false-matching CBR cases).
- `dataStores.js` — memory tiers; includes the CBR similarity fix
  (topic match required, tone/state alone can't trigger reuse).
- `webSearch.js` — DuckDuckGo search via `CapacitorHttp` (same
  CORS-avoidance reasoning as the Life Change project's FortyGuard
  client), 200KB bounded-read cap.
- `knowledgeRouter.js`, `confidenceEngine.js` — 4-signal confidence
  scoring, short-term → daily → CBR → internet priority.
- `markovEngine.js` — **both prior bug fixes re-verified**: stops at
  the first sentence-end token (prevents cross-topic stitching — 0/50
  stitched outputs in testing), and the punctuation-as-first-token
  render fix (no crash).
- `pmiScorer.js`, `styleLearner.js` (includes the "call me X" nickname
  fix), `qualityGate.js` — response generation and scoring.
- `responseOrganizer.js` — includes the `make_friendly()` opener/closer
  fix (canned fallback replies never get decorated) plus the new
  `_lowerFirstSafe()` fix found in this round.
- `selfCheck.js`, `needRouter.js` — includes the "call me L" /
  identity-vs-automation exclusion-pattern fix, now with every
  classification audited.
- `learnFilter.js` — **Sentinel Issue 3 fix** (see above).
- `responseShape.js`, `tinyMl.js` (bootstrap-trained, now with the
  self-naming fix), `contextMemory.js`, `learningTarget.js` (identity
  renamed L'sA → Kira per this build's naming), `deepResearch.js`
  (`/deep` mode), `deviceState.js` — supporting modules.
- `pipeline.js` — the `Brain1` orchestrator wiring everything above
  into the same flow as the Python `pipeline.py`.
- `auditLog.js` — **new module**, added specifically to give Issues 1–3
  a shared, bounded (FIFO, capped at 500 entries) audit trail.
- `coldStartSeed.js` — **honestly-scoped**: a small curated seed (30
  casual sentences, 15 calibration pairs, 10 world-fact seeds), not a
  fabricated placeholder claiming to be the spec's full ~900-sentence
  dataset. Treat this as a real starting point to expand, not a
  finished dataset — growing it is just adding entries to the arrays
  in `coldStartSeed.js`, nothing else needs to change.

## What's genuinely NOT done

- **No persona/tone layer** (the `micro_nn.py`/`tone_shaper.py`/
  `identity_persona.py`/`real_time_learner.py` modules from an earlier
  L'sA round). `pipeline.js`'s `Brain1` constructor accepts an optional
  `persona` argument and works correctly without one — this was left
  out of this round to keep the delivery focused on Sentinel's 3
  flagged issues plus a working thinking-brain pipeline. Porting it is
  a clean follow-up, not a redesign.
- **Cold-Start Seed is intentionally smaller than the full spec** (see
  above) — real, not fabricated, but not the full ~900+150+250 dataset.
- **First-turn acknowledgment quality is weak on a cold-start device.**
  E.g. `"my name is Lucky"` correctly stores the identity fact (verified:
  recalling it immediately after with "what is my name" works
  correctly), but the *immediate* reply to the naming statement itself
  is a generic fallback until the Markov table has more real
  conversation to draw from. This is a training-data/dataset
  limitation, not a logic bug — flagging it honestly rather than
  overselling cold-start quality.

## Standing limitation

Same as every prior Capacitor project built in this sandbox: no npm
registry access here (`npm view` returns 403), so `npx cap add android`
cannot be run or verified in this environment. All testing above is
plain-Node testing against hand-written stub packages for
`@capacitor/core` and `@capacitor/preferences` (created fresh for
testing, removed before packaging — verify with
`ls node_modules 2>/dev/null` after unzipping, should not exist). You
will need to run `npm install && npx cap add android` yourself.

## Setup

```bash
npm install
npx cap add android
npx cap sync android
node verify-build.js   # confirm the sync picked up real, fresh logic
npx cap open android    # or: npm run build:android
```

## Project structure

```
src/www/                — Capacitor's webDir — this ENTIRE folder is
                          what gets copied to the device on `cap sync`.
  index.html               — chat UI, wraps Brain1
  services/                — all ported logic, co-located inside
                              webDir from the start (learned from a
                              structural bug found in the Life Change
                              project — services must live inside
                              webDir or `cap sync` never copies them)
    pipeline.js              — Brain1 orchestrator
    security.js
    tokenizer.js
    wordKnowledge.js         — Sentinel Issue 2 fix
    wordPlacement.js
    referenceResolver.js
    learningEngine.js
    confusionLearner.js
    cbrAdaptation.js
    dataStores.js
    webSearch.js
    knowledgeRouter.js
    confidenceEngine.js
    markovEngine.js
    pmiScorer.js
    styleLearner.js
    qualityGate.js
    responseOrganizer.js
    selfCheck.js
    needRouter.js
    learnFilter.js           — Sentinel Issue 3 fix
    responseShape.js
    tinyMl.js
    contextMemory.js
    learningTarget.js
    deepResearch.js
    deviceState.js
    auditLog.js              — new, shared audit trail
    coldStartSeed.js
    storage.js               — Capacitor Preferences adapter
capacitor.config.ts
package.json
verify-build.js          — run after every `cap sync`, before building
```
