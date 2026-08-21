"use strict";

const { CANONICAL_STATUSES, TERMINAL_STATUSES } = require("./constants");
const { iso } = require("./canonical");

const ALLOWED = Object.freeze({
  CREATED: new Set(["READY", "STARTED", "PROCESSING", "REQUIRES_RETRY", "VERIFIED", "FAILED", "ABANDONED", "EXPIRED", "ERROR"]),
  READY: new Set(["STARTED", "PROCESSING", "REQUIRES_RETRY", "VERIFIED", "FAILED", "ABANDONED", "EXPIRED", "ERROR"]),
  STARTED: new Set(["PROCESSING", "REQUIRES_RETRY", "VERIFIED", "FAILED", "ABANDONED", "EXPIRED", "ERROR"]),
  PROCESSING: new Set(["REQUIRES_RETRY", "VERIFIED", "FAILED", "ABANDONED", "EXPIRED", "ERROR"]),
  REQUIRES_RETRY: new Set(["STARTED", "PROCESSING", "VERIFIED", "FAILED", "ABANDONED", "EXPIRED", "ERROR"]),
  ERROR: new Set(["READY", "STARTED", "PROCESSING", "REQUIRES_RETRY", "VERIFIED", "FAILED", "ABANDONED", "EXPIRED"]),
  VERIFIED: new Set(), FAILED: new Set(), ABANDONED: new Set(), EXPIRED: new Set(),
});

function reconcileSessionStatus(session, incomingStatus, observedAt) {
  if (!Object.values(CANONICAL_STATUSES).includes(incomingStatus)) {
    throw new TypeError(`Unknown canonical IDV status: ${incomingStatus}`);
  }
  const incomingAt = iso(observedAt, new Date());
  const currentAt = session.last_provider_event_at;
  if (currentAt && incomingAt && new Date(incomingAt) < new Date(currentAt)) {
    return { session, applied: false, reason: "OUT_OF_ORDER_EVENT" };
  }
  if (incomingStatus === session.canonical_status) {
    return {
      session: { ...session, last_provider_event_at: incomingAt || currentAt },
      applied: false,
      reason: "STATUS_UNCHANGED",
    };
  }
  if (TERMINAL_STATUSES.has(session.canonical_status)) {
    return { session, applied: false, reason: "TERMINAL_STATUS_PRESERVED" };
  }
  if (!ALLOWED[session.canonical_status]?.has(incomingStatus)) {
    return { session, applied: false, reason: "TRANSITION_NOT_ALLOWED" };
  }
  return {
    session: {
      ...session,
      canonical_status: incomingStatus,
      last_provider_event_at: incomingAt,
      completed_at: TERMINAL_STATUSES.has(incomingStatus) ? incomingAt : session.completed_at,
    },
    applied: true,
    reason: "STATUS_APPLIED",
  };
}

module.exports = { reconcileSessionStatus };
