const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const { persistDecision } = require("../persistDecision");
const vault = require("../identityVault");

beforeEach(() => vault._resetVaultForTests());

const PII = { name: "LOVELACE", first: "ADA", dob: "1815-12-10", docNo: "X1234567" };

const decisionPayload = () => ({
  status: "Approved",
  decision: {
    session_id: "sess-1", decision_id: "dec-1", status: "Approved",
    created_at: "2026-09-01T10:00:00Z", completed_at: "2026-09-01T10:05:00Z",
    id_verifications: [{
      status: "Approved", document_type: "Passport", issuing_country: "GBR",
      first_name: PII.first, last_name: PII.name, date_of_birth: PII.dob,
      nationality: "GBR", document_number: PII.docNo, expiration_date: "2030-01-01",
      document_validity: true,
      mrz: { last_name: PII.name, first_name: PII.first, document_number: PII.docNo },
      completed_at: "2026-09-01T10:04:00Z",
    }],
    liveness_checks: [{ status: "Approved", score: 0.99 }],
    face_matches: [{ status: "Approved", score: 0.97 }],
  },
});

function fakeStore() {
  const calls = { patch: null };
  return {
    calls,
    updateAttempt: async (id, patch) => { calls.patch = { id, patch }; },
  };
}

test("routes PII to the Vault and stores only the reference + non-PII in the row", async () => {
  const store = fakeStore();
  const result = await persistDecision(
    { attempt: { id: "att-1" }, decision: decisionPayload(), receivedAt: new Date("2026-09-02T00:00:00Z") },
    { attemptStore: store },
  );

  const { patch } = store.calls.patch;
  assert.strictEqual(store.calls.patch.id, "att-1");
  assert.strictEqual(patch.status, "Approved");
  assert.match(patch.secureIdentityReference, /^[0-9a-f-]{36}$/);
  assert.strictEqual(patch.secureIdentityReference, result.secureIdentityReference);

  // The stored bundle is non-PII: no identity attributes, no plaintext values.
  assert.ok(!("identityAttributes" in patch.verificationResult));
  const stored = JSON.stringify(patch.verificationResult);
  for (const secret of [PII.name, PII.first, PII.dob, PII.docNo]) {
    assert.ok(!stored.includes(secret), `verification_result leaked ${secret}`);
  }
  assert.strictEqual(patch.verificationResult.providerVerified, true);
});

test("the extracted PII is actually retrievable from the Vault by its reference", async () => {
  const store = fakeStore();
  await persistDecision({ attempt: { id: "att-1" }, decision: decisionPayload() }, { attemptStore: store });
  const reference = store.calls.patch.patch.secureIdentityReference;

  const values = await vault.retrieveForAuthorizedPurpose({
    reference,
    fields: ["document_number", "date_of_birth"],
  });
  assert.strictEqual(values.document_number, PII.docNo);
  assert.strictEqual(values.date_of_birth, PII.dob);
});

test("a decision with no identity attributes stores no Vault reference", async () => {
  const store = fakeStore();
  await persistDecision(
    { attempt: { id: "att-1" }, decision: { status: "Declined", decision: { session_id: "s", status: "Declined" } } },
    { attemptStore: store },
  );
  assert.strictEqual(store.calls.patch.patch.secureIdentityReference, null);
  assert.strictEqual(store.calls.patch.patch.status, "Declined");
});
