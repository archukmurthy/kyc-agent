"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const POLICY = require("../../../../ubo-control/policies/uk-corporate/1.6-rc/policy.json");
const {
  DECISION_APPLICATION_CONTRACT_VERSION_V3,
  createUboDecisionApplication,
} = require("../../../../ubo-control");
const {
  ISSUE_CLASS,
  SOURCE_MODE,
  createAdaptiveJourneyCoordinator,
} = require("..");
const { startAdaptiveJourney, applyAdaptiveFixtureReview } = require("../../../../ubo-control-lab/server/adaptiveJourneyLab");

const AT = "2026-09-14T12:00:00.000Z";

function application() {
  return createUboDecisionApplication({ policyPack: POLICY, contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3 });
}

function caseInput(suffix) {
  return {
    caseInput: {
      caseId: `uaj-coordinator-${suffix}`,
      subjectReference: { entityId: `uaj-subject-${suffix}`, name: "Coordinator Test Ltd", entityType: "COMPANY", jurisdiction: "GB", externalIdentifiers: [] },
      externalReferences: [],
      createdAt: AT,
    },
    caseContext: { entityType: "private_limited_company", entityProfile: "COMPANY", subjectEntityId: `uaj-subject-${suffix}`, jurisdiction: "GB", riskLevel: "LOW" },
    sourceMode: SOURCE_MODE.SOURCE_REVIEWED_FIXTURE,
    sourceIdentity: { fixtureId: suffix },
    operationId: `uaj-coordinator-${suffix}:discovery`,
    startedAt: AT,
  };
}

function coordinatorWithOutcome(state) {
  return createAdaptiveJourneyCoordinator({
    decisionApplication: application(),
    discoveryService: { async discover(request) {
      return { contractVersion: "1.0.0", requestId: request.requestId, outcome: { state }, candidateFacts: [], operationEvidenceReferences: [], issues: [] };
    } },
    clock: () => new Date(AT),
  });
}

test("coordinator imports UBO only through its public entry and contains no planner, graph or browser reasoning", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../index.js"), "utf8");
  const uboImports = [...source.matchAll(/require\(["']([^"']*ubo-control[^"']*)["']\)/g)].map((match) => match[1]);
  assert.deepEqual(uboImports, ["../../../ubo-control"]);
  assert.doesNotMatch(source, /ubo-control\/(?:application|domain|planning|projection|policy|calculation)\//);
  assert.doesNotMatch(source, /React|document\.|window\.|fetch\s*\(|entity_dossiers|journey_state/);
  assert.doesNotMatch(source, /buildCanonicalOwnershipGraph|calculateEffectivePercentage|determineUbo/);
});

test("UNAVAILABLE remains an operational limitation and never becomes no-owner or case complete", async () => {
  const session = await coordinatorWithOutcome("UNAVAILABLE").startCase(caseInput("unavailable"));
  assert.equal(session.sourceRecords[0].capabilityResult.outcome.state, "UNAVAILABLE");
  assert.equal(session.adaptiveView.issueClasses.some(({ issueClass }) => issueClass === ISSUE_CLASS.OPERATIONAL_FAILURE), true);
  assert.notEqual(session.adaptiveView.finalCaseComplete, true);
  assert.equal(session.operationTrace.filter(({ eventType }) => eventType === "INITIAL_RESEARCH_COMPLETED").length, 1);
});

test("PARTIAL empty output remains extraction uncertainty rather than an ownership conclusion", async () => {
  const session = await coordinatorWithOutcome("PARTIAL").startCase(caseInput("partial"));
  assert.equal(session.adaptiveView.issueClasses.some(({ issueClass }) => issueClass === ISSUE_CLASS.EXTRACTION_UNCERTAINTY), true);
  assert.notEqual(session.adaptiveView.finalCaseComplete, true);
});

test("decision executor rejects automatic adjudication in UAJ-01 even when shadow prerequisites are inspected", async () => {
  const started = await startAdaptiveJourney({ scenarioId: "UAJ-01-HYBRID-ANSWER", company: { name: "Decision Seam Ltd", country: "GB", registrationNumber: "UAJ00101" } });
  const coordinator = createAdaptiveJourneyCoordinator({
    decisionApplication: application(),
    discoveryService: { async discover() { throw new Error("not called"); } },
    clock: () => new Date(AT),
  });
  assert.throws(() => coordinator.applyDecisions({ session: started, executionContext: { mode: "AUTOMATED" } }), /explicit review only/);
  assert.equal(started.shadowAutoEligibility.adjudicationPerformed, false);
});

test("one routine LOW-risk exception round is allowed and a second needs a recorded escalation reason", async () => {
  const started = await startAdaptiveJourney({ scenarioId: "UAJ-01-HYBRID-ANSWER", company: { name: "Round Test Ltd", country: "GB", registrationNumber: "UAJ00102" } });
  const ready = applyAdaptiveFixtureReview({ session: started });
  const coordinator = createAdaptiveJourneyCoordinator({
    decisionApplication: application(),
    discoveryService: { async discover() { throw new Error("not called"); } },
    clock: () => new Date(AT),
  });
  const bundleIds = ready.snapshots.at(-1).journey.customerWorkBundles.map(({ bundleId }) => bundleId);
  const roundOne = coordinator.publishExceptionRound({ session: ready, bundleIds, publishedAt: AT });
  assert.equal(roundOne.exceptionRounds[0].materialInputFingerprint, ready.snapshots.at(-1).plan.materialInputFingerprint);
  assert.throws(() => coordinator.publishExceptionRound({ session: roundOne, bundleIds, publishedAt: AT }), /second LOW\/MEDIUM exception round/);
  const escalated = coordinator.publishExceptionRound({ session: roundOne, bundleIds, publishedAt: AT, escalationReason: "Late material contradiction" });
  assert.equal(escalated.exceptionRounds.length, 2);
  assert.equal(escalated.exceptionRounds[1].escalationReason, "Late material contradiction");
});
