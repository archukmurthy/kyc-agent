"use strict";

// Read-only status for an attempt — this is what the applicant "refresh" hits.
// It never calls Didit, never writes, and never returns identity PII: only the
// lifecycle status plus booleans. The identity result stays server-side.
const attemptStore = require("./attemptStore");

async function getAttemptStatus(attemptId, deps = {}) {
  const store = deps.attemptStore || attemptStore;
  if (!attemptId) return null;
  const attempt = await store.getAttempt(attemptId);
  if (!attempt) return null;
  const result = attempt.verification_result || null;
  return {
    attemptId: attempt.id,
    status: attempt.status,
    verified: !!(result && result.providerVerified),
    hasResult: !!result,
  };
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const attemptId = (req.query && req.query.attemptId) || (req.body && req.body.attemptId);
  if (!attemptId) return res.status(400).json({ error: "attemptId_required" });
  try {
    const status = await getAttemptStatus(attemptId);
    if (!status) return res.status(404).json({ error: "attempt_not_found" });
    return res.status(200).json(status);
  } catch (err) {
    console.error("[idv-match status]", err && err.message);
    return res.status(500).json({ error: "status_error" });
  }
}

module.exports = handler;
module.exports.getAttemptStatus = getAttemptStatus;
