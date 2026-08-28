"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  UBO_CONFIGURATION_ERROR_CODE,
  UboConfigurationError,
  createUboControl,
  loadPolicyPack,
} = require("..");

function policyPack() {
  return {
    schemaVersion: "1.0.0",
    policyPackId: "test.pack",
    version: "1.0.0",
    jurisdiction: "GB",
    applicability: {},
    effectivePeriod: {},
    requirements: [],
    rules: [],
  };
}

function resultFor(requestId) {
  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId,
    outcome: { state: CAPABILITY_OUTCOME_STATE.NO_DATA },
    candidateFacts: [],
    operationEvidenceReferences: [],
    issues: [],
  };
}

const artifactEvidenceReference = Object.freeze({
  system: "external-evidence",
  referenceType: "ARTIFACT",
  referenceId: "artifact-1",
});

function services() {
  return {
    discoveryService: { async discover(request) { return resultFor(request.requestId); } },
    extractionService: { async extract(request) { return resultFor(request.requestId); } },
  };
}

function expectConfigurationCode(run, code) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof UboConfigurationError);
    assert.equal(error.code, code);
    return true;
  });
}

test("composition requires explicitly injected providers and never selects a stub fallback", () => {
  expectConfigurationCode(
    () => createUboControl(),
    UBO_CONFIGURATION_ERROR_CODE.MISSING_DISCOVERY_SERVICE,
  );
  expectConfigurationCode(
    () => createUboControl({ discoveryService: services().discoveryService }),
    UBO_CONFIGURATION_ERROR_CODE.MISSING_EXTRACTION_SERVICE,
  );
});

test("composition distinguishes invalid provider contracts", () => {
  expectConfigurationCode(
    () => createUboControl({
      discoveryService: {},
      extractionService: services().extractionService,
      policyPack: policyPack(),
    }),
    UBO_CONFIGURATION_ERROR_CODE.INVALID_DISCOVERY_SERVICE,
  );
  expectConfigurationCode(
    () => createUboControl({
      discoveryService: services().discoveryService,
      extractionService: {},
      policyPack: policyPack(),
    }),
    UBO_CONFIGURATION_ERROR_CODE.INVALID_EXTRACTION_SERVICE,
  );
});

test("composition wraps malformed or missing policy configuration with the stable domain error", () => {
  const configured = services();
  expectConfigurationCode(
    () => createUboControl({ ...configured }),
    UBO_CONFIGURATION_ERROR_CODE.INVALID_POLICY_PACK,
  );
  expectConfigurationCode(
    () => createUboControl({ ...configured, policyPack: { executable: () => true } }),
    UBO_CONFIGURATION_ERROR_CODE.INVALID_POLICY_PACK,
  );
});

test("composition accepts a preloaded pinned Policy Pack and exposes only its identity", () => {
  const control = createUboControl({
    ...services(),
    policyPack: loadPolicyPack(policyPack()),
  });
  assert.match(control.policyIdentity.hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.prototype.hasOwnProperty.call(control, "policyPack"), false);
});

test("discover and extract invoke exactly the explicitly injected services", async () => {
  const calls = [];
  const discoveryService = {
    async discover(request) {
      calls.push(["discover", request]);
      return resultFor(request.requestId);
    },
  };
  const extractionService = {
    async extract(request) {
      calls.push(["extract", request]);
      return resultFor(request.requestId);
    },
  };
  const control = createUboControl({ discoveryService, extractionService, policyPack: policyPack() });
  const common = {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    caseId: "case-1",
    informationNeeds: [],
  };
  const discoveryRequest = { ...common, requestId: "discover-1", subject: { name: "Example Ltd" } };
  const extractionRequest = {
    ...common,
    requestId: "extract-1",
    artifactEvidenceReferences: [artifactEvidenceReference],
  };

  await control.discover(discoveryRequest);
  await control.extract(extractionRequest);

  assert.deepEqual(calls, [
    ["discover", discoveryRequest],
    ["extract", extractionRequest],
  ]);
});

test("composition validates provider results and correlates request IDs", async () => {
  const configured = services();
  const control = createUboControl({
    ...configured,
    discoveryService: { async discover() { return resultFor("wrong-request"); } },
    policyPack: policyPack(),
  });

  await assert.rejects(() => control.discover({
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: "expected-request",
    caseId: "case-1",
    informationNeeds: [],
    subject: { name: "Example Ltd" },
  }), /requestId must match/);
});
