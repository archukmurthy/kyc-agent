const { test } = require("node:test");
const assert = require("node:assert");

const { mapDiditDecision } = require("../canonicalMapping");

const PII = { name: "LOVELACE", first: "ADA", dob: "1815-12-10", docNo: "X1234567" };

const decisionPayload = () => ({
  status: "Approved",
  decision: {
    session_id: "sess-1",
    decision_id: "dec-1",
    status: "Approved",
    created_at: "2026-09-01T10:00:00Z",
    completed_at: "2026-09-01T10:05:00Z",
    id_verifications: [{
      status: "Approved",
      document_type: "Passport",
      issuing_country: "GBR",
      first_name: PII.first,
      last_name: PII.name,
      date_of_birth: PII.dob,
      nationality: "GBR",
      document_number: PII.docNo,
      expiration_date: "2030-01-01",
      document_validity: true,
      mrz: { last_name: PII.name, first_name: PII.first, document_number: PII.docNo },
      completed_at: "2026-09-01T10:04:00Z",
    }],
    liveness_checks: [{ status: "Approved", score: 0.99, completed_at: "2026-09-01T10:04:30Z" }],
    face_matches: [{ status: "Approved", score: 0.97 }],
  },
});

test("extracts canonical identity attributes including MRZ", () => {
  const { identityAttributes } = mapDiditDecision(decisionPayload());
  const concepts = identityAttributes.map((a) => a.attribute_concept);
  for (const expected of ["first_name", "last_name", "date_of_birth", "document_number", "mrz"]) {
    assert.ok(concepts.includes(expected), `missing concept ${expected}`);
  }
  const docNo = identityAttributes.find((a) => a.attribute_concept === "document_number");
  assert.strictEqual(docNo.attribute_value, PII.docNo);
});

test("observations carry outcomes only, never numeric scores", () => {
  const { observations } = mapDiditDecision(decisionPayload());
  const types = observations.map((o) => o.observation_type);
  assert.ok(types.includes("LIVENESS") && types.includes("FACE_MATCH") && types.includes("DOCUMENT_AUTHENTICITY"));
  for (const o of observations) {
    assert.ok(!("score" in o), "observation must not expose a numeric score");
    assert.strictEqual(typeof o.protected_score_available, "boolean");
  }
  const liveness = observations.find((o) => o.observation_type === "LIVENESS");
  assert.strictEqual(liveness.status, "PASSED");
  assert.strictEqual(liveness.protected_score_available, true); // a score existed, but its value is not exposed
});

test("provider decision keeps native status separate; providerVerified is not KYC approval", () => {
  const { providerDecision, providerVerified } = mapDiditDecision(decisionPayload());
  assert.strictEqual(providerDecision.canonical_status, "VERIFIED");
  assert.strictEqual(providerDecision.original_provider_status, "Approved");
  assert.strictEqual(providerVerified, true);
});

test("non-PII bundle (observations/decision/external refs) leaks no plaintext identity", () => {
  const { observations, providerDecision, externalReferences, timestamps } = mapDiditDecision(decisionPayload());
  const nonPii = JSON.stringify({ observations, providerDecision, externalReferences, timestamps });
  for (const secret of [PII.name, PII.first, PII.dob, PII.docNo]) {
    assert.ok(!nonPii.includes(secret), `non-PII bundle leaked ${secret}`);
  }
});

test("external evidence references are external-custody, not locally available", () => {
  const { externalReferences } = mapDiditDecision(decisionPayload());
  assert.ok(externalReferences.length >= 1);
  for (const ref of externalReferences) {
    assert.strictEqual(ref.external_custody, true);
    assert.strictEqual(ref.content_locally_available, false);
  }
});

test("timestamps preserve distinct provider vs receipt times", () => {
  const receivedAt = new Date("2026-09-02T00:00:00Z");
  const { timestamps } = mapDiditDecision(decisionPayload(), { receivedAt });
  assert.strictEqual(timestamps.created_at, "2026-09-01T10:00:00.000Z");
  assert.strictEqual(timestamps.provider_completed_at, "2026-09-01T10:05:00.000Z");
  assert.strictEqual(timestamps.result_received_at, receivedAt.toISOString());
  assert.notStrictEqual(timestamps.created_at, timestamps.result_received_at);
});

test("a decision with no MRZ omits the mrz attribute", () => {
  const payload = decisionPayload();
  delete payload.decision.id_verifications[0].mrz;
  const concepts = mapDiditDecision(payload).identityAttributes.map((a) => a.attribute_concept);
  assert.ok(!concepts.includes("mrz"));
});
