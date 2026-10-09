"use strict";

// Append-only immutable identity events (Phase E3). Records provider extraction,
// applicant confirmation, correction, and gap-supplied info as distinct events -
// references + non-PII metadata only, never a plaintext value.
const { neon } = require("@neondatabase/serverless");

function client() {
  const conn = process.env.IDV_DATABASE_URL || process.env.DATABASE_URL;
  if (!conn) throw new Error("IDV_DATABASE_URL / DATABASE_URL not set");
  return neon(conn);
}

const EVENT_TYPES = new Set(["extraction_presented", "applicant_confirmed", "applicant_corrected", "applicant_gap_supplied"]);

async function appendIdentityEvent({ attemptId, secureIdentityReference = null, eventType, attributeConcept = null, vaultVersion = null, actor = null, detail = null }) {
  if (!attemptId) throw new Error("appendIdentityEvent: attemptId is required");
  if (!EVENT_TYPES.has(eventType)) throw new Error(`appendIdentityEvent: invalid eventType ${eventType}`);
  const sql = client();
  await sql`
    INSERT INTO idv_identity_events (attempt_id, secure_identity_reference, event_type, attribute_concept, vault_version, actor, detail)
    VALUES (${attemptId}, ${secureIdentityReference}, ${eventType}, ${attributeConcept}, ${vaultVersion}, ${actor}, ${detail == null ? null : JSON.stringify(detail)}::jsonb)
  `;
}

async function listByAttempt(attemptId) {
  if (!attemptId) return [];
  const sql = client();
  return sql`SELECT attempt_id, secure_identity_reference, event_type, attribute_concept, vault_version, actor, occurred_at
             FROM idv_identity_events WHERE attempt_id = ${attemptId} ORDER BY occurred_at ASC, id ASC`;
}

module.exports = { appendIdentityEvent, listByAttempt, EVENT_TYPES };
