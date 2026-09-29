const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

// §17 cross-cutting invariants over the full persisted bundle + Evidence envelope.
const { persistDecision } = require("../persistDecision");
const vault = require("../identityVault");
const { buildEvidenceEnvelope } = require("../evidenceOutbox");

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
      nationality: "GBR", document_number: PII.docNo,
      mrz: { last_name: PII.name, document_number: PII.docNo }, completed_at: "2026-09-01T10:04:00Z",
    }],
    liveness_checks: [{ status: "Approved", score: 0.99 }],
    face_matches: [{ status: "Approved", score: 0.97 }],
  },
});

async function persistedBundle() {
  let patch = null;
  await persistDecision(
    { attempt: { id: "att-1" }, decision: decisionPayload(), receivedAt: new Date("2026-09-02T00:00:00Z") },
    { attemptStore: { updateAttempt: async (id, p) => { patch = p; } } },
  );
  return patch;
}

test("provider outcome is never expressed as a KYC approval", async () => {
  const patch = await persistedBundle();
  const env = buildEvidenceEnvelope({
    attemptId: "att-1", secureIdentityReference: patch.secureIdentityReference, verificationResult: patch.verificationResult,
  });
  const blob = JSON.stringify({ patch, env }).toLowerCase();
  for (const forbidden of ["kyc_approved", "kyc_approval", "kycdecision", "approved_for_kyc", "kyc_verified"]) {
    assert.ok(!blob.includes(forbidden), `must not express KYC approval (${forbidden})`);
  }
  // Provider verification is present, but explicitly a provider signal only.
  assert.strictEqual(patch.verificationResult.providerVerified, true);
  assert.strictEqual(env.provider_verified, true);
});

test("no numeric score survives into the persisted bundle or the envelope", async () => {
  const patch = await persistedBundle();
  const env = buildEvidenceEnvelope({ attemptId: "att-1", verificationResult: patch.verificationResult });
  const blob = JSON.stringify({ patch, env });
  assert.ok(!blob.includes("0.99") && !blob.includes("0.97"), "score values must not appear");
  for (const o of patch.verificationResult.observations) assert.ok(!("score" in o));
});

test("no plaintext identity survives into the persisted row or the envelope", async () => {
  const patch = await persistedBundle();
  const env = buildEvidenceEnvelope({ attemptId: "att-1", secureIdentityReference: patch.secureIdentityReference, verificationResult: patch.verificationResult });
  const blob = JSON.stringify({ row: patch.verificationResult, env });
  for (const secret of [PII.name, PII.first, PII.dob, PII.docNo]) {
    assert.ok(!blob.includes(secret), `plaintext ${secret} leaked`);
  }
  // The PII is instead reachable only via the opaque Vault reference.
  assert.match(patch.secureIdentityReference, /^[0-9a-f-]{36}$/);
});
