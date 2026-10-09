"use strict";

// IDV lifecycle events (Phase 2.5 sub-step 6). Append-only domain history with
// DISTINCT timestamps: occurredAt (provider/event time, may be missing and
// stays missing), receivedAt (when we received it), recordedAt (when the row is
// written - the DB default). Non-PII only.
//
// appendLifecycleEvent is strict (throws). safeAppendLifecycleEvent is
// best-effort: a lifecycle write must NEVER break the verification flow, so it
// swallows and logs. Callers in the live path use the safe variant.
const { neon } = require("@neondatabase/serverless");
const { LIFECYCLE_EVENTS } = require("../../idv");

function client() {
  const conn = process.env.IDV_DATABASE_URL || process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  return neon(conn);
}

async function appendLifecycleEvent({ attemptId, type, occurredAt = null, receivedAt = null, providerReference = null, detail = null }, deps = {}) {
  if (!attemptId) throw new Error("appendLifecycleEvent: attemptId is required");
  if (!type) throw new Error("appendLifecycleEvent: type is required");
  const sql = deps.sql || client();
  // occurredAt stays NULL when the provider gave no time - never fabricated.
  await sql`
    INSERT INTO idv_lifecycle_events (attempt_id, event_type, occurred_at, received_at, provider_reference, detail)
    VALUES (${attemptId}, ${type}, ${occurredAt}, ${receivedAt}, ${providerReference},
            ${detail == null ? null : JSON.stringify(detail)}::jsonb)
  `;
}

async function safeAppendLifecycleEvent(event, deps = {}) {
  try {
    await appendLifecycleEvent(event, deps);
  } catch (err) {
    // Domain history is not a competing system of record - never fail the flow.
    console.warn("[idv-match lifecycle] append skipped:", err && err.message);
  }
}

// Reconstruct history in causal order even when events arrive out of order:
// order by the event time we know (occurredAt, else receivedAt, else recordedAt).
async function listLifecycle(attemptId, deps = {}) {
  if (!attemptId) return [];
  const sql = deps.sql || client();
  return sql`
    SELECT attempt_id, event_type, occurred_at, received_at, recorded_at, provider_reference
    FROM idv_lifecycle_events
    WHERE attempt_id = ${attemptId}
    ORDER BY COALESCE(occurred_at, received_at, recorded_at) ASC, id ASC
  `;
}

module.exports = { appendLifecycleEvent, safeAppendLifecycleEvent, listLifecycle, LIFECYCLE_EVENTS };
