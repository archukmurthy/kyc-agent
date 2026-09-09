const { test } = require("node:test");
const assert = require("node:assert");

const outbox = require("../evidenceOutbox");
const { mapDiditDecision } = require("../canonicalMapping");

const PII = { name: "LOVELACE", first: "ADA", dob: "1815-12-10", docNo: "X1234567" };

// A realistic non-PII bundle, exactly as persistDecision stores it.
function verificationResult() {
  const payload = {
    status: "Approved",
    decision: {
      session_id: "sess-1", decision_id: "dec-1", status: "Approved",
      created_at: "2026-09-01T10:00:00Z", completed_at: "2026-09-01T10:05:00Z",
      id_verifications: [{
        status: "Approved", document_type: "Passport", issuing_country: "GBR",
        first_name: PII.first, last_name: PII.name, date_of_birth: PII.dob,
        nationality: "GBR", document_number: PII.docNo,
        mrz: { last_name: PII.name, document_number: PII.docNo },
        completed_at: "2026-09-01T10:04:00Z",
      }],
      liveness_checks: [{ status: "Approved", score: 0.99 }],
    },
  };
  const mapped = mapDiditDecision(payload, { receivedAt: new Date("2026-09-02T00:00:00Z") });
  return {
    provider: mapped.provider, providerSessionId: mapped.providerSessionId, providerReportId: mapped.providerReportId,
    providerStatus: "Approved", canonicalStatus: mapped.providerDecision.canonical_status,
    providerVerified: mapped.providerVerified, observations: mapped.observations,
    providerDecision: mapped.providerDecision, externalReferences: mapped.externalReferences,
    timestamps: mapped.timestamps,
  };
}

function fakeStore() {
  const rows = [];
  const keys = new Set();
  return {
    rows,
    appendOutbox: async ({ attemptId, idempotencyKey, envelope }) => {
      if (keys.has(idempotencyKey)) return { id: null, inserted: false };
      keys.add(idempotencyKey);
      rows.push({ attemptId, idempotencyKey, envelope });
      return { id: `o-${rows.length}`, inserted: true };
    },
  };
}

test("envelope carries references + provenance only, no plaintext identity", () => {
  const env = outbox.buildEvidenceEnvelope({
    attemptId: "att-1",
    secureIdentityReference: "vault-ref-uuid",
    verificationResult: verificationResult(),
    officerReference: "officer-123",
  });
  assert.strictEqual(env.secure_identity_reference, "vault-ref-uuid");
  assert.strictEqual(env.officer_reference, "officer-123");
  assert.ok(Array.isArray(env.observations) && env.external_evidence_references);
  const blob = JSON.stringify(env);
  for (const secret of [PII.name, PII.first, PII.dob, PII.docNo]) {
    assert.ok(!blob.includes(secret), `envelope leaked ${secret}`);
  }
});

test("provider outcome is carried but not as a KYC approval", () => {
  const env = outbox.buildEvidenceEnvelope({ attemptId: "att-1", verificationResult: verificationResult() });
  assert.strictEqual(env.provider_verified, true);
  assert.strictEqual(env.provider_decision.canonical_status, "VERIFIED");
});

test("build rejects a smuggled plaintext identity key", () => {
  const vr = verificationResult();
  vr.observations = [{ observation_type: "LIVENESS", document_number: PII.docNo }];
  assert.throws(
    () => outbox.buildEvidenceEnvelope({ attemptId: "att-1", verificationResult: vr }),
    /references only/);
});

test("build rejects smuggled raw/biometric evidence", () => {
  const vr = verificationResult();
  vr.observations = [{ observation_type: "FACE_MATCH", selfie: "data:image/png;base64,AAAA" }];
  assert.throws(() => outbox.buildEvidenceEnvelope({ attemptId: "att-1", verificationResult: vr }));
});

test("publish is idempotent on the idempotency key", async () => {
  const store = fakeStore();
  const input = { attemptId: "att-1", secureIdentityReference: "ref", verificationResult: verificationResult() };
  const first = await outbox.publishEvidence(input, { evidenceOutboxStore: store });
  const second = await outbox.publishEvidence(input, { evidenceOutboxStore: store });
  assert.strictEqual(first.inserted, true);
  assert.strictEqual(second.inserted, false);
  assert.strictEqual(store.rows.length, 1);
});

test("there is no outbox consumer exported (no Evidence rows until EVID-1)", () => {
  const keys = Object.keys(outbox);
  for (const forbidden of ["consume", "consumeOutbox", "publishToEvidence", "drain"]) {
    assert.ok(!keys.includes(forbidden), `outbox must not expose ${forbidden}`);
  }
});
