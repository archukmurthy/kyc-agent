"use strict";

// Data access for submission_inbox (migration 024). Single-statement writes over
// the Neon HTTP driver. The durable capture point: a submission lands here before
// any structured write, and a worker finalizes it later. Idempotent on id
// (= submissionId).
const { neon } = require("@neondatabase/serverless");

// Ceiling on retry attempts before a row is considered dead-lettered (see markFailed).
const MAX_ATTEMPTS = 25;
// How long a row may sit in 'processing' before claimPending treats it as abandoned
// (worker/process crashed mid-finalize) and reclaims it for retry.
const STALE_PROCESSING_SECONDS = 300;

function defaultSql() {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  return neon(conn);
}

async function enqueue({ submissionId, tenantId, payload }, deps = {}) {
  if (!submissionId) throw new Error("enqueue: submissionId is required");
  if (!tenantId) throw new Error("enqueue: tenantId is required");
  const sql = deps.sql || defaultSql();
  const rows = await sql`
    INSERT INTO submission_inbox (id, tenant_id, status, payload)
    VALUES (${submissionId}, ${tenantId}, 'pending', ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  return { id: submissionId, inserted: rows.length > 0 };
}

// Atomically claim a batch: flip eligible rows to 'processing' and return them.
// A single UPDATE ... RETURNING is its own implicit transaction, so two concurrent
// workers cannot claim the same row.
async function claimPending(
  { limit = 10, maxAttempts = MAX_ATTEMPTS, staleSeconds = STALE_PROCESSING_SECONDS } = {},
  deps = {}
) {
  const sql = deps.sql || defaultSql();
  const rows = await sql`
    UPDATE submission_inbox SET status = 'processing', updated_at = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM submission_inbox
      WHERE ((status IN ('pending','failed') AND attempts < ${maxAttempts})
        OR (status = 'processing' AND attempts < ${maxAttempts} AND updated_at < now() - (${staleSeconds} || ' seconds')::interval))
      ORDER BY created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, tenant_id, payload, attempts
  `;
  return rows;
}

// Claim a single row inline (used by api/submit.js right before its own inline
// finalize attempt) so a concurrent worker tick can't also finalize it — closes the
// double-finalize window without a transaction. If this row's process crashes before
// markDone/markFailed, claimPending's stale-processing reclaim picks it back up.
async function markProcessing(id, deps = {}) {
  const sql = deps.sql || defaultSql();
  await sql`
    UPDATE submission_inbox SET status = 'processing', updated_at = now(), attempts = attempts + 1 WHERE id = ${id}
  `;
}

async function markDone(id, sessionId, deps = {}) {
  const sql = deps.sql || defaultSql();
  await sql`
    UPDATE submission_inbox
    SET status = 'done', session_id = ${sessionId || null},
        processed_at = now(), updated_at = now(), last_error = NULL
    WHERE id = ${id}
  `;
}

// `incrementAttempt` counts this attempt when the caller's earlier claim/markProcessing
// step didn't already count it (see api/submit.js's markProcessing-throw fallback path).
// The worker (finalize-submissions.js) never passes it — claimPending already counted.
async function markFailed(id, errorMessage, { incrementAttempt = false, sql: sqlDep } = {}) {
  const sql = sqlDep || defaultSql();
  const rows = incrementAttempt
    ? await sql`
        UPDATE submission_inbox
        SET status = 'failed',
            last_error = ${String(errorMessage || "").slice(0, 2000)}, updated_at = now(),
            attempts = attempts + 1
        WHERE id = ${id}
        RETURNING attempts
      `
    : await sql`
        UPDATE submission_inbox
        SET status = 'failed',
            last_error = ${String(errorMessage || "").slice(0, 2000)}, updated_at = now()
        WHERE id = ${id}
        RETURNING attempts
      `;
  const currentAttempts = rows[0] && rows[0].attempts;
  if (currentAttempts >= MAX_ATTEMPTS) {
    console.error(
      `[submission_inbox] DEAD-LETTER: submission ${id} failed ${currentAttempts} times — finalize abandoned, manual triage required`
    );
  }
}

// Count rows that have exhausted their retry budget and are no longer claimed by
// claimPending — i.e. silently abandoned unless someone looks. Includes rows stuck in
// 'processing' at the cap (a hard crash on every attempt never reaches markFailed, so
// 'failed' alone would miss them).
async function countDeadLettered(deps = {}) {
  const sql = deps.sql || defaultSql();
  const rows = await sql`
    SELECT count(*)::int AS n FROM submission_inbox
    WHERE attempts >= ${MAX_ATTEMPTS} AND status IN ('failed', 'processing')
  `;
  return rows[0].n;
}

module.exports = {
  enqueue,
  claimPending,
  markProcessing,
  markDone,
  markFailed,
  countDeadLettered,
  MAX_ATTEMPTS,
};
