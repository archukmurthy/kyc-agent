"use strict";

// Server-authoritative start of a verification attempt. Freezes the selected
// officer, creates the attempt row, then creates a Didit session bound to that
// attempt via vendor_data = attempt id. The browser never creates or modifies
// this binding — it only receives the attempt id + hosted URL to open.
const { createSession } = require("../../lib/didit/diditClient");
const { buildOfficerSnapshot } = require("./officerSnapshot");
const attemptStore = require("./attemptStore");
const { safeAppendLifecycleEvent, LIFECYCLE_EVENTS } = require("./lifecycle");

async function startVerificationAttempt({ applicationId, officerCandidate, callbackUrl } = {}) {
  if (!applicationId) throw new Error("startVerificationAttempt: applicationId is required");
  if (!officerCandidate) throw new Error("startVerificationAttempt: officerCandidate is required");

  const snapshot = buildOfficerSnapshot(officerCandidate);
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

module.exports = { startVerificationAttempt };
