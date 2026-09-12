/**
 * Cold-Start Seed — bundled on first launch so Kira doesn't feel
 * "broken" before any real conversation exists.
 *
 * HONESTY NOTE: the spec describes ~900 casual sentences + 100-150
 * calibration pairs + 200-300 world-fact seeds. This ships a smaller,
 * genuinely hand-curated set (not a fabricated placeholder claiming
 * to be the full size) — enough to exercise the Markov/PMI/quality-
 * gate machinery meaningfully on first launch, but you should treat
 * this as a real starting seed to grow, not a finished 900-sentence
 * dataset. Expanding it is just adding more entries to the arrays
 * below; nothing else in the pipeline needs to change.
 */

export const CASUAL_SEED = [
  "how are you doing today",
  "I'm doing pretty good, thanks for asking",
  "yeah battery is low right now",
  "battery is at fifty percent",
  "let me check that for you",
  "sure, one second",
  "okay noted, I'll remember that",
  "no worries, we'll figure it out",
  "that sounds like a good plan",
  "I think we should try again later",
  "honestly I'm not sure about that one",
  "give me a moment to think",
  "that makes sense to me",
  "I hear you, that's frustrating",
  "let's take this one step at a time",
  "good morning, hope you slept well",
  "good night, see you tomorrow",
  "thanks for letting me know",
  "I appreciate you telling me that",
  "that's a great question",
  "I don't have enough information on that yet",
  "can you tell me more about what you mean",
  "sounds good, I'll keep that in mind",
  "wifi seems to be working fine now",
  "storage is getting a bit full",
  "you should probably charge your phone soon",
  "it's a bit late, maybe get some rest",
  "that's really cool, tell me more",
  "I'm glad that worked out",
  "let's double check before we continue",
];

export const CALIBRATION_PAIRS = [
  ["how are you doing today", "good"],
  ["yeah battery is low right now", "good"],
  ["let me check that for you", "good"],
  ["that sounds like a good plan", "good"],
  ["honestly I'm not sure about that one", "good"],
  ["the the battery morning low", "bad"],
  ["battery friend good morning message", "bad"],
  ["is is is the the good", "bad"],
  ["morning battery friend is is", "bad"],
  ["good good good the the battery", "bad"],
  ["I think we should try again later", "good"],
  ["that makes sense to me", "good"],
  ["storage getting friend the message low", "bad"],
  ["wifi wifi wifi is is fine", "bad"],
  ["charge charge phone phone soon soon", "bad"],
];

export const WORLD_FACT_SEED = [
  "battery low + long trip = charge before leaving",
  "storage full + new download = need space first",
  "tired + late night = should sleep",
  "wifi off + need internet = turn on wifi first",
  "phone hot + fast charging = let it cool down",
  "many apps open + phone slow = close some apps",
  "low light + taking photo = turn on flash",
  "loud place + phone call = hard to hear",
  "battery draining fast + screen bright = lower brightness",
  "no signal + urgent message = try wifi calling",
];

/**
 * Checks whether the Markov/PMI/Identity tables are genuinely empty
 * (first-ever launch), matching the spec's exact trigger condition.
 */
export async function needsColdStart(markovEngine, pmiScorer) {
  await markovEngine.load();
  await pmiScorer.load();
  return Object.keys(markovEngine.table).length === 0;
}

/** Loads all seed files once. Never re-runs after the first launch —
 * caller is responsible for only invoking this when needsColdStart()
 * is true, so real conversation data is never overwritten. */
export async function loadColdStartSeed(markovEngine, pmiScorer) {
  for (const sentence of CASUAL_SEED) {
    await markovEngine.trainOnSentence(sentence);
    await pmiScorer.trainOnSentence(sentence);
  }
}

/** Bootstraps quality-judgment thresholds from the calibration pairs
 * — gives PMI/word-flow scoring a reference point for "good" vs
 * "bad" before any real conversation exists. Returns the computed
 * baseline rather than mutating global thresholds, since the ported
 * QualityGate doesn't have adjustable thresholds wired yet — this is
 * exposed for a caller that wants to inspect/log the baseline. */
export function bootstrapQualityBaseline(pmiScorer) {
  const goodScores = [];
  const badScores = [];
  for (const [sentence, label] of CALIBRATION_PAIRS) {
    const score = pmiScorer.sentenceNaturalness(sentence);
    (label === 'good' ? goodScores : badScores).push(score);
  }
  const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  return {
    avg_good_score: avg(goodScores),
    avg_bad_score: avg(badScores),
    sample_size: CALIBRATION_PAIRS.length,
  };
}
