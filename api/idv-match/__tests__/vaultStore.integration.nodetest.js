const { test } = require("node:test");
const assert = require("node:assert");
const { neon } = require("@neondatabase/serverless");

// GUARDED DB integration for the durable encrypted Vault (Phase E2).
// IDV_MATCH_DB_TEST=1 + IDV_DATABASE_URL. Proves PII is stored encrypted, read
// back only under an allowlist, audited, and corrections preserve the original.
const RUN = process.env.IDV_MATCH_DB_TEST === "1" && !!(process.env.IDV_DATABASE_URL || process.env.DATABASE_URL);
const vault = require("../identityVault");
const { createIdentityAttribute } = require("../../../idv");

const PII = { name: "Ada Lovelace", dob: "1815-12-10", docNo: "X1234567" };
const attrs = () => [
  createIdentityAttribute({ concept: "full_name", value: PII.name, provider: "DIDIT", providerSessionId: "s" }),
  createIdentityAttribute({ concept: "date_of_birth", value: PII.dob, provider: "DIDIT", providerSessionId: "s" }),
  createIdentityAttribute({ concept: "document_number", value: PII.docNo, provider: "DIDIT", providerSessionId: "s" }),
];

test("durable Vault: store encrypted, read by allowlist, audit, correction preserves original", { skip: !RUN }, async () => {
  const sql = neon(process.env.IDV_DATABASE_URL || process.env.DATABASE_URL);
  const sessionId = `vault-int-${Date.now()}`;
  let reference;
  try {
    reference = await vault.storeExtractedIdentity({ sessionId, tenantId: "nium", subjectId: sessionId, attributes: attrs() });
    assert.match(reference, /^[0-9a-f-]{36}$/);

    // stored ciphertext only — no plaintext in the row
    const raw = await sql`SELECT ciphertext, attribute_concept FROM idv_vault_attributes WHERE secure_identity_reference = ${reference}`;
    const blob = JSON.stringify(raw);
    for (const secret of [PII.name, PII.dob, PII.docNo]) assert.ok(!blob.includes(secret), `plaintext ${secret} in row`);

    // authorized read under an allowlist decrypts only those concepts
    const got = await vault.retrieveForAuthorizedPurpose({ reference, fields: ["full_name", "date_of_birth"], actorId: "reviewer-1", purpose: "KYC_DECISIONING" });
    assert.deepStrictEqual(got, { full_name: PII.name, date_of_birth: PII.dob });
    assert.ok(!("document_number" in got), "unrequested concept withheld");

    // access was audited
    const audit = await sql`SELECT actor_id, outcome FROM idv_vault_access_audit WHERE secure_identity_reference = ${reference} ORDER BY at DESC LIMIT 1`;
    assert.strictEqual(audit[0].actor_id, "reviewer-1");
    assert.strictEqual(audit[0].outcome, "released");

    // correction adds a new version; original preserved (superseded row remains)
    await vault.recordCorrection({ reference, concept: "full_name", submittedValue: "Ada King" });
    const current = await vault.retrieveForAuthorizedPurpose({ reference, fields: ["full_name"] });
    assert.strictEqual(current.full_name, "Ada King");
    const versions = await sql`SELECT count(*)::int AS c FROM idv_vault_attributes WHERE secure_identity_reference = ${reference} AND attribute_concept = 'full_name'`;
    assert.strictEqual(versions[0].c, 2, "original + correction both retained");
  } finally {
    if (reference) {
      await sql`DELETE FROM idv_vault_access_audit WHERE secure_identity_reference = ${reference}`;
      await sql`DELETE FROM idv_vault_attributes WHERE secure_identity_reference = ${reference}`;
      await sql`DELETE FROM idv_vault_records WHERE secure_identity_reference = ${reference}`;
    }
  }
});
