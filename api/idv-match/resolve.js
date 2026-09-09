"use strict";

// Live band-resolution endpoint (Section B server seam). Called when the
// applicant returns/refreshes after the Didit check AND the flag is on. It
// re-pulls the Didit decision, maps it to canonical IN MEMORY, and runs the band
// pipeline on that fresh identity map — it does NOT re-read the Vault (the dev
// synthetic Vault isn't durable across invocations; see BACKLOG IDV-2). The Vault
// still holds the reference for audit. Idempotent: if a decision already exists
// for the attempt it is returned without re-running.
const attemptStore = require("./attemptStore");
const matchDecisionStore = require("./matchDecisionStore");
const { getDecision } = require("../../lib/didit/diditClient");
const { mapDiditDecision } = require("./canonicalMapping");
const { hasScreeningHit } = require("./screening");
const { runBandPipeline } = require("./pipeline");
const { bandsEnabled } = require("./config");

function identityMap(attributes) {
  const map = {};
  for (const a of attributes || []) map[a.attribute_concept] = a.attribute_value;
  return map;
}

function livenessPassed(observations) {
  const liveness = (observations || []).find((o) => o.observation_type === "LIVENESS");
  return !!(liveness && liveness.status === "PASSED");
}

async function resolveAttempt(attemptId, deps = {}) {
  if (!bandsEnabled()) return { enabled: false };
  const store = deps.attemptStore || attemptStore;
  const decisions = deps.matchDecisionStore || matchDecisionStore;
  const pullDecision = deps.getDecision || getDecision;
  const map = deps.mapDiditDecision || mapDiditDecision;
  const screeningHitFor = deps.hasScreeningHit || hasScreeningHit;
  const pipeline = deps.runBandPipeline || runBandPipeline;

  const attempt = await store.getAttempt(attemptId);
  if (!attempt) return { enabled: true, error: "attempt_not_found" };
  if (!attempt.didit_session_id) return { enabled: true, error: "no_session" };

  // Idempotent: a decision already recorded is returned as-is (no duplicate rows).
  const existing = await decisions.listByAttempt(attemptId);
  if (existing && existing.length) {
    const last = existing[existing.length - 1];
    return { enabled: true, alreadyResolved: true, band: last.band, outcomeType: last.outcome_type };
  }

  const decision = await pullDecision(attempt.didit_session_id);
  const mapped = map(decision);
  const identity = identityMap(mapped.identityAttributes);
  const officerSnapshot = attempt.selected_officer || {};
  const screeningHit = await screeningHitFor(attemptId);

  const documentDisplayName = [identity.first_name, identity.last_name].filter(Boolean).join(" ").trim();

  return pipeline({
    attemptId,
    applicationId: attempt.application_id,
    officerSnapshot,
    identity,
    screeningHit,
    escalationFlag: false, // no prior-escalation source wired yet (Section B follow-up)
    livenessPassed: livenessPassed(mapped.observations),
    companyDisplayName: officerSnapshot.name || "",
    documentDisplayName,
  }, deps);
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const attemptId = (req.body && req.body.attemptId) || (req.query && req.query.attemptId);
  if (!attemptId) return res.status(400).json({ error: "attemptId_required" });
  try {
    const result = await resolveAttempt(attemptId);
    return res.status(200).json(result);
  } catch (err) {
    console.error("[idv-match resolve]", err && err.message);
    return res.status(500).json({ error: "resolve_error" });
  }
}

module.exports = handler;
module.exports.resolveAttempt = resolveAttempt;
