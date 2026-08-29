"use strict";

const {
  validateCapabilityResult,
  validateDiscoveryRequest,
  validateExtractionRequest,
} = require("../contracts/capability");
const {
  assertArray,
  assertDataOnly,
  assertNonEmptyString,
  assertPlainObject,
  assertUniqueStrings,
  cloneData,
  deepFreeze,
  fail,
} = require("../internal/validation");
const { StubDiscoveryService, StubExtractionService } = require("./scriptedStubs");

const SCENARIO_KIND = Object.freeze({ CORE: "CORE", POLICY_FOCUSED: "POLICY_FOCUSED" });
const CAPABILITY = Object.freeze({ DISCOVERY: "DISCOVERY", EXTRACTION: "EXTRACTION" });
const FUTURE_EXPECTATION_STATUS = "NON_EXECUTED_FUTURE_ACCEPTANCE";

function knownPolicyReferences(policyPack) {
  return {
    requirements: new Set(policyPack.requirements.map(({ requirementId }) => requirementId)),
    actions: new Set(Object.keys(policyPack.actionTemplates)),
    evidence: new Set(policyPack.evidenceCatalogue.items.map(({ key }) => key)),
  };
}

function assertKnownReferences(values, known, path) {
  assertUniqueStrings(values, path);
  values.forEach((value) => {
    if (!known.has(value)) fail(`${path} references unknown policy identifier ${value}`);
  });
}

function validateScenario(scenario, policyPack) {
  assertPlainObject(scenario, "scenario");
  assertDataOnly(scenario, "scenario");
  assertNonEmptyString(scenario.id, "scenario.id");
  if (!/^[SP]\d{2}$/.test(scenario.id)) fail("scenario.id must use S## or P## format");
  if (!Object.values(SCENARIO_KIND).includes(scenario.kind)) fail("scenario.kind is unsupported");
  assertNonEmptyString(scenario.title, "scenario.title");
  assertNonEmptyString(scenario.purpose, "scenario.purpose");
  assertPlainObject(scenario.context, "scenario.context");

  assertPlainObject(scenario.policyLinks, "scenario.policyLinks");
  const known = knownPolicyReferences(policyPack);
  assertKnownReferences(scenario.policyLinks.requirementIds, known.requirements, "scenario.policyLinks.requirementIds");
  assertKnownReferences(scenario.policyLinks.actionTemplateIds, known.actions, "scenario.policyLinks.actionTemplateIds");
  assertKnownReferences(scenario.policyLinks.evidenceCatalogueKeys, known.evidence, "scenario.policyLinks.evidenceCatalogueKeys");
  scenario.policyLinks.actionTemplateIds.forEach((actionId) => {
    if (/^B\d+$/.test(actionId)) fail(`scenario policy action ${actionId} is a legacy positional identifier`);
  });

  assertArray(scenario.steps, "scenario.steps");
  if (scenario.steps.length === 0) fail("scenario.steps must contain at least one capability call");
  scenario.steps.forEach((step, index) => {
    const path = `scenario.steps[${index}]`;
    assertPlainObject(step, path);
    if (step.capability === CAPABILITY.DISCOVERY) validateDiscoveryRequest(step.request);
    else if (step.capability === CAPABILITY.EXTRACTION) validateExtractionRequest(step.request);
    else fail(`${path}.capability is unsupported`);
    validateCapabilityResult(step.response, { expectedRequestId: step.request.requestId });

    step.request.informationNeeds.forEach((need, needIndex) => {
      if (need.policyRequirementId === undefined) return;
      if (!known.requirements.has(need.policyRequirementId)) {
        fail(`${path}.request.informationNeeds[${needIndex}] references unknown policy requirement ${need.policyRequirementId}`);
      }
      if (!scenario.policyLinks.requirementIds.includes(need.policyRequirementId)) {
        fail(`${path}.request.informationNeeds[${needIndex}] policy requirement is missing from scenario.policyLinks`);
      }
    });

    const evidenceReferences = [
      ...(step.request.artifactEvidenceReferences || []),
      ...step.response.operationEvidenceReferences,
      ...step.response.candidateFacts.flatMap((fact) => fact.evidenceReferences),
    ];
    evidenceReferences.forEach((reference, referenceIndex) => {
      const catalogueKey = reference.locator?.catalogueKey;
      if (catalogueKey === undefined) return;
      if (!known.evidence.has(catalogueKey)) {
        fail(`${path} evidence reference ${referenceIndex} uses unknown catalogue key ${catalogueKey}`);
      }
      if (!scenario.policyLinks.evidenceCatalogueKeys.includes(catalogueKey)) {
        fail(`${path} evidence catalogue key ${catalogueKey} is missing from scenario.policyLinks`);
      }
    });
  });

  assertArray(scenario.invariants, "scenario.invariants");
  scenario.invariants.forEach((invariant, index) => {
    assertNonEmptyString(invariant, `scenario.invariants[${index}]`);
  });
  assertArray(scenario.futureExpectations, "scenario.futureExpectations");
  scenario.futureExpectations.forEach((future, index) => {
    assertPlainObject(future, `scenario.futureExpectations[${index}]`);
    if (future.status !== FUTURE_EXPECTATION_STATUS) {
      fail(`scenario.futureExpectations[${index}].status must mark behavior as non-executed`);
    }
    assertNonEmptyString(future.expectation, `scenario.futureExpectations[${index}].expectation`);
  });
  return true;
}

function validateScenarioCorpus(scenarios, policyPack) {
  assertArray(scenarios, "scenarios");
  assertUniqueStrings(scenarios.map(({ id }) => id), "scenario identifiers");
  scenarios.forEach((scenario) => validateScenario(scenario, policyPack));
  return true;
}

async function runScenario(scenario, policyPack) {
  validateScenario(scenario, policyPack);
  const discoveryResults = scenario.steps
    .filter(({ capability }) => capability === CAPABILITY.DISCOVERY)
    .map(({ response }) => response);
  const extractionResults = scenario.steps
    .filter(({ capability }) => capability === CAPABILITY.EXTRACTION)
    .map(({ response }) => response);
  const discoveryService = new StubDiscoveryService(discoveryResults);
  const extractionService = new StubExtractionService(extractionResults);
  const results = [];

  for (const step of scenario.steps) {
    const result = step.capability === CAPABILITY.DISCOVERY
      ? await discoveryService.discover(step.request)
      : await extractionService.extract(step.request);
    results.push({ capability: step.capability, result });
  }
  return deepFreeze(cloneData(results));
}

module.exports = {
  CAPABILITY,
  FUTURE_EXPECTATION_STATUS,
  SCENARIO_KIND,
  runScenario,
  validateScenario,
  validateScenarioCorpus,
};
