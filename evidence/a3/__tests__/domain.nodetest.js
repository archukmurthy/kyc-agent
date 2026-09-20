"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildA3FixtureBundle, ids } = require("../fixtures");
const { validateA3Bundle } = require("../domain");

test("A3 fixture proves requested, discovered, direct, derived, qualified, and failed outcomes", async () => {
  const bundle = await buildA3FixtureBundle();
  assert.equal(validateA3Bundle(bundle), bundle);
  const discovered = bundle.facts.filter((f) => f.requestStatus === "discovered");
  assert.ok(discovered.length >= 3);
  assert.ok(discovered.every((f) => f.schemaFieldId === null && f.informationNeedId === null));
  assert.ok(bundle.facts.some((f) => f.groundingType === "derived"));
  assert.ok(bundle.facts.some((f) => f.supportState === "needs_verification" && f.factValue === "28 King Street"));
  assert.ok(bundle.baseGraph.extractionRuns.some((r) => r.status === "failed"));
  assert.equal(bundle.facts.some((f) => f.extractionRunId === ids.runFailed), false);
});

test("derived facts retain source-fact and versioned transformation lineage", async () => {
  const bundle = await buildA3FixtureBundle();
  const link = bundle.derivations[0];
  const input = bundle.facts.find((f) => f.id === link.inputFactId);
  const derived = bundle.facts.find((f) => f.id === link.derivedFactId);
  assert.equal(input.groundingType, "direct"); assert.equal(input.factValue, "62020");
  assert.equal(derived.groundingType, "derived"); assert.notEqual(derived.rawRepresentation, derived.factValue);
  assert.equal(link.transformationId, "uk-sic-2007-fixture"); assert.ok(link.transformationVersion);
});

test("verification preserves original facts and reconstructs agreement and disagreement", async () => {
  const bundle = await buildA3FixtureBundle();
  const before = structuredClone(bundle.facts);
  assert.deepEqual(bundle.verifications.map((v) => v.outcome).sort(), ["agreement", "disagreement"]);
  assert.ok(bundle.verifications.every((v) => v.targetExtractionRunId !== v.verificationExtractionRunId));
  assert.deepEqual(bundle.facts, before);
  assert.equal(bundle.facts.find((f) => f.id === ids.factUncertainAddress).factValue, "28 King Street");
  assert.equal(bundle.facts.find((f) => f.id === ids.factDisagreement).factValue, "25 King Street");
});

test("later re-extraction keeps the original Artifact capture timestamp", async () => {
  const bundle = await buildA3FixtureBundle();
  const original = bundle.baseGraph.artifacts.find((a) => a.id === bundle.facts.find((f) => f.id === ids.factDisagreement).artifactId);
  const laterRun = bundle.baseGraph.extractionRuns.find((r) => r.id === ids.runDisagreement);
  assert.equal(original.capturedAt, "2026-08-03T09:15:20.123Z");
  assert.equal(laterRun.startedAt, "2026-08-07T14:30:10.789Z");
});

test("source policy context does not determine extraction support", async () => {
  const bundle = await buildA3FixtureBundle();
  const lowerTrustStrong = bundle.facts.find((f) => f.sourcePolicyContext.suppliedTrust === "company_assertion" && f.supportState === "supported");
  const authoritativeWeak = bundle.facts.find((f) => f.sourcePolicyContext.suppliedTrust === "authoritative" && f.supportState === "needs_verification");
  assert.ok(lowerTrustStrong); assert.ok(authoritativeWeak);
});

test("A3 never fabricates a schema version", async () => {
  const bundle = await buildA3FixtureBundle();
  assert.ok(bundle.baseGraph.extractionRuns.filter((r) => r.id.startsWith("a300")).every((r) => r.schemaVersionReference === null));
});
