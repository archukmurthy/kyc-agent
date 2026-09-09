"use strict";

// Server-side reconciliation (the polling fallback for when a webhook never
// arrives). Pulls the current decision by session id and stores it. This is
// server-initiated only — it is never reachable from the browser, so the
// applicant can never cause a state change.
const { getDecision } = require("../../lib/didit/diditClient");
const { persistDecision } = require("./persistDecision");
const attemptStore = require("./attemptStore");

const TERMINAL = new Set(["Approved", "Declined", "Abandoned", "Expired", "Kyc Expired"]);

async function reconcileAttempt(attemptId, deps = {}) {
  const store = deps.attemptStore || attemptStore;
  const pullDecision = deps.getDecision || getDecision;
  const persist = deps.persistDecision || persistDecision;
  const now = deps.now || (() => new Date().toISOString());

  const attempt = await store.getAttempt(attemptId);
  if (!attempt) return { reconciled: false, reason: "attempt_not_found" };
  if (!attempt.didit_session_id) return { reconciled: false, reason: "no_session" };

  // Terminal state is tracked on the attempt's lifecycle status column, not the
  // non-PII result blob.
  if (TERMINAL.has(attempt.status)) {
    return { reconciled: false, reason: "already_terminal" };
  }

  const decision = await pullDecision(attempt.didit_session_id);
  const { providerStatus } = await persist({ attempt, decision, receivedAt: new Date(), lastEventAt: now() }, deps);
  return { reconciled: true, status: providerStatus };
}

module.exports = { reconcileAttempt };
