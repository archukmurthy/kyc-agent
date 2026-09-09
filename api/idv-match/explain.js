"use strict";

// Band B dialogue answer handler (Section B server seam). Takes the applicant's
// one-round explanation, re-derives the names from the fresh Didit decision (in
// memory, same as resolve.js), runs handleExplanation, and records a decision row
// when the answer produces a terminal outcome. Idempotent-friendly: callers
// should only reach here from an open dialogue.
const attemptStore = require("./attemptStore");
const { getDecision } = require("../../lib/didit/diditClient");
const { mapDiditDecision } = require("./canonicalMapping");
const { parseOfficerName, buildDocName, buildMrzName } = require("./matching/normalize");
const { handleExplanation } = require("./resolution");
const { recordBandOutcome } = require("./behaviors");
const { bandsEnabled } = require("./config");
const { extractNameTokens } = require("./nameExtraction");

function identityMap(attributes) {
  const map = {};
  for (const a of attributes || []) map[a.attribute_concept] = a.attribute_value;
  return map;
}

async function explainAttempt({ attemptId, category, evidence } = {}, deps = {}) {
  if (!bandsEnabled()) return { enabled: false };
  if (!attemptId || !category) return { enabled: true, error: "attemptId_and_category_required" };
  const store = deps.attemptStore || attemptStore;
  const pullDecision = deps.getDecision || getDecision;
  const map = deps.mapDiditDecision || mapDiditDecision;

  const attempt = await store.getAttempt(attemptId);
  if (!attempt) return { enabled: true, error: "attempt_not_found" };
  if (!attempt.didit_session_id) return { enabled: true, error: "no_session" };

  const mapped = map(await pullDecision(attempt.didit_session_id));
  const identity = identityMap(mapped.identityAttributes);
  const officer = attempt.selected_officer || {};

  const outcome = await handleExplanation({
    category,
    officerName: parseOfficerName(officer.name),
    docName: buildDocName({ firstName: identity.first_name, lastName: identity.last_name }),
    mrzName: identity.mrz != null ? buildMrzName(identity.mrz) : null,
    evidence,
    extractNames: deps.extractNames || ((e) => extractNameTokens(e, deps)),
  });

  // Terminal outcomes are recorded; non-terminal (needsUpload / reselect_officer)
  // are returned for the UI to act on.
  if (outcome.outcomeType) {
    const recorded = await recordBandOutcome({
      attemptId, applicationId: attempt.application_id,
      decision: { band: "B", ...outcome },
    }, deps);
    return { enabled: true, ...outcome, ...recorded };
  }
  return { enabled: true, ...outcome };
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const body = req.body || {};
  const attemptId = body.attemptId || (req.query && req.query.attemptId);
  if (!attemptId || !body.category) return res.status(400).json({ error: "attemptId_and_category_required" });
  try {
    const result = await explainAttempt({ attemptId, category: body.category, evidence: body.evidence });
    return res.status(200).json(result);
  } catch (err) {
    console.error("[idv-match explain]", err && err.message);
    return res.status(500).json({ error: "explain_error" });
  }
}

module.exports = handler;
module.exports.explainAttempt = explainAttempt;
