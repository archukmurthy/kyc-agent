const { test, afterEach } = require("node:test");
const assert = require("node:assert");

const { confirmIdentity } = require("../confirm");

const realFlag = process.env.IDV_DISCREPANCY_BANDS_ENABLED;
afterEach(() => { if (realFlag === undefined) delete process.env.IDV_DISCREPANCY_BANDS_ENABLED; else process.env.IDV_DISCREPANCY_BANDS_ENABLED = realFlag; });

function deps(over = {}) {
  const events = [], corrections = [];
  return {
    events, corrections,
    attemptStore: { getAttempt: over.getAttempt || (async () => ({ id: "att-1", secure_identity_reference: "ref-1" })) },
    identityVault: {
      retrieveForAuthorizedPurpose: async () => ({ document_number: "X1", gender: "F" }),
      recordCorrection: async (c) => { corrections.push(c); },
    },
    identityEventsStore: { appendIdentityEvent: async (e) => { events.push(e); } },
  };
}

test("inert when flag off", async () => {
  delete process.env.IDV_DISCREPANCY_BANDS_ENABLED;
  assert.deepStrictEqual(await confirmIdentity({ attemptId: "att-1" }, deps()), { enabled: false });
});

test("errors when the attempt has no Vault reference", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const r = await confirmIdentity({ attemptId: "att-1" }, deps({ getAttempt: async () => ({ id: "att-1", secure_identity_reference: null }) }));
  assert.strictEqual(r.error, "no_vault_reference");
});

test("records confirmed / corrected / gap events and corrects only changed fields", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const d = deps();
  const r = await confirmIdentity({ attemptId: "att-1", confirmedFields: { documentNumber: "X1", gender: "M", placeOfBirth: "London" } }, d);
  assert.strictEqual(r.secureIdentityReference, "ref-1");
  const byConcept = Object.fromEntries(d.events.map((e) => [e.attributeConcept, e.eventType]));
  assert.strictEqual(byConcept.document_number, "applicant_confirmed");
  assert.strictEqual(byConcept.gender, "applicant_corrected");
  assert.strictEqual(byConcept.place_of_birth, "applicant_gap_supplied");
  // only changed/gap fields are written to the Vault, not the unchanged one
  const correctedConcepts = d.corrections.map((c) => c.concept).sort();
  assert.deepStrictEqual(correctedConcepts, ["gender", "place_of_birth"]);
});
