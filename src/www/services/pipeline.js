/**
 * Kira Brain 1 Pipeline — direct port of brain1/pipeline.py:
 * Input -> Security -> Need Router -> (/deep | normal path)
 * -> Understanding -> Knowledge -> Candidates -> Confidence
 * -> Self-Check -> Friendly organize -> Output
 *
 * Brain 2 (automation execution) is intentionally NOT wired at all in
 * this build (thinking-brain-only scope, per explicit instruction).
 * The Need Router only ever returns a classification label — there is
 * no execution engine anywhere in this codebase for it to trigger.
 * Every classification (including "automation") is audit-logged
 * regardless of outcome (needRouter.js), addressing the audit-trail
 * half of Sentinel's Shadow-Payload concern now, even though the
 * Shadow Payload / Brain 2 coupling itself doesn't exist to secure.
 */

import { runSecurityGate } from './security.js';
import { refreshTime } from './deviceState.js';
import { buildSlots } from './wordPlacement.js';
import { resolve as resolveReference } from './referenceResolver.js';
import * as confusionLearner from './confusionLearner.js';
import * as cbrAdaptation from './cbrAdaptation.js';
import { extractIdentityFacts } from './styleLearner.js';
import * as knowledgeRouter from './knowledgeRouter.js';
import * as confidenceEngine from './confidenceEngine.js';
import { QualityGate } from './qualityGate.js';
import { ShortTermMemory, DailyMemory, CBRCaseStore, IdentityStore } from './dataStores.js';
import { MarkovEngine } from './markovEngine.js';
import { PMIScorer } from './pmiScorer.js';
import { decideTargetShape, fitToShape } from './responseShape.js';
import { TinyIntentML, INTENT_REPLIES } from './tinyMl.js';
import { ResponseOrganizer } from './responseOrganizer.js';
import { ContextMemory } from './contextMemory.js';
import { check as selfCheck } from './selfCheck.js';
import { routeNeed } from './needRouter.js';
import { identityBlurb, applyTargetsToReply } from './learningTarget.js';
import { isDeep, extractTopic as extractDeepTopic, runDeep } from './deepResearch.js';
import { needsColdStart, loadColdStartSeed } from './coldStartSeed.js';
import { logEvent } from './auditLog.js';

const CONFIDENCE_REPLIES = {
  insufficient_info: "I don't have enough info on that yet.",
  dont_know: "I don't know that one.",
};

export class Brain1 {
  constructor(persona = null) {
    this.shortTerm = new ShortTermMemory();
    this.dailyMemory = new DailyMemory();
    this.cbrStore = new CBRCaseStore();
    this.identity = new IdentityStore();
    this.markov = new MarkovEngine();
    this.pmi = new PMIScorer();
    this.gate = new QualityGate();
    this.conversationState = {
      last_entity: null, last_topic: null, last_command: null,
      activity: 'idle', last_confusion_signals: [], mode: 'normal',
    };
    const [toneShaper, realTimeLearner] = persona || [null, null];
    this.toneShaper = toneShaper;
    this.realTimeLearner = realTimeLearner;
    this.tinyMl = new TinyIntentML();
    this.organizer = new ResponseOrganizer();
    this.context = new ContextMemory(100, 6);
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return;
    await this.tinyMl.load();
    await this.organizer.load();
    await confusionLearner.ensureLoaded();

    if (await needsColdStart(this.markov, this.pmi)) {
      await loadColdStartSeed(this.markov, this.pmi);
      logEvent('cold_start', { seeded: true });
    }

    this._initialized = true;
  }

  async respond(userText, isOnlineFn = null, fetchFn = null) {
    await this.init();
    refreshTime();

    if (this.realTimeLearner) this.realTimeLearner.observeFeedback(userText);
    await this.organizer.learnFromFeedback(userText);

    const sec = runSecurityGate(userText);
    if (!sec.passed) return "I can't process that message.";
    const cleanText = sec.cleanText;

    const need = routeNeed(cleanText);
    this.conversationState.last_need = need;

    if (need.need === 'research' && isDeep(cleanText)) {
      const topic = extractDeepTopic(cleanText);
      const reply = await runDeep(topic, fetchFn);
      const finalReply = await this._finalizeReply(reply, cleanText, 'long');
      this._finishTurn(cleanText, finalReply);
      return finalReply;
    }

    if (need.need === 'automation') {
      const reply = need.ask_first
        ? 'That looks like a risky action. Tell me exactly what to do and confirm with YES if you want me to proceed.'
        : 'I understood this as an automation request, but I can only talk about it right now — nothing gets executed automatically.';
      const finalReply = await this._finalizeReply(reply, cleanText);
      this._finishTurn(cleanText, finalReply);
      return finalReply;
    }

    const lower = cleanText.toLowerCase();
    if (['who are you', 'your name', 'what are you'].some(p => lower.includes(p))) {
      const reply = identityBlurb();
      const finalReply = await this._finalizeReply(reply, cleanText);
      this._finishTurn(cleanText, finalReply);
      return finalReply;
    }

    if (/\bwhat.{0,3}s?\s+my\s+name\b/.test(lower) || /\bwhat\s+(do\s+you\s+call\s+me|am\s+i\s+called)\b/.test(lower)) {
      const knownName = (await this.identity.getFact('nickname')) || (await this.identity.getFact('name'));
      const reply = knownName ? `You're ${knownName}!` : "I don't know your name yet — tell me and I'll remember.";
      const finalReply = await this._finalizeReply(reply, cleanText);
      this._finishTurn(cleanText, finalReply);
      return finalReply;
    }

    const confused = await confusionLearner.detectConfusionSmart(cleanText, {
      ...this.conversationState,
      last_bot_reply: this.shortTerm.lastBotReply(),
      last_user_text: this.shortTerm.lastUserText(),
    });
    if (confused) {
      const signals = confusionLearner.detectSignals(cleanText, {
        last_bot_reply: this.shortTerm.lastBotReply(),
        last_user_text: this.shortTerm.lastUserText(),
      });
      this.conversationState.last_confusion_signals = signals;
      const reply = confusionLearner.handleConfusion(this.shortTerm.lastBotReply());
      const finalReply = await this._finalizeReply(reply, cleanText);
      this._finishTurn(cleanText, finalReply);
      return finalReply;
    }

    await confusionLearner.trainFromConfirmation(cleanText, this.conversationState);

    const slots = await buildSlots(cleanText, isOnlineFn, fetchFn);
    resolveReference(cleanText, {
      last_entity: this.conversationState.last_entity,
      last_topic: this.conversationState.last_topic,
      last_command: this.conversationState.last_command,
    });

    for (const [key, value, protectedFact] of extractIdentityFacts(cleanText)) {
      await this.identity.setFact(key, value, protectedFact);
    }

    const knowledge = await knowledgeRouter.route(
      cleanText, this.conversationState, this.shortTerm, this.dailyMemory,
      this.cbrStore, isOnlineFn, fetchFn,
    );

    const [intent, intentConf] = this.tinyMl.predictIntent(cleanText);

    const candidates = await this._buildCandidates(cleanText, knowledge);
    if (intentConf >= 0.55 && intent in INTENT_REPLIES) {
      for (const r of INTENT_REPLIES[intent] || []) {
        if (r && !candidates.includes(r)) candidates.unshift(r);
      }
    }

    const keywords = confidenceEngine.extractKeywords(cleanText);
    let [best, score] = this.gate.pickBest(candidates, keywords, this.pmi, cleanText);
    best = best || "I don't have a good answer for that right now.";

    const conf = confidenceEngine.computeConfidence(knowledge, best, cleanText, score);

    if ((conf.action === 'dont_know' || conf.action === 'insufficient_info') && intentConf >= 0.6) {
      const mlReplies = INTENT_REPLIES[intent] || [];
      if (mlReplies.length > 0) {
        best = mlReplies[0];
        conf.action = 'send';
        conf.source = 'tiny_ml';
      }
    }

    let reply;
    if (conf.action === 'dont_know') reply = CONFIDENCE_REPLIES.dont_know;
    else if (conf.action === 'insufficient_info') reply = CONFIDENCE_REPLIES.insufficient_info;
    else if (conf.action === 'send_tagged') reply = `${best} (source: ${conf.source})`;
    else reply = best;

    const verdict = selfCheck(cleanText, reply);
    if (!verdict.ok) reply = verdict.fixed_reply || reply;

    reply = applyTargetsToReply(reply, need.need || 'info');

    await this.markov.trainOnSentence(cleanText);
    await this.pmi.trainOnSentence(cleanText);

    if (conf.action === 'send' || conf.action === 'send_tagged') {
      const fingerprint = cbrAdaptation.buildFingerprint(cleanText, this.conversationState);
      await this.cbrStore.addCase(fingerprint, reply);
    }

    if (slots.actor_or_target) this.conversationState.last_entity = slots.actor_or_target;
    this.conversationState.last_topic = cbrAdaptation.extractTopic(cleanText);

    const finalReply = await this._finalizeReply(reply, cleanText);
    this._finishTurn(cleanText, finalReply);
    return finalReply;
  }

  async _finalizeReply(reply, cleanText, forceLength = null) {
    const length = forceLength || this.organizer.decideLength(cleanText);
    reply = this.organizer.makeFriendly(reply, cleanText, length);

    let shape = decideTargetShape(cleanText);
    if (forceLength === 'long') shape = { shape: 'long', max_words: 120, structured: true };
    reply = fitToShape(reply, shape);

    if (this.toneShaper) {
      reply = this.toneShaper.shape([reply]) || reply;
      if (this.realTimeLearner) this.realTimeLearner.observeReply(reply);
    }

    this.organizer.noteReply(reply);
    return reply;
  }

  async _buildCandidates(cleanText, knowledge) {
    const candidates = [];
    if (knowledge.source !== 'none' && knowledge.content) {
      const tone = cbrAdaptation.detectEmotionalTone(cleanText);
      const adapted = cbrAdaptation.adaptCase(knowledge.content, cleanText, tone);
      if (cbrAdaptation.confidenceScorer(adapted, cleanText) >= 0.8) candidates.push(adapted);
      candidates.push(knowledge.content);
    }

    const keywords = confidenceEngine.extractKeywords(cleanText);
    const markovReply = this.markov.generate(null, keywords, 0.5);
    if (markovReply) candidates.push(markovReply);

    return candidates.filter(Boolean);
  }

  _finishTurn(userText, botReply) {
    this.shortTerm.addTurn(userText, botReply);
    this.context.add(userText, botReply);
  }
}
