"use strict";

// Data access for the Evidence outbox (table: idv_evidence_outbox). Append-only:
// publish is idempotent on idempotency_key (ON CONFLICT DO NOTHING). Neon HTTP
// driver convention; throws on failure.
const { neon } = require("@neondatabase/serverless");
const { randomUUID } = require("node:crypto");

function client() {
  const conn = process.env.IDV_DATABASE_URL || process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  return neon(conn);
}

// Append an envelope. Returns { id, inserted } - inserted:false when the
// idempotency key already exists (duplicate publish, no-op).
async function appendOutbox({ attemptId, idempotencyKey, envelope }) {
  if (!attemptId) throw new Error("appendOutbox: attemptId is required");
  if (!idempotencyKey) throw new Error("appendOutbox: idempotencyKey is required");
  const sql = client();
  const id = randomUUID();
  const rows = await sql`
    INSERT INTO idv_evidence_outbox (id, attempt_id, idempotency_key, envelope)
    VALUES (${id}, ${attemptId}, ${idempotencyKey}, ${JSON.stringify(envelope)}::jsonb)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0 ? { id: rows[0].id, inserted: true } : { id: null, inserted: false };
}

async function listByAttempt(attemptId) {
  if (!attemptId) return [];
  const sql = client();
  return sql`SELECT id, attempt_id, idempotency_key, status, created_at
             FROM idv_evidence_outbox WHERE attempt_id = ${attemptId} ORDER BY created_at DESC`;
}

module.exports = { appendOutbox, listByAttempt };
