"use strict";

// Durable, encrypted PII Vault (Phase E2, Path 2). Backs identityVault.js when an
// IDV database is configured. Each sensitive attribute value is envelope-encrypted
// (AES-256-GCM, per-item DEK wrapped by the managed key provider) and stored under
// an opaque secure_identity_reference. Attributes are append-only/versioned; every
// authorized read is audited. Uses the module's LocalTestManagedKeyProvider (dev
// key); production swaps in a real KMS-backed provider (IDV-2) with no caller change.
const { neon } = require("@neondatabase/serverless");
const { randomUUID, randomBytes, createCipheriv, createDecipheriv } = require("node:crypto");
const { LocalTestManagedKeyProvider, assertNoRawEvidence } = require("../../idv");
const { retentionMetadata: retentionStamp, DATA_CLASSES } = require("./retentionPolicy");

function client() {
  const conn = process.env.IDV_DATABASE_URL || process.env.DATABASE_URL;
  if (!conn) throw new Error("IDV_DATABASE_URL / DATABASE_URL not set");
  return neon(conn);
}

let cachedKeys = null;
function keyProvider() {
  if (cachedKeys) return cachedKeys;
  const b64 = process.env.IDV_VAULT_WRAP_KEY;
  const wrappingKey = b64 ? Buffer.from(b64, "base64") : randomBytes(32);
  if (wrappingKey.length !== 32) throw new Error("IDV_VAULT_WRAP_KEY must decode to 32 bytes");
  cachedKeys = new LocalTestManagedKeyProvider({ wrappingKey, keyId: "idv-vault-local", runtimeMode: "test" });
  return cachedKeys;
}

// The DEK is wrapped once per record (bound to the reference); each attribute is
// encrypted with that shared DEK under its own nonce + AAD binding it to
// (reference, concept) so a value can't be relabelled or moved. This means ONE
// key-wrap call per store (not one per attribute) - important with a real KMS.
function recordAad(reference) { return Buffer.from(JSON.stringify({ reference }), "utf8"); }
function attrAad(reference, concept) { return Buffer.from(JSON.stringify({ reference, concept }), "utf8"); }

// Encrypt one value with an already-wrapped DEK.
function encryptWithDek(value, dek, reference, concept) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dek, nonce);
  cipher.setAAD(attrAad(reference, concept));
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), "utf8")), cipher.final()]);
  return { ciphertext: ct.toString("base64"), nonce: nonce.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

async function decryptValue(row) {
  const dek = await keyProvider().unwrapKey(row.wrapped_dek, { aad: recordAad(row.secure_identity_reference) });
  try {
    const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(row.nonce, "base64"));
    decipher.setAAD(attrAad(row.secure_identity_reference, row.attribute_concept));
    decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
    const pt = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64")), decipher.final()]);
    return JSON.parse(pt.toString("utf8"));
  } finally { dek.fill(0); }
}

// Persist canonical identity attributes. Idempotent per session (re-storing the
// same session returns the same opaque reference without duplicating rows).
async function storeExtractedIdentity({ sessionId, tenantId = null, subjectId = null, attributes = [], retentionMetadata = null }) {
  if (!sessionId) throw new TypeError("storeExtractedIdentity requires sessionId");
  const sql = client();
  const existing = await sql`SELECT secure_identity_reference FROM idv_vault_records WHERE session_id = ${sessionId}`;
  if (existing.length) return existing[0].secure_identity_reference; // idempotent

  // Stamp the VAULT_PII retention clock (period unset until compliance sets it).
  const retention = retentionMetadata || retentionStamp(DATA_CLASSES.VAULT_PII, new Date().toISOString());
  const reference = randomUUID();
  await sql`
    INSERT INTO idv_vault_records (secure_identity_reference, session_id, tenant_id, subject_id, retention_metadata)
    VALUES (${reference}, ${sessionId}, ${tenantId}, ${subjectId}, ${JSON.stringify(retention)}::jsonb)
  `;
  // One DEK for the whole record, wrapped once.
  const dek = randomBytes(32);
  const wrappedDek = await keyProvider().wrapKey(dek, { aad: recordAad(reference) });
  try {
    for (const attr of attributes) {
      assertNoRawEvidence({ [attr.attribute_concept]: attr.attribute_value });
      const enc = encryptWithDek(attr.attribute_value, dek, reference, attr.attribute_concept);
      await sql`
        INSERT INTO idv_vault_attributes
          (secure_identity_reference, attribute_id, attribute_concept, ciphertext, nonce, auth_tag, wrapped_dek, envelope_version, version, source)
        VALUES (${reference}, ${attr.attribute_id || randomUUID()}, ${attr.attribute_concept}, ${enc.ciphertext}, ${enc.nonce}, ${enc.authTag}, ${JSON.stringify(wrappedDek)}::jsonb, 1, 1, 'IDV_PROVIDER_EXTRACTION')
      `;
    }
  } finally { dek.fill(0); }
  return reference;
}

// Read attributes under a field allowlist; decrypt only the allowlisted concepts;
// audit every access.
async function retrieveForAuthorizedPurpose({ reference, fields = [], authorization = {} }) {
  if (!reference) throw new TypeError("retrieveForAuthorizedPurpose requires reference");
  const sql = client();
  const allowed = new Set(fields);
  const rows = await sql`SELECT * FROM idv_vault_attributes WHERE secure_identity_reference = ${reference} AND superseded = false`;
  const values = {};
  for (const row of rows) {
    if (!allowed.has(row.attribute_concept)) continue;
    values[row.attribute_concept] = await decryptValue(row);
  }
  await sql`
    INSERT INTO idv_vault_access_audit (secure_identity_reference, actor_id, purpose, fields, outcome)
    VALUES (${reference}, ${authorization.actorId || "system"}, ${authorization.purpose || null}, ${JSON.stringify(fields)}::jsonb, ${rows.length ? "released" : "not_found"})
  `;
  return values;
}

// List which concepts are held for a reference WITHOUT decrypting anything
// (so a case view can mask without a full decrypt of every field).
async function listConcepts(reference) {
  if (!reference) return [];
  const sql = client();
  const rows = await sql`SELECT DISTINCT attribute_concept FROM idv_vault_attributes WHERE secure_identity_reference = ${reference} AND superseded = false ORDER BY attribute_concept`;
  return rows.map((r) => r.attribute_concept);
}

// Append a corrected value as a new version; the original is preserved (superseded).
async function recordCorrection({ reference, concept, submittedValue, attributeId = null }) {
  if (!reference || !concept) throw new TypeError("recordCorrection requires reference + concept");
  const sql = client();
  await sql`UPDATE idv_vault_attributes SET superseded = true WHERE secure_identity_reference = ${reference} AND attribute_concept = ${concept} AND superseded = false`;
  const next = await sql`SELECT COALESCE(MAX(version), 0) + 1 AS v FROM idv_vault_attributes WHERE secure_identity_reference = ${reference} AND attribute_concept = ${concept}`;
  const dek = randomBytes(32);
  const wrappedDek = await keyProvider().wrapKey(dek, { aad: recordAad(reference) });
  try {
    const enc = encryptWithDek(submittedValue, dek, reference, concept);
    await sql`
      INSERT INTO idv_vault_attributes
        (secure_identity_reference, attribute_id, attribute_concept, ciphertext, nonce, auth_tag, wrapped_dek, envelope_version, version, source)
      VALUES (${reference}, ${attributeId || randomUUID()}, ${concept}, ${enc.ciphertext}, ${enc.nonce}, ${enc.authTag}, ${JSON.stringify(wrappedDek)}::jsonb, 1, ${next[0].v}, 'APPLICANT_CORRECTION')
    `;
  } finally { dek.fill(0); }
  return { corrected: true, version: next[0].v };
}

module.exports = { storeExtractedIdentity, retrieveForAuthorizedPurpose, recordCorrection, listConcepts };
