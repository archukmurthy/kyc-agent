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

module.exports = { createAttempt, getAttempt };
