"use strict";

// Data access for screening checks (table: idv_screening_checks). Follows the
// repo's Neon HTTP-driver convention; throws on failure so callers decide.
const { neon } = require("@neondatabase/serverless");
const { randomUUID } = require("node:crypto");

function client() {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  return neon(conn);
}

// Create a pending screening row bound to an attempt. Returns the new id.
async function createScreening({ attemptId, provider, complyCubeClientId, complyCubeCheckId } = {}) {
  if (!attemptId) throw new Error("createScreening: attemptId is required");
  const sql = client();
  const id = randomUUID();
  await sql`
    INSERT INTO idv_screening_checks (id, attempt_id, provider, complycube_client_id, complycube_check_id, status)
    VALUES (${id}, ${attemptId}, ${provider || "complycube"}, ${complyCubeClientId || null}, ${complyCubeCheckId || null}, 'pending')
  `;
  return id;
}

async function getByCheckId(checkId) {
  if (!checkId) return null;
  const sql = client();
  const rows = await sql`
    SELECT * FROM idv_screening_checks
    WHERE complycube_check_id = ${checkId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function listByAttempt(attemptId) {
  if (!attemptId) return [];
  const sql = client();
  return sql`SELECT * FROM idv_screening_checks WHERE attempt_id = ${attemptId} ORDER BY created_at DESC`;
}

// Data minimization: we persist outcome + categories only. The full ComplyCube
// payload (match PII + scores) is never stored — the raw `result` column was
// dropped in migration 017.
async function updateScreeningResult(id, { status = null, outcome = null, categories = null } = {}) {
  if (!id) throw new Error("updateScreeningResult: id is required");
  const sql = client();
  const categoriesJson = categories == null ? null : JSON.stringify(categories);
  await sql`
    UPDATE idv_screening_checks
    SET status     = COALESCE(${status}, status),
        outcome    = COALESCE(${outcome}, outcome),
        categories = COALESCE(${categoriesJson}::jsonb, categories),
        updated_at = now()
    WHERE id = ${id}
  `;
}

module.exports = { createScreening, getByCheckId, listByAttempt, updateScreeningResult };
