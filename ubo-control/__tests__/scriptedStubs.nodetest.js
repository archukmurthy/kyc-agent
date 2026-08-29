"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createUboControl } = require("..");
const { isDiscoveryService, isExtractionService } = require("../contracts/capability");
const policyPack = require("../policies/uk-corporate/1.3-rc/policy.json");
const { coreScenarios } = require("../test-support/scenarioCorpus");
const {
  StubDiscoveryService,
  StubExtractionService,
  StubSequenceExhaustedError,
} = require("../test-support/scriptedStubs");

function scenario(id) {
  return coreScenarios.find((item) => item.id === id);
}

test("scripted stubs implement the approved service shapes and remain explicitly injected", () => {
  const discovery = new StubDiscoveryService([]);
  const extraction = new StubExtractionService([]);
  assert.equal(isDiscoveryService(discovery), true);
  assert.equal(isExtractionService(extraction), true);
  assert.throws(() => createUboControl({ policyPack }), /DiscoveryService must be explicitly configured/);
  assert.equal(Object.prototype.hasOwnProperty.call(require(".."), "StubDiscoveryService"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(require(".."), "StubExtractionService"), false);
  const compositionSource = fs.readFileSync(
    path.join(__dirname, "..", "composition", "createUboControl.js"),
    "utf8",
  );
  assert.doesNotMatch(compositionSource, /scriptedStubs|StubDiscoveryService|StubExtractionService/);
});

test("Discovery stub returns its configured sequence exactly and then fails visibly", async () => {
  const steps = scenario("S07").steps;
  const stub = new StubDiscoveryService(steps.map(({ response }) => response));
  assert.deepEqual(await stub.discover(steps[0].request), steps[0].response);
  assert.deepEqual(await stub.discover(steps[1].request), steps[1].response);
  await assert.rejects(
    () => stub.discover(steps[1].request),
    (error) => error instanceof StubSequenceExhaustedError
      && error.code === "STUB_RESPONSE_SEQUENCE_EXHAUSTED",
  );
});

test("Extraction stub returns configured candidate and operation evidence exactly", async () => {
  const step = scenario("S11").steps.find(({ capability }) => capability === "EXTRACTION");
  const stub = new StubExtractionService([step.response]);
  const returned = await stub.extract(step.request);
  assert.deepEqual(returned, step.response);
  assert.notStrictEqual(returned, step.response);
  assert.notStrictEqual(returned.candidateFacts[0], step.response.candidateFacts[0]);
});

test("stubs defensively copy configured results and never mutate fixture state", async () => {
  const step = scenario("S01").steps[0];
  const configured = structuredClone(step.response);
  const stub = new StubDiscoveryService([configured]);
  configured.candidateFacts[0].measurement.value = 1;
  const returned = await stub.discover(step.request);
  assert.equal(returned.candidateFacts[0].measurement.value, 40);
  returned.candidateFacts[0].measurement.value = 99;
  assert.equal(step.response.candidateFacts[0].measurement.value, 40);
});

test("stub calls validate requests and correlate configured response IDs", async () => {
  const step = scenario("S01").steps[0];
  const stub = new StubDiscoveryService([step.response]);
  await assert.rejects(() => stub.discover({ ...step.request, requestId: "wrong-id" }), /requestId must match/);

  const invalid = new StubExtractionService([scenario("S13").steps[0].response]);
  await assert.rejects(
    () => invalid.extract({ ...scenario("S13").steps[0].request, artifactEvidenceReferences: [] }),
    /must identify at least one external artifact/,
  );
});

test("production composition accepts stubs only when a caller injects them explicitly", async () => {
  const discoveryStep = scenario("S11").steps[0];
  const extractionStep = scenario("S11").steps[1];
  const control = createUboControl({
    discoveryService: new StubDiscoveryService([discoveryStep.response]),
    extractionService: new StubExtractionService([extractionStep.response]),
    policyPack,
  });
  assert.deepEqual(await control.discover(discoveryStep.request), discoveryStep.response);
  assert.deepEqual(await control.extract(extractionStep.request), extractionStep.response);
});
