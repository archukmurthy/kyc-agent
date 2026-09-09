"use strict";

// Data access for idv_document_media (Neon HTTP driver convention). Stores only
// ciphertext pointers + crypto material + our integrity hash — never plaintext
// bytes. Throws on failure so callers decide.
const { neon } = require("@neondatabase/serverless");
const { randomUUID } = require("node:crypto");

function client() {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  return neon(conn);
}

async function insertMedia(row) {
  const sql = client();
  const id = row.id || randomUUID();
  await sql`
    INSERT INTO idv_document_media
      (id, attempt_id, evidence_kind, blob_key, content_type, byte_size, sha256,
       nonce, auth_tag, wrapped_dek, envelope_version, provider_reference,
       provider_captured_at, received_at)
    VALUES
      (${id}, ${row.attemptId}, ${row.evidenceKind}, ${row.blobKey}, ${row.contentType || null},
       ${row.byteSize || null}, ${row.sha256}, ${row.nonce}, ${row.authTag},
       ${JSON.stringify(row.wrappedDek)}::jsonb, ${row.envelopeVersion || 1}, ${row.providerReference || null},
       ${row.providerCapturedAt || null}, ${row.receivedAt || null})
  `;
  return id;
}

async function getMedia(id) {
  if (!id) return null;
  const sql = client();
  const rows = await sql`SELECT * FROM idv_document_media WHERE id = ${id}`;
  return rows[0] || null;
}

async function listMediaByAttempt(attemptId) {
  if (!attemptId) return [];
  const sql = client();
  return sql`SELECT id, attempt_id, evidence_kind, content_type, sha256, provider_reference,
                    provider_captured_at, received_at, created_at
             FROM idv_document_media WHERE attempt_id = ${attemptId} ORDER BY created_at DESC`;
}

module.exports = { insertMedia, getMedia, listMediaByAttempt };
