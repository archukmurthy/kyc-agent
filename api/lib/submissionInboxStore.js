"use strict";

// Data access for submission_inbox (migration 024). Single-statement writes over
// the Neon HTTP driver. The durable capture point: a submission lands here before
// any structured write, and a worker finalizes it later. Idempotent on id
// (= submissionId).
const { neon } = require("@neondatabase/serverless");

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
async function claimPending({ limit = 10, maxAttempts = 25 } = {}, deps = {}) {
  const sql = deps.sql || defaultSql();
  const rows = await sql`
    UPDATE submission_inbox SET status = 'processing', updated_at = now()
    WHERE id IN (
      SELECT id FROM submission_inbox
      WHERE status IN ('pending', 'failed') AND attempts < ${maxAttempts}
      ORDER BY created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, tenant_id, payload, attempts
  `;
  return rows;
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

async function markFailed(id, errorMessage, deps = {}) {
  const sql = deps.sql || defaultSql();
  await sql`
    UPDATE submission_inbox
    SET status = 'failed', attempts = attempts + 1,
        last_error = ${String(errorMessage || "").slice(0, 2000)}, updated_at = now()
    WHERE id = ${id}
  `;
}

module.exports = { enqueue, claimPending, markDone, markFailed };
