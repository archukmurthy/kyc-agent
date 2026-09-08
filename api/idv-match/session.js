"use strict";

// Server-authoritative start of a verification attempt. Freezes the selected
// officer, creates the attempt row, then creates a Didit session bound to that
// attempt via vendor_data = attempt id. The browser never creates or modifies
// this binding — it only receives the attempt id + hosted URL to open.
const { createSession } = require("../../lib/didit/diditClient");
const { buildOfficerSnapshot } = require("./officerSnapshot");
const attemptStore = require("./attemptStore");

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

  return { attemptId, hostedVerificationUrl: session.hostedUrl };
}

module.exports = { startVerificationAttempt };
