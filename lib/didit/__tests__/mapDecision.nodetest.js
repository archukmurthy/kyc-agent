const { test } = require("node:test");
const assert = require("node:assert");
const { mapDecision } = require("../mapDecision");

const SAMPLE = {
  status: "Approved",
  decision: {
    status: "Approved",
    id_verifications: [{
      first_name: "ADA", last_name: "LOVELACE",
      date_of_birth: "1815-12-10", nationality: "GB",
      document_type: "PASSPORT", document_number: "X1234567",
      expiration_date: "2030-01-01", issuing_state: "GBR",
      parsed_address: { full: "12 Analytical Ave, London" },
    }],
    liveness_checks: [{ status: "PASSED", score: 0.98 }],
    face_matches: [{ status: "PASSED", score: 0.95 }],
  },
};

test("maps identity fields and captures extras", () => {
  const out = mapDecision(SAMPLE);
  assert.strictEqual(out.status, "Approved");
  assert.strictEqual(out.verified, true);
  assert.deepStrictEqual(out.mappedFields, {
    applicantFirstName: "Ada",
    applicantLastName: "Lovelace",
    applicantDateOfBirth: "1815-12-10",
    applicantNationality: "GB",
  });
  assert.strictEqual(out.extras.documentExpired, false);
  assert.strictEqual(out.extras.amlHit, false);
  assert.strictEqual(out.extras.documentNumber, "X1234567");
  assert.strictEqual(out.extras.documentType, "PASSPORT");
  assert.strictEqual(out.extras.expirationDate, "2030-01-01");
  assert.strictEqual(out.extras.livenessStatus, "PASSED");
  assert.strictEqual(out.extras.faceMatchStatus, "PASSED");
});

test("handles a not-yet-complete decision without throwing", () => {
  const out = mapDecision({ status: "In Progress" });
  assert.strictEqual(out.status, "In Progress");
  assert.strictEqual(out.verified, false);
  assert.deepStrictEqual(out.mappedFields, {});
});

test("converts 3-letter nationality to 2-letter and omits MRZ", () => {
  const out = mapDecision({
    decision: {
      status: "Approved",
      id_verifications: [{ first_name: "MARIA", last_name: "VILLAREAL", nationality: "ARG", mrz: { birth_date: "900615" } }],
    },
  });
  assert.strictEqual(out.mappedFields.applicantNationality, "AR");
  assert.strictEqual(out.mappedFields.applicantFirstName, "Maria");
  assert.strictEqual("mrz" in out.extras, false);
});

test("flags an expired document", () => {
  const out = mapDecision({ decision: { status: "Approved", id_verifications: [{ expiration_date: "2000-01-01" }] } });
  assert.strictEqual(out.extras.documentExpired, true);
});

test("detects an AML/PEP hit and counts matches", () => {
  const hit = mapDecision({ decision: { status: "Declined", aml_screenings: [{ total_hits: 2, status: "DECLINED" }] } });
  assert.strictEqual(hit.extras.amlHit, true);
  assert.strictEqual(hit.extras.amlTotalHits, 2);
  const clean = mapDecision({ decision: { status: "Approved", aml_screenings: [{ total_hits: 0 }] } });
  assert.strictEqual(clean.extras.amlHit, false);
});
