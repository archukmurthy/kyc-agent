"use strict";

// Data access for idv_review_tasks (record-only). Neon HTTP driver convention.
const { neon } = require("@neondatabase/serverless");
const { randomUUID } = require("node:crypto");

function client() {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  return neon(conn);
}

async function createTask({ attemptId, applicationId = null, taskType, outcomeType = null, reason = null }) {
  if (!attemptId) throw new Error("createTask: attemptId is required");
  if (!taskType) throw new Error("createTask: taskType is required");
  const sql = client();
  const id = randomUUID();
  await sql`
    INSERT INTO idv_review_tasks (id, attempt_id, application_id, task_type, outcome_type, reason)
    VALUES (${id}, ${attemptId}, ${applicationId}, ${taskType}, ${outcomeType}, ${reason})
  `;
  return { id, taskType };
}

async function listByAttempt(attemptId) {
  if (!attemptId) return [];
  const sql = client();
  return sql`SELECT * FROM idv_review_tasks WHERE attempt_id = ${attemptId} ORDER BY created_at ASC`;
}

module.exports = { createTask, listByAttempt };
