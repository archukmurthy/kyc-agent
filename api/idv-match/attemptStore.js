"use strict";

// Data-access for identity-verification attempts (table: idv_verification_attempts).
// Follows the repo's Neon HTTP-driver convention (see lib/persist.js): one sql
// client per call, parameterized tagged-template queries, throws on failure so
// the caller decides how to handle it.
const { neon } = require("@neondatabase/serverless");
const { randomUUID } = require("node:crypto");

function client() {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  return neon(conn);
}

// Create a verification attempt, freezing the selected officer snapshot at the
// moment of selection. The snapshot is stored as-is and never re-fetched.
// Returns the new attempt id.
async function createAttempt({ applicationId, selectedOfficer, diditSessionId = null }) {
  if (!applicationId) throw new Error("createAttempt: applicationId is required");
  if (!selectedOfficer) throw new Error("createAttempt: selectedOfficer snapshot is required");

  const sql = client();
  const id = randomUUID();
  await sql`
    INSERT INTO idv_verification_attempts (id, application_id, selected_officer, didit_session_id, status)
    VALUES (${id}, ${applicationId}, ${JSON.stringify(selectedOfficer)}::jsonb, ${diditSessionId}, 'created')
  `;
  return id;
}

// Fetch a single attempt by id, or null if not found.
async function getAttempt(id) {
  if (!id) return null;
  const sql = client();
  const rows = await sql`SELECT * FROM idv_verification_attempts WHERE id = ${id}`;
  return rows[0] || null;
}

// Look up an attempt by its Didit session id (used by the webhook handler to
// route a provider event back to exactly the attempt that created the session).
async function getByDiditSession(diditSessionId) {
  if (!diditSessionId) return null;
  const sql = client();
  const rows = await sql`
    SELECT * FROM idv_verification_attempts
    WHERE didit_session_id = ${diditSessionId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

// Update the mutable lifecycle fields of an attempt. Only the fields provided
// (non-null) are changed; the rest are preserved via COALESCE. This is pure data
// access — ordering/terminal-status rules live in the webhook handler.
async function updateAttempt(id, { status = null, diditSessionId = null, verificationResult = null, lastEventAt = null } = {}) {
  if (!id) throw new Error("updateAttempt: id is required");
  const sql = client();
  const resultJson = verificationResult == null ? null : JSON.stringify(verificationResult);
  await sql`
    UPDATE idv_verification_attempts
    SET status              = COALESCE(${status}, status),
        didit_session_id    = COALESCE(${diditSessionId}, didit_session_id),
        verification_result = COALESCE(${resultJson}::jsonb, verification_result),
        last_event_at       = COALESCE(${lastEventAt}, last_event_at),
        updated_at          = now()
    WHERE id = ${id}
  `;
}

module.exports = { createAttempt, getAttempt, getByDiditSession, updateAttempt };
