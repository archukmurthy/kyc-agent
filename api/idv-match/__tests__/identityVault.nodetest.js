const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const vault = require("../identityVault");
const { createIdentityAttribute } = require("../../../idv");

beforeEach(() => vault._resetVaultForTests());

const attr = (concept, value) =>
  createIdentityAttribute({ concept, value, provider: "DIDIT", providerSessionId: "sess-1" });

const sampleAttributes = () => [
  attr("full_name", "Ada Lovelace"),
  attr("date_of_birth", "1815-12-10"),
  attr("document_number", "X1234567"),
];

test("store returns an opaque reference that is not the plaintext PII", async () => {
  const reference = await vault.storeExtractedIdentity({
    tenantId: "nium",
    subjectId: "subj-1",
    sessionId: "attempt-1",
    attributes: sampleAttributes(),
  });
  assert.match(reference, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const blob = JSON.stringify(reference);
  for (const secret of ["Ada Lovelace", "1815-12-10", "X1234567"]) {
    assert.ok(!blob.includes(secret), `reference must not leak ${secret}`);
  }
});

test("re-storing the same attempt is idempotent (same reference)", async () => {
  const first = await vault.storeExtractedIdentity({ sessionId: "attempt-1", attributes: sampleAttributes() });
  const second = await vault.storeExtractedIdentity({ sessionId: "attempt-1", attributes: sampleAttributes() });
  assert.strictEqual(first, second);
});

test("retrieve returns only the allowlisted concepts (data minimization)", async () => {
  const reference = await vault.storeExtractedIdentity({ sessionId: "attempt-1", attributes: sampleAttributes() });
  const values = await vault.retrieveForAuthorizedPurpose({
    reference,
    subjectId: "subj-1",
    tenantId: "nium",
    fields: ["full_name", "date_of_birth"],
  });
  assert.deepStrictEqual(values, { full_name: "Ada Lovelace", date_of_birth: "1815-12-10" });
  assert.ok(!("document_number" in values), "unrequested concept must not be returned");
});

test("retrieve requires a non-empty allowlist", async () => {
  const reference = await vault.storeExtractedIdentity({ sessionId: "attempt-1", attributes: sampleAttributes() });
  await assert.rejects(
    () => vault.retrieveForAuthorizedPurpose({ reference, fields: [] }),
    /non-empty fields allowlist/,
  );
});

test("store rejects empty input and missing session id", async () => {
  await assert.rejects(() => vault.storeExtractedIdentity({ sessionId: "a", attributes: [] }), /at least one attribute/);
  await assert.rejects(() => vault.storeExtractedIdentity({ attributes: sampleAttributes() }), /requires a sessionId/);
});

test("store rejects raw evidence smuggled into an attribute value", async () => {
  await assert.rejects(
    () => vault.storeExtractedIdentity({
      sessionId: "attempt-1",
      attributes: [attr("selfie", "data:image/png;base64,AAAA")],
    }),
    /raw|evidence/i,
  );
});

test("correction is append-only and preserves the original value", async () => {
  const reference = await vault.storeExtractedIdentity({ sessionId: "attempt-1", attributes: sampleAttributes() });
  const result = await vault.recordCorrection({
    reference,
    sessionId: "attempt-1",
    concept: "full_name",
    attributeId: "attr-1",
    previousValue: "Ada Lovelace",
    submittedValue: "Ada King",
    action: "CORRECTED",
  });
  assert.strictEqual(result.action, "CORRECTED");
  // Original extraction still readable — correction did not overwrite it.
  const values = await vault.retrieveForAuthorizedPurpose({ reference, fields: ["full_name"] });
  assert.strictEqual(values.full_name, "Ada Lovelace");
});
