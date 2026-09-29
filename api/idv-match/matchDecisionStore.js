"use strict";

// Data access for idv_match_decisions (append-only in spirit — a changed outcome
// is a new row that `supersedes` the old one, never an overwrite). Neon HTTP
// driver convention.
const { neon } = require("@neondatabase/serverless");
const { randomUUID } = require("node:crypto");

function client() {
  const conn = process.env.IDV_DATABASE_URL || process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  return neon(conn);
}

async function recordDecision({
  attemptId, band, outcomeType, resolvedBy, matchScore = null, basis = null,
  policyVersion, steps = {}, supersedes = null,
}) {
  if (!attemptId) throw new Error("recordDecision: attemptId is required");
  if (!band || !outcomeType || !resolvedBy || !policyVersion) throw new Error("recordDecision: band, outcomeType, resolvedBy, policyVersion are required");
  const sql = client();
  const id = randomUUID();
  await sql`
    INSERT INTO idv_match_decisions
      (id, attempt_id, band, match_score, steps, outcome_type, basis, policy_version, resolved_by, supersedes)
    VALUES
      (${id}, ${attemptId}, ${band}, ${matchScore}, ${JSON.stringify(steps)}::jsonb, ${outcomeType},
       ${basis}, ${policyVersion}, ${resolvedBy}, ${supersedes})
  `;
  return id;
}

async function listByAttempt(attemptId) {
  if (!attemptId) return [];
  const sql = client();
  return sql`SELECT * FROM idv_match_decisions WHERE attempt_id = ${attemptId} ORDER BY created_at ASC`;
}

module.exports = { recordDecision, listByAttempt };
