"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { UboContractError } = require("..");
const policyPack = require("../policies/uk-corporate/1.3-rc/policy.json");
const {
  allScenarios,
  coreScenarios,
  policyFocusedScenarios,
} = require("../test-support/scenarioCorpus");
const {
  FUTURE_EXPECTATION_STATUS,
  runScenario,
  validateScenario,
  validateScenarioCorpus,
} = require("../test-support/scenarioHarness");

function scenario(id) {
  return allScenarios.find((item) => item.id === id);
}

function clone(id) {
  return structuredClone(scenario(id));
}

test("the corpus contains exactly the twenty required core scenarios and eight focused policy inputs", () => {
  assert.deepEqual(coreScenarios.map(({ id }) => id), [
    "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10",
    "S11", "S12", "S13", "S14", "S15", "S16", "S17", "S18", "S19", "S20",
  ]);
  assert.deepEqual(policyFocusedScenarios.map(({ id }) => id), [
    "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08",
  ]);
  assert.equal(allScenarios.length, 28);
  assert.equal(validateScenarioCorpus(allScenarios, policyPack), true);
});

for (const fixture of coreScenarios) {
  test(`${fixture.id} ${fixture.title} is contract-valid and executable`, async () => {
    assert.equal(validateScenario(fixture, policyPack), true);
    const results = await runScenario(fixture, policyPack);
    assert.equal(results.length, fixture.steps.length);
    assert.deepEqual(results.map(({ capability }) => capability), fixture.steps.map(({ capability }) => capability));
    assert.deepEqual(results.map(({ result }) => result), fixture.steps.map(({ response }) => response));
  });
}

test("every policy-focused fixture is contract-valid and executable", async () => {
  for (const fixture of policyFocusedScenarios) {
    assert.equal(validateScenario(fixture, policyPack), true);
    assert.equal((await runScenario(fixture, policyPack)).length, fixture.steps.length);
  }
});

test("scenario runs are immutable, isolated, and repeatable", async () => {
  const fixture = scenario("S11");
  const before = structuredClone(fixture);
  const first = await runScenario(fixture, policyPack);
  const second = await runScenario(fixture, policyPack);
  assert.deepEqual(first, second);
  assert.deepEqual(fixture, before);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first[0].result.candidateFacts), true);
});

test("company and LLP economic semantics remain distinct", () => {
  const companyFact = scenario("S01").steps[0].response.candidateFacts[0];
  const llpFact = scenario("S02").steps[0].response.candidateFacts[0];
  assert.equal(companyFact.qualifiers.economicInterestConcept, "SHARE_OWNERSHIP");
  assert.equal(llpFact.qualifiers.economicInterestConcept, "SURPLUS_ASSET_RIGHTS");
  assert.equal(companyFact.qualifiers.entityProfile, "COMPANY");
  assert.equal(llpFact.qualifiers.entityProfile, "LLP");
});

test("exact, range, and unknown measurements survive without scalar coercion", async () => {
  const exact = (await runScenario(scenario("S01"), policyPack))[0].result.candidateFacts[0].measurement;
  const ranged = (await runScenario(scenario("S10"), policyPack))[0].result.candidateFacts[0].measurement;
  const unknown = (await runScenario(scenario("S12"), policyPack))[0].result.candidateFacts[0].measurement;
  assert.deepEqual(exact, { type: "EXACT", value: 40 });
  assert.deepEqual(ranged, {
    type: "RANGE", lowerBound: 20, upperBound: 30, lowerInclusive: false, upperInclusive: true,
  });
  assert.deepEqual(unknown, { type: "UNKNOWN", reason: "Percentage obscured in supplied scan" });
  assert.equal(Object.prototype.hasOwnProperty.call(ranged, "value"), false);
});

test("ownership, voting, appointment, and significant-control bases are never retyped", () => {
  assert.deepEqual(
    scenario("S14").steps[0].response.candidateFacts.map(({ relationship }) => relationship),
    ["ECONOMIC_OWNERSHIP", "VOTING_RIGHTS"],
  );
  assert.equal(scenario("S15").steps[0].response.candidateFacts[0].relationship, "BOARD_APPOINTMENT_RIGHT");
  assert.equal(
    scenario("S15").steps[1].response.candidateFacts[0].qualifiers.controlConcept,
    "MANAGEMENT_APPOINTMENT_RIGHTS",
  );
  const ambiguous = scenario("S16").steps[0].response.candidateFacts[1];
  assert.equal(ambiguous.relationship, "SIGNIFICANT_INFLUENCE_OR_CONTROL");
  assert.equal(ambiguous.qualifiers.ambiguity, "DELIBERATELY_AMBIGUOUS");
});

test("multi-layer, multipath, conflict, cycle, and duplicate candidates remain separate and directed", () => {
  assert.equal(scenario("S03").steps[0].response.candidateFacts.length, 2);
  assert.equal(scenario("S04").steps[0].response.candidateFacts.length, 4);
  const conflicts = scenario("S09").steps.map(({ response }) => response.candidateFacts[0]);
  assert.deepEqual(conflicts.map(({ measurement }) => measurement.value), [35, 55]);
  assert.equal(conflicts[0].subject.name, conflicts[1].subject.name);
  assert.notDeepEqual(conflicts[0].subject.externalIdentifiers, conflicts[1].subject.externalIdentifiers);
  const cycle = scenario("S18").steps[0].response.candidateFacts;
  assert.equal(cycle[0].subject.name, cycle[1].object.name);
  assert.equal(cycle[0].object.name, cycle[1].subject.name);
  const duplicates = scenario("S19").steps.map(({ response }) => response.candidateFacts[0]);
  assert.equal(duplicates.length, 2);
  assert.notEqual(duplicates[0].factId, duplicates[1].factId);
});

test("fact-level evidence subsets stay distinct from operation-level material", () => {
  const response = scenario("S03").steps[0].response;
  assert.equal(response.operationEvidenceReferences.length, 3);
  assert.deepEqual(response.candidateFacts.map((fact) => fact.evidenceReferences.length), [1, 1]);
  const operationOnlyId = response.operationEvidenceReferences[2].referenceId;
  assert.equal(
    response.candidateFacts.some((fact) => fact.evidenceReferences.some(({ referenceId }) => referenceId === operationOnlyId)),
    false,
  );
});

test("NO_DATA and operational failures remain exact and fabricate no negative candidates", () => {
  assert.equal(scenario("S06").steps[0].response.outcome.state, "NO_DATA");
  assert.deepEqual(scenario("S06").steps[0].response.candidateFacts, []);
  assert.deepEqual(scenario("S07").steps.map(({ response }) => response.outcome.state), ["UNAVAILABLE", "FAILED"]);
  assert.equal(scenario("S07").steps.every(({ response }) => response.candidateFacts.length === 0), true);
  assert.equal(scenario("S13").steps[0].response.outcome.state, "FAILED");
  assert.deepEqual(scenario("S13").steps[0].response.candidateFacts, []);
});

test("candidate identities support new, canonical, and same-name distinct references", () => {
  const newPerson = scenario("S01").steps[0].response.candidateFacts[0].subject;
  const knownPerson = scenario("P06").steps[0].response.candidateFacts[0].subject;
  const sameNames = scenario("S09").steps.map(({ response }) => response.candidateFacts[0].subject);
  assert.equal(newPerson.entityId, undefined);
  assert.equal(knownPerson.entityId, "entity-known-person");
  assert.equal(sameNames[0].name, sameNames[1].name);
  assert.notDeepEqual(sameNames[0].externalIdentifiers, sameNames[1].externalIdentifiers);
});

test("trust and listed/out-of-scope contexts are representable without routing", () => {
  assert.deepEqual(
    scenario("S17").steps[0].response.candidateFacts.map(({ relationship }) => relationship),
    ["TRUST_OWNERSHIP", "SETTLOR", "TRUSTEE"],
  );
  assert.equal(scenario("S17").context.specialStructure, "TRUST");
  assert.equal(policyPack.applicability.outOfScopeRoutes.listed_company.route, "listed_entity_policy");
  assert.equal(scenario("S20").context.entityProfile, "LISTED_COMPANY");
  assert.equal(scenario("S20").steps[0].response.outcome.state, "UNSUPPORTED");
});

test("future reasoning is metadata only and no scenario contains executed decision outputs", () => {
  const forbiddenKeys = new Set([
    "uboStatus", "pscStatus", "controllerStatus", "requirementState", "informationNeedsProduced",
    "gaps", "customerActions", "fallbackEligible", "terminalOutcome", "effectiveOwnership",
  ]);
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value === null || typeof value !== "object") return;
    Object.entries(value).forEach(([key, item]) => {
      assert.equal(forbiddenKeys.has(key), false, `forbidden executed output ${key}`);
      walk(item);
    });
  }
  walk(allScenarios);
  allScenarios.flatMap(({ futureExpectations }) => futureExpectations)
    .forEach(({ status }) => assert.equal(status, FUTURE_EXPECTATION_STATUS));
});

test("policy linkage preserves semantic IDs and unresolved source references", () => {
  const knownRequirements = new Set(policyPack.requirements.map(({ requirementId }) => requirementId));
  const knownActions = new Set(Object.keys(policyPack.actionTemplates));
  const knownEvidence = new Set(policyPack.evidenceCatalogue.items.map(({ key }) => key));
  allScenarios.forEach(({ policyLinks }) => {
    policyLinks.requirementIds.forEach((id) => assert.equal(knownRequirements.has(id), true));
    policyLinks.actionTemplateIds.forEach((id) => {
      assert.equal(knownActions.has(id), true);
      assert.doesNotMatch(id, /^B\d+$/);
    });
    policyLinks.evidenceCatalogueKeys.forEach((id) => assert.equal(knownEvidence.has(id), true));
  });
  assert.deepEqual(
    policyPack.sourceTraceability.unresolvedActionTemplateSourceReferences
      .map(({ sourceReference }) => sourceReference).sort(),
    ["B1", "B1", "B2", "B4"],
  );
  assert.deepEqual(
    policyPack.sourceTraceability.unresolvedLifecycleEventSourceReferences
      .map(({ sourceReference }) => sourceReference).sort(),
    ["E01", "E02", "E08", "E10"],
  );
});

test("fixture corruption fails through production contract validators", () => {
  const corruptions = [
    (fixture) => { delete fixture.steps[0].request.caseId; },
    (fixture) => { fixture.steps[0].response.outcome.state = "NO_DATA"; },
    (fixture) => { fixture.steps[0].response.candidateFacts[0].relationship = "SHARES"; },
    (fixture) => { fixture.steps[0].response.candidateFacts[0].subject = { externalIdentifiers: [] }; },
    (fixture) => { fixture.steps[0].response.candidateFacts[0].measurement.value = 101; },
    (fixture) => { delete fixture.steps[0].response.candidateFacts[0].evidenceReferences[0].system; },
  ];
  corruptions.forEach((corrupt) => {
    const fixture = clone("S01");
    corrupt(fixture);
    assert.throws(() => validateScenario(fixture, policyPack), UboContractError);
  });
});

test("scenario validation rejects unknown policy links and unlabelled future behavior", () => {
  const corruptions = [
    (fixture) => { fixture.policyLinks.requirementIds[0] = "UBO-R99"; },
    (fixture) => { fixture.policyLinks.actionTemplateIds[0] = "B1"; },
    (fixture) => { fixture.policyLinks.evidenceCatalogueKeys[0] = "invented_evidence"; },
    (fixture) => { fixture.steps[0].request.informationNeeds[0].policyRequirementId = "UBO-R02"; },
    (fixture) => { fixture.steps[0].response.candidateFacts[0].evidenceReferences[0].locator.catalogueKey = "foreign_registry_extract"; },
    (fixture) => { fixture.futureExpectations[0].status = "EXECUTED"; },
  ];
  corruptions.forEach((corrupt) => {
    const fixture = clone("S01");
    corrupt(fixture);
    assert.throws(() => validateScenario(fixture, policyPack), UboContractError);
  });

  const duplicateCorpus = [clone("S01"), clone("S01")];
  assert.throws(() => validateScenarioCorpus(duplicateCorpus, policyPack), UboContractError);
});

test("the whole corpus runs offline with no legacy, Evidence, onboarding, or real provider service", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("network access is forbidden in G1.2B scenarios"); };
  try {
    for (const fixture of allScenarios) await runScenario(fixture, policyPack);
  } finally {
    global.fetch = originalFetch;
  }
});
