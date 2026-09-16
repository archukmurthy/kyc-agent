"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createDemoEntityMatcher, promptFor, validateRequest } = require("../demoEntityMatching.js");
const { createHandler } = require("../../../api/ubo-demo-entity-resolution.js");

const candidate = {
  candidateId: "candidate-1",
  sourcePartyA: { name: "Example Holdings Limited", entityType: "LEGAL_ENTITY", jurisdiction: "GB", externalIdentifiers: [] },
  sourcePartyB: { name: "Example Holdco Ltd", entityType: "LEGAL_ENTITY", jurisdiction: "GB", externalIdentifiers: [] },
  structuralContextA: { chainPosition: 1, ownerCount: 1, ownedCount: 1, outgoingPartyNames: ["TARGET"], incomingPartyNames: ["PARENT"] },
  structuralContextB: { chainPosition: 1, ownerCount: 1, ownedCount: 1, outgoingPartyNames: ["TARGET"], incomingPartyNames: ["PARENT"] },
  relationshipFamilies: ["ECONOMIC_OWNERSHIP"],
};

test("bounded matcher retains only party identity outcomes and audit reasons", async () => {
  const match = createDemoEntityMatcher({ provider: { async match() { return { matches: [{ candidateId: "candidate-1", classification: "LIKELY_SAME_ENTITY", confidence: 0.93, reasons: ["same chain position"] }] }; } } });
  const result = await match({ candidates: [candidate] });
  assert.deepEqual(result.matches[0], { candidateId: "candidate-1", classification: "LIKELY_SAME_ENTITY", confidence: 0.93, reasons: ["same chain position"] });
  assert.equal(result.decisionScope, "PARTY_IDENTITY_ONLY");
});

test("entity matcher rejects unsupported decisions and oversized batches", async () => {
  assert.throws(() => validateRequest({ candidates: Array.from({ length: 21 }, (_, index) => ({ ...candidate, candidateId: `candidate-${index}` })) }), /between 1 and 20/);
  const match = createDemoEntityMatcher({ provider: { async match() { return { matches: [{ candidateId: "candidate-1", classification: "QUALIFIES_AS_UBO", confidence: 1, reasons: [] }] }; } } });
  await assert.rejects(() => match({ candidates: [candidate] }), /invalid classification/);
  assert.match(promptFor([candidate]), /Never decide ownership, UBO status, verification, policy/);
});

test("API handler is POST-only and exposes the bounded matcher result", async () => {
  const handler = createHandler(async () => ({ contractVersion: "v1", matches: [], decisionScope: "PARTY_IDENTITY_ONLY" }));
  const response = () => ({ statusCode: null, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const rejected = response();
  await handler({ method: "GET" }, rejected);
  assert.equal(rejected.statusCode, 405);
  const accepted = response();
  await handler({ method: "POST", body: { candidates: [candidate] } }, accepted);
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.result.decisionScope, "PARTY_IDENTITY_ONLY");
});
