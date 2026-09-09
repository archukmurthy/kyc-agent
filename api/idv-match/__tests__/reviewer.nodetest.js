const { test, afterEach } = require("node:test");
const assert = require("node:assert");

const { getCase, revealField, mask } = require("../reviewer");

const realFlag = process.env.IDV_DISCREPANCY_BANDS_ENABLED;
afterEach(() => { if (realFlag === undefined) delete process.env.IDV_DISCREPANCY_BANDS_ENABLED; else process.env.IDV_DISCREPANCY_BANDS_ENABLED = realFlag; });

function deps(over = {}) {
  const reads = [];
  return {
    reads,
    attemptStore: { getAttempt: over.getAttempt || (async () => ({ id: "att-1", status: "Approved", secure_identity_reference: "ref-1" })) },
    matchDecisionStore: { listByAttempt: async () => [{ band: "A", outcome_type: "auto_match", resolved_by: "system" }] },
    identityEventsStore: { listByAttempt: async () => [{ event_type: "extraction_presented", actor: "system" }] },
    identityVault: {
      retrieveForAuthorizedPurpose: async ({ fields, actorId }) => {
        reads.push({ fields, actorId });
        const all = { document_number: "X1234567", first_name: "Ada" };
        const out = {}; for (const f of fields) if (all[f] !== undefined) out[f] = all[f];
        return out;
      },
    },
  };
}

test("mask shows only the last 4 (or fully masks short values)", () => {
  assert.strictEqual(mask("X1234567"), "••••4567");
  assert.strictEqual(mask("Ada"), "••••");
});

test("getCase returns masked fields + decisions + events, never full values", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const d = deps();
  const c = await getCase("att-1", d);
  assert.strictEqual(c.maskedFields.document_number, "••••4567");
  assert.ok(!JSON.stringify(c.maskedFields).includes("X1234567"), "must not expose the full value");
  assert.strictEqual(c.decisions[0].band, "A");
  assert.strictEqual(c.events[0].event_type, "extraction_presented");
});

test("revealField returns the full value (audited via the Vault) for a reviewable concept", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const d = deps();
  const r = await revealField({ attemptId: "att-1", concept: "document_number", actorId: "reviewer-9" }, d);
  assert.strictEqual(r.value, "X1234567");
  assert.strictEqual(d.reads.at(-1).actorId, "reviewer-9"); // audited under the reviewer's id
});

test("revealField rejects a non-reviewable concept and requires an actor", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  assert.strictEqual((await revealField({ attemptId: "att-1", concept: "mrz", actorId: "r" }, deps())).error, "concept_not_reviewable");
  assert.strictEqual((await revealField({ attemptId: "att-1", concept: "document_number" }, deps())).error, "attemptId_concept_actor_required");
});

test("inert when flag off", async () => {
  delete process.env.IDV_DISCREPANCY_BANDS_ENABLED;
  assert.deepStrictEqual(await getCase("att-1", deps()), { enabled: false });
});
