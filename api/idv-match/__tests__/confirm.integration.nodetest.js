const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { neon } = require("@neondatabase/serverless");

// GUARDED DB integration (Phase E3). IDV_MATCH_DB_TEST=1 + IDV_DATABASE_URL +
// bands flag on.
const RUN = process.env.IDV_MATCH_DB_TEST === "1" && !!(process.env.IDV_DATABASE_URL || process.env.DATABASE_URL);

const { createAttempt, updateAttempt } = require("../attemptStore");
const identityVault = require("../identityVault");
const { confirmIdentity } = require("../confirm");
const { listByAttempt } = require("../identityEventsStore");
const { createIdentityAttribute } = require("../../../idv");

const realFlag = process.env.IDV_DISCREPANCY_BANDS_ENABLED;
before(() => { process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1"; });
after(() => { if (realFlag === undefined) delete process.env.IDV_DISCREPANCY_BANDS_ENABLED; else process.env.IDV_DISCREPANCY_BANDS_ENABLED = realFlag; });

test("confirm records confirmed/corrected/gap events + corrects the Vault, no plaintext leaves", { skip: !RUN }, async () => {
  const sql = neon(process.env.IDV_DATABASE_URL || process.env.DATABASE_URL);
  const applicationId = `confirm-int-${Date.now()}`;
  let attemptId, reference;
  try {
    attemptId = await createAttempt({ applicationId, selectedOfficer: { name: "X, Y", officerId: "o1" }, diditSessionId: "s" });
    reference = await identityVault.storeExtractedIdentity({
      sessionId: attemptId, subjectId: attemptId,
      attributes: [
        createIdentityAttribute({ concept: "document_number", value: "X1234567", provider: "DIDIT", providerSessionId: "s" }),
        createIdentityAttribute({ concept: "gender", value: "F", provider: "DIDIT", providerSessionId: "s" }),
      ],
    });
    await updateAttempt(attemptId, { secureIdentityReference: reference });

    const r = await confirmIdentity({
      attemptId,
      confirmedFields: { documentNumber: "X1234567", gender: "M", placeOfBirth: "London" },
    });
    assert.strictEqual(r.secureIdentityReference, reference);

    const events = await listByAttempt(attemptId);
    const byConcept = Object.fromEntries(events.map((e) => [e.attribute_concept, e.event_type]));
    assert.strictEqual(byConcept.document_number, "applicant_confirmed"); // unchanged
    assert.strictEqual(byConcept.gender, "applicant_corrected");           // changed
    assert.strictEqual(byConcept.place_of_birth, "applicant_gap_supplied");// not on the document

    // Vault now reflects the correction; original preserved as an older version.
    const got = await identityVault.retrieveForAuthorizedPurpose({ reference, fields: ["gender"] });
    assert.strictEqual(got.gender, "M");
    const genderVersions = await sql`SELECT count(*)::int AS c FROM idv_vault_attributes WHERE secure_identity_reference = ${reference} AND attribute_concept = 'gender'`;
    assert.strictEqual(genderVersions[0].c, 2);

    // no plaintext value in the events table
    const eblob = JSON.stringify(await sql`SELECT * FROM idv_identity_events WHERE attempt_id = ${attemptId}`);
    for (const secret of ["X1234567", "London"]) assert.ok(!eblob.includes(secret), `event leaked ${secret}`);
  } finally {
    if (attemptId) {
      await sql`DELETE FROM idv_identity_events WHERE attempt_id = ${attemptId}`;
      if (reference) {
        await sql`DELETE FROM idv_vault_access_audit WHERE secure_identity_reference = ${reference}`;
        await sql`DELETE FROM idv_vault_attributes WHERE secure_identity_reference = ${reference}`;
        await sql`DELETE FROM idv_vault_records WHERE secure_identity_reference = ${reference}`;
      }
      await sql`DELETE FROM idv_verification_attempts WHERE id = ${attemptId}`;
    }
  }
});
