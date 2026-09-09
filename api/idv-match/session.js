"use strict";

// Server-authoritative start of a verification attempt. Freezes the selected
// officer, creates the attempt row, then creates a Didit session bound to that
// attempt via vendor_data = attempt id. The browser never creates or modifies
// this binding — it only receives the attempt id + hosted URL to open.
const { createSession } = require("../../lib/didit/diditClient");
const { buildOfficerSnapshot } = require("./officerSnapshot");
const attemptStore = require("./attemptStore");
const { safeAppendLifecycleEvent, LIFECYCLE_EVENTS } = require("./lifecycle");
const { bandsEnabled } = require("./config");

async function startVerificationAttempt({ applicationId, officerCandidate, callbackUrl, verifyOnly = false } = {}) {
  if (!applicationId) throw new Error("startVerificationAttempt: applicationId is required");
  if (!verifyOnly && !officerCandidate) throw new Error("startVerificationAttempt: officerCandidate is required");

  // Verify-only (unlisted applicant): identity proof with no officer to compare
  // against, so no frozen officer snapshot — just a mode marker.
  const snapshot = verifyOnly ? { mode: "verify_only" } : buildOfficerSnapshot(officerCandidate);
  const attemptId = await attemptStore.createAttempt({ applicationId, selectedOfficer: snapshot });

  const session = await createSession({
    vendorData: attemptId, // server-generated binding — not browser-supplied
    callbackUrl: callbackUrl || process.env.DIDIT_CALLBACK_URL,
  });

  await attemptStore.updateAttempt(attemptId, {
    status: "session_created",
    diditSessionId: session.providerSessionId,
  });

  // Domain history — best-effort, never blocks the flow. No provider time yet,
  // so occurredAt stays absent (receivedAt is the receipt of our own action).
  await safeAppendLifecycleEvent({
    attemptId, type: LIFECYCLE_EVENTS.IDV_SESSION_CREATED,
    receivedAt: new Date().toISOString(), providerReference: session.providerSessionId,
  });

  return { attemptId, hostedVerificationUrl: session.hostedUrl };
}

// Browser-callable start: creates the server-authoritative attempt bound to the
// selected officer and returns the attempt id + hosted Didit URL. Only when the
// flag is on; the browser can never forge the binding (officer snapshot is frozen
// server-side from the candidate it passes).
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (!bandsEnabled()) return res.status(404).json({ error: "not_enabled" });
  const body = req.body || {};
  if (!body.applicationId || (!body.officerCandidate && !body.verifyOnly)) {
    return res.status(400).json({ error: "applicationId_and_officerCandidate_required" });
  }
  try {
    const out = await startVerificationAttempt({ applicationId: body.applicationId, officerCandidate: body.officerCandidate, verifyOnly: !!body.verifyOnly });
    return res.status(200).json(out);
  } catch (err) {
    console.error("[idv-match session]", err && err.message);
    return res.status(500).json({ error: "session_error" });
  }
}

module.exports = handler;
module.exports.startVerificationAttempt = startVerificationAttempt;
module.exports.handler = handler;
