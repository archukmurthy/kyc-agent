"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  applyAdaptiveFixtureReview,
  catalogue,
  confirmAdaptiveStructure,
  prepareAdaptiveDelegation,
  runAdaptivePermittedResearch,
  startAdaptiveJourney,
  submitAdaptiveOwnershipAnswer,
  useAdaptiveSourceReviewedArtifact,
  validateAdaptiveJourneySession,
} = require("../server/adaptiveJourneyLab");

const company = (registrationNumber) => ({ name: "Adaptive Customer Limited", country: "GB", registrationNumber });

async function reviewedSession(scenarioId, registrationNumber) {
  const started = await startAdaptiveJourney({ scenarioId, company: company(registrationNumber) });
  return { started, reviewed: applyAdaptiveFixtureReview({ session: started }) };
}

test("UAJ-01 catalogue is one connected entry point over only public UBO and Evidence boundaries", () => {
  const value = catalogue();
  assert.equal(value.entryPoint, "UNIFIED_JOURNEY");
  assert.equal(value.fixtures.length, 5);
  assert.equal(value.publicBoundaries.ubo, "ubo-decision-application-v3");
  assert.equal(value.publicBoundaries.evidence, "evidence/consumer/v1/index.js");
  assert.equal(value.productionAuthorized, false);
});

test("connected product shell exposes one company entry, separate applicant/analyst views and no engine checkpoints", () => {
  const browser = fs.readFileSync(path.resolve(__dirname, "../browser/lab.js"), "utf8");
  const index = fs.readFileSync(path.resolve(__dirname, "../browser/index.html"), "utf8");
  assert.match(browser, /UNIFIED JOURNEY — UAJ-01/);
  assert.match(browser, /One company\. One evolving ownership case\./);
  assert.match(browser, /\["APPLICANT", "ANALYST", "HISTORY", "ADVANCED_DIAGNOSTICS"\]/);
  assert.match(browser, /No applicant task while a decision is required/i);
  assert.match(browser, /Durable Confirmed Ownership Statement contract: pending/);
  assert.match(browser, /DATA-ONLY HOST HANDOFF · NO INVITATION SENT/);
  assert.doesNotMatch(browser.slice(browser.indexOf("function AdaptiveJourneyWorkspace"), browser.indexOf("function ReviewWorkspace")), /Re-evaluate ownership case|Record decision checkpoint/);
  assert.match(index, /adaptiveJourneySessionStore\.js/);
  assert.match(index, /adaptive-journey\.css/);
});

test("one entry point derives a named HoldCo gap from researched 10% and 30% facts", async () => {
  const { started, reviewed: session } = await reviewedSession("UAJ-01-HYBRID-ANSWER", "UAJ00001");
  assert.equal(started.phase, "EXPLICIT_REVIEW_REQUIRED");
  assert.equal(started.snapshots.length, 0);
  assert.equal(session.adaptiveView.path, "NAMED_GAP");
  assert.deepEqual(session.adaptiveView.currentTask.canonicalSubject.entityIds, ["uaj-overseas-holdco"]);
  assert.equal(session.sourceRecords[0].capabilityResult.candidateFacts.length, 2);
  assert.equal(session.shadowAutoEligibility.adjudicationPerformed, false);
});

test("a newly revealed accessible HoldCo triggers only the pinned bounded research operation", async () => {
  const { reviewed } = await reviewedSession("UAJ-01-BOUNDED-RESEARCH", "UAJ00005");
  assert.equal(reviewed.snapshots.at(-1).plan.state, "SYSTEM_RESOLUTION");
  assert.equal(reviewed.executionBudget.maxConcurrency, 1);
  const researched = await runAdaptivePermittedResearch({ session: reviewed });
  assert.equal(researched.executionBudget.usedCalls, 2, "one initial and one bounded follow-up call");
  assert.equal(researched.sourceRecords.length, 2);
  assert.equal(researched.sourceRecords[1].capability, "TARGETED_DISCOVERY");
  assert.equal(researched.sourceRecords[1].request.subject.entityId, "uaj-overseas-holdco");
  assert.deepEqual(researched.sourceRecords[1].capabilityResult.candidateFacts.map(({ factId }) => factId), ["uaj-research-alice-holdco-60"]);
  assert.equal(researched.phase, "EXPLICIT_REVIEW_REQUIRED");
  const final = applyAdaptiveFixtureReview({ session: researched });
  const calculation = final.snapshots.at(-1).graph.calculations.find(({ subjectEntityId }) => subjectEntityId === "uaj-alice");
  assert.deepEqual(calculation.aggregateKnownValue, { type: "EXACT", value: "28" });
  assert.equal(final.resolutionInputs.resolutionAttempts[0].capabilityOutcomeState, "COMPLETE");
});

test("hybrid structured answer stays in one case and the real engine calculates 10 + (60 × 30) = 28", async () => {
  const { reviewed } = await reviewedSession("UAJ-01-HYBRID-ANSWER", "UAJ00001");
  const caseId = reviewed.caseId;
  const snapshotA = structuredClone(reviewed.snapshots[0].snapshot);
  const submitted = submitAdaptiveOwnershipAnswer({ session: reviewed, percentage: 60 });
  assert.equal(submitted.phase, "EXPLICIT_REVIEW_REQUIRED");
  assert.equal(submitted.snapshots.length, 1);
  const final = applyAdaptiveFixtureReview({ session: submitted });
  assert.equal(final.caseId, caseId);
  assert.equal(final.snapshots.length, 2);
  assert.deepEqual(final.snapshots[0].snapshot, snapshotA);
  assert.equal(final.snapshots[1].predecessorSnapshotId, snapshotA.snapshotId);
  const calculation = final.snapshots.at(-1).graph.calculations.find(({ subjectEntityId }) => subjectEntityId === "uaj-alice");
  assert.deepEqual(calculation.aggregateKnownValue, { type: "EXACT", value: "28" });
  assert.deepEqual(calculation.knownPaths.map(({ contribution }) => contribution.value).sort(), ["10", "18"]);
  assert.equal(final.sourceRecords[0].capabilityResult.candidateFacts.length, 2, "original researched facts survive");
  assert.equal(final.adaptiveView.currentTask, null, "the resolved HoldCo percentage form does not reopen for a different concept");
  assert.equal(final.adaptiveView.path, "WAIT_REVIEW");
  assert.deepEqual(final.adaptiveView.reasonCodes, ["NO_SAFE_UAJ_01_INPUT_FORM_FOR_CURRENT_CONCEPT"]);
});

test("existing source-reviewed Artifact uses the frozen Evidence facade and reaches the same 28% result without bytes", async () => {
  const { reviewed } = await reviewedSession("UAJ-01-HYBRID-ARTIFACT", "UAJ00002");
  assert.equal(reviewed.adaptiveView.path, "NAMED_GAP");
  assert.equal(reviewed.adaptiveView.currentTask.evidenceHandoff.readiness, "EVIDENCE_HANDOFF_READY_EXECUTION_NOT_CONNECTED");
  const extracted = await useAdaptiveSourceReviewedArtifact({ session: reviewed });
  assert.equal(extracted.caseId, reviewed.caseId);
  assert.equal(extracted.phase, "EXPLICIT_REVIEW_REQUIRED");
  assert.equal(extracted.sourceRecords.at(-1).capability, "EXISTING_ARTIFACT_EXTRACTION");
  assert.equal(extracted.sourceRecords.at(-1).capabilityResult.outcome.state, "COMPLETE");
  assert.equal(extracted.evidenceHandoffs[0].rawBytesAccepted, false);
  assert.doesNotMatch(JSON.stringify(extracted), /blob:|evidenceBytes|documentContents|filePath/i);
  const final = applyAdaptiveFixtureReview({ session: extracted });
  const calculation = final.snapshots.at(-1).graph.calculations.find(({ subjectEntityId }) => subjectEntityId === "uaj-alice");
  assert.deepEqual(calculation.aggregateKnownValue, { type: "EXACT", value: "28" });
  assert.equal(final.snapshots.length, 3);
  final.snapshots.forEach((entry, index) => {
    assert.equal(entry.snapshot.snapshotId, entry.snapshot.decisionContentHash);
    if (index) assert.equal(entry.predecessorSnapshotId, final.snapshots[index - 1].snapshot.snapshotId);
  });
});

test("supported structure receives confirmation rather than an unnecessary document request and does not loop", async () => {
  const { reviewed } = await reviewedSession("UAJ-01-CONFIRM", "UAJ00003");
  assert.equal(reviewed.adaptiveView.path, "CONFIRM");
  assert.equal(reviewed.adaptiveView.confirmationStatement.durabilityStatus, "PENDING_DURABLE_CONTRACT");
  assert.equal(reviewed.adaptiveView.confirmationStatement.professionalCertification, false);
  assert.equal(reviewed.adaptiveView.currentTask.permittedSemanticActions.some(({ actionType }) => actionType === "REQUEST_EXTERNAL_EVIDENCE"), false);
  const confirmed = confirmAdaptiveStructure({ session: reviewed });
  assert.equal(confirmed.snapshots.length, 2);
  assert.equal(confirmed.snapshots.at(-1).journey.customerWorkBundles.length, 0);
  assert.equal(confirmed.customerActivity.length, 1);
  assert.notEqual(confirmed.adaptiveView.path, "CONFIRM");
});

test("supported delegation remains a scoped data-only host handoff and grants no authority or completion", async () => {
  const { reviewed } = await reviewedSession("UAJ-01-HYBRID-ANSWER", "UAJ00008");
  const delegated = prepareAdaptiveDelegation({ session: reviewed });
  assert.equal(delegated.phase, "DELEGATION_HANDOFF_PENDING");
  assert.equal(delegated.snapshots.length, reviewed.snapshots.length, "preparing a handoff does not fabricate a new decision snapshot");
  assert.equal(delegated.adaptiveView.currentTask, null);
  assert.equal(delegated.customerActivity.at(-1).status, "DELEGATION_HANDOFF_PENDING");
  const handoff = delegated.delegationHandoffs[0];
  assert.equal(handoff.delegateReference, "uaj-delegate-company-secretary");
  assert.equal(handoff.requestedWorkScope, "Current ownership of Overseas HoldCo only");
  assert.equal(handoff.authorizationGranted, false);
  assert.equal(handoff.workCompleted, false);
  assert.doesNotMatch(JSON.stringify(handoff), /email|invitation|credential|account access/i);
});

test("contradictory document remains a separate candidate and opens scoped review instead of replacing research", async () => {
  const { reviewed } = await reviewedSession("UAJ-01-CONTRADICTION", "UAJ00004");
  const beforeGraph = structuredClone(reviewed.snapshots.at(-1).graph);
  const extracted = await useAdaptiveSourceReviewedArtifact({ session: reviewed });
  const comparison = extracted.sourceComparison.find(({ result }) => result === "CONTRADICTION");
  assert.ok(comparison);
  assert.deepEqual(comparison.assertions.map(({ measurement }) => measurement.value).sort(), [40, 60]);
  const held = applyAdaptiveFixtureReview({ session: extracted });
  assert.equal(held.contradictionReview.state, "OPEN");
  assert.equal(held.contradictionReview.automaticAdjudicationPerformed, false);
  assert.deepEqual(held.snapshots.at(-1).graph, beforeGraph);
  assert.equal(held.pendingDecisionTargets.candidateClaims.length, 1);
});

test("shadow eligibility never adjudicates and A-03 remains an explicit blocker", async () => {
  const { reviewed } = await reviewedSession("UAJ-01-HYBRID-ANSWER", "UAJ00005");
  assert.equal(reviewed.shadowAutoEligibility.mode, "SHADOW_ONLY");
  assert.equal(reviewed.shadowAutoEligibility.adjudicationPerformed, false);
  assert.equal(reviewed.shadowAutoEligibility.zeroAnalystTouch, false);
  assert.equal(reviewed.shadowAutoEligibility.prerequisites.find(({ prerequisite }) => prerequisite === "A_03_EVIDENCE_SUFFICIENCY_APPROVED").passed, false);
  assert.equal(reviewed.decisionAudit.every(({ decisionExecutionMode }) => decisionExecutionMode === "EXPLICIT_REVIEW"), true);
});

test("restoring and validating the same case performs no capability operation and detects tampered history", async () => {
  const { reviewed } = await reviewedSession("UAJ-01-HYBRID-ANSWER", "UAJ00006");
  const trace = structuredClone(reviewed.operationTrace);
  const restored = validateAdaptiveJourneySession({ session: reviewed });
  assert.deepEqual(restored.operationTrace, trace);
  const tampered = structuredClone(reviewed);
  tampered.snapshots[0].predecessorSnapshotId = "fabricated";
  assert.throws(() => validateAdaptiveJourneySession({ session: tampered }), /predecessor history/);
});

test("stale structured submission cannot overwrite a newer snapshot", async () => {
  const { reviewed } = await reviewedSession("UAJ-01-HYBRID-ANSWER", "UAJ00007");
  const first = submitAdaptiveOwnershipAnswer({ session: reviewed, percentage: 60 });
  const final = applyAdaptiveFixtureReview({ session: first });
  const stale = structuredClone(final);
  stale.adaptiveView = structuredClone(reviewed.adaptiveView);
  assert.throws(() => submitAdaptiveOwnershipAnswer({ session: stale, percentage: 60 }), /pinned journey does not permit|structured ownership input/);
});
