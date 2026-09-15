"use strict";

const legacyDiscoveryHandler = require("./ubo-discovery");
const {
  applyCustomerAction,
  applyReviewerDecisions,
  compareSnapshotEntries,
  createDiscoveryReplayRecord,
  fixtureCatalogue,
  startFixture,
  startLive,
  startReplay,
  validateDiscoveryReplayRecord,
} = require("../ubo-control-lab/server/labEngine");
const {
  applyReviewDecisions,
  catalogue: reviewCatalogue,
  changeReviewProfile,
  normalizedFixtureInput,
  startDemoCalculationFixture,
  startReviewFixture,
  startReviewReplay,
} = require("../ubo-control-lab/server/reviewLabEngine");
const {
  applyApplicantCustomerAction,
  applyApplicantDecisions,
  catalogue: applicantCatalogue,
  completeApplicantFixtureReviewAndAdvance,
  evaluateApplicantJourney,
  resumeApplicantAdvance,
  startApplicantFixture,
  submitApplicantActionAndAdvance,
  validateSession: validateApplicantSession,
} = require("../ubo-control-lab/server/applicantJourneyLab");
const {
  applyDatedCertificationReview,
  applyPreconfiguredFixtureDecisions,
  startPreingestedEvidenceDemo,
  usePreingestedBettercommsArtifact,
  validateSession: validatePreingestedEvidenceSession,
} = require("../ubo-control-lab/server/preingestedEvidenceDemo");
const { autoReviewDemoReplaySession, autoReviewDemoSession, prepareDemoLiveDiscoveryBody, prepareDemoReplayRecord } = require("../ubo-control-lab/server/demoAutoReview");

const OPERATIONS = Object.freeze({
  FIXTURE_CATALOGUE: "FIXTURE_CATALOGUE",
  START_FIXTURE: "START_FIXTURE",
  START_LIVE: "START_LIVE",
  START_REPLAY: "START_REPLAY",
  APPLY_REVIEWER_DECISIONS: "APPLY_REVIEWER_DECISIONS",
  APPLY_CUSTOMER_ACTION: "APPLY_CUSTOMER_ACTION",
  COMPARE_SNAPSHOTS: "COMPARE_SNAPSHOTS",
  START_REVIEW_FIXTURE: "START_REVIEW_FIXTURE",
  START_REVIEW_LIVE: "START_REVIEW_LIVE",
  START_DEMO_REVIEW_LIVE: "START_DEMO_REVIEW_LIVE",
  START_DEMO_REVIEW_REPLAY: "START_DEMO_REVIEW_REPLAY",
  START_DEMO_CALCULATION_FIXTURE: "START_DEMO_CALCULATION_FIXTURE",
  START_REVIEW_REPLAY: "START_REVIEW_REPLAY",
  APPLY_REVIEW_DECISIONS: "APPLY_REVIEW_DECISIONS",
  CHANGE_REVIEW_PROFILE: "CHANGE_REVIEW_PROFILE",
  REVIEW_COMPARISON: "REVIEW_COMPARISON",
  START_APPLICANT_FIXTURE: "START_APPLICANT_FIXTURE",
  APPLY_APPLICANT_CUSTOMER_ACTION: "APPLY_APPLICANT_CUSTOMER_ACTION",
  APPLY_APPLICANT_DECISIONS: "APPLY_APPLICANT_DECISIONS",
  EVALUATE_APPLICANT_JOURNEY: "EVALUATE_APPLICANT_JOURNEY",
  SUBMIT_APPLICANT_ACTION_AND_ADVANCE: "SUBMIT_APPLICANT_ACTION_AND_ADVANCE",
  RESUME_APPLICANT_ADVANCE: "RESUME_APPLICANT_ADVANCE",
  COMPLETE_APPLICANT_FIXTURE_REVIEW: "COMPLETE_APPLICANT_FIXTURE_REVIEW",
  VALIDATE_APPLICANT_SESSION: "VALIDATE_APPLICANT_SESSION",
  START_PREINGESTED_EVIDENCE_DEMO: "START_PREINGESTED_EVIDENCE_DEMO",
  USE_PREINGESTED_BETTERCOMMS_ARTIFACT: "USE_PREINGESTED_BETTERCOMMS_ARTIFACT",
  APPLY_PREINGESTED_FIXTURE_DECISIONS: "APPLY_PREINGESTED_FIXTURE_DECISIONS",
  APPLY_DATED_CERTIFICATION_REVIEW: "APPLY_DATED_CERTIFICATION_REVIEW",
  VALIDATE_PREINGESTED_EVIDENCE_SESSION: "VALIDATE_PREINGESTED_EVIDENCE_SESSION",
});

function explicitlyReviewBaseline(session) {
  if (!session.decisionTargets.candidateParties.length && !session.decisionTargets.candidateClaims.length) return session;
  return applyReviewerDecisions({
    session,
    identityDecisions: session.decisionTargets.candidateParties.map(({ candidatePartyKey }) => ({ candidatePartyKey, action: "REGISTER_NEW" })),
    claimDecisions: session.decisionTargets.candidateClaims.map(({ claimId }) => ({ claimId, resultingState: "OPERATIVE", supersededByClaimIds: [], adversarialClaimIds: [] })),
  });
}

function comparisonSummary(baseline, successor) {
  const baselineView = baseline.snapshots.at(-1)?.view;
  const successorView = successor.snapshots.at(-1)?.view;
  if (!baselineView || !successorView) return null;
  return {
    contractVersion: "ubo-control-lab-policy-comparison-v1",
    sourceInvariant: "SAME_NORMALIZED_CANDIDATE_FACTS_NO_SECOND_SEARCH",
    definitionsDiffer: true,
    baseline: {
      policyVersion: baselineView.snapshot.decisionContent.policy.identity.policyVersion,
      snapshotVersion: baselineView.diagnostics.snapshotContractVersion,
      graphAlgorithm: baselineView.graph.contractVersion,
      openInformationNeedsV1: baselineView.resolutionExplanation.openInformationNeeds,
      projectedUnresolvedRowsV1: baselineView.graph.unresolved.length,
      planState: baselineView.plan.state,
      actionCount: baselineView.plan.recommendedWave.actions.length,
      snapshotId: baselineView.snapshot.snapshotId,
    },
    successor: {
      policyVersion: successorView.snapshot.decisionContent.policy.identity.policyVersion,
      snapshotVersion: successorView.snapshot.snapshotSchemaVersion,
      graphAlgorithm: successorView.graph.contractVersion,
      openCausalNeedsV2: successorView.counts.openCausalNeeds,
      affectedDiagnosticsV2: successorView.affectedDiagnostics.length,
      planState: successorView.plan.state,
      actionCount: successorView.plan.recommendedActions.length,
      snapshotId: successorView.snapshot.snapshotId,
      governanceState: successorView.governance.readiness,
    },
    explanation: "Baseline v1 InformationNeeds and projected unresolved rows are not the same metric as successor v2 causal needs and dependent diagnostics.",
  };
}

function invokeLegacyDiscovery(body) {
  return new Promise((resolve, reject) => {
    const request = { method: "POST", body, headers: { accept: "application/json" } };
    let statusCode = 200;
    const response = {
      status(code) { statusCode = code; return this; },
      setHeader() { return this; },
      json(payload) { resolve({ status: statusCode, body: payload }); return this; },
      end(payload) {
        if (!payload) resolve({ status: statusCode, body: null });
        else {
          try { resolve({ status: statusCode, body: JSON.parse(payload) }); }
          catch { resolve({ status: statusCode, body: payload }); }
        }
        return this;
      },
      write() { return true; },
    };
    Promise.resolve(legacyDiscoveryHandler(request, response)).catch(reject);
  });
}

function send(res, status, payload) {
  res.status(status);
  res.setHeader("Cache-Control", "no-store");
  return res.json(payload);
}

async function startSuccessorLive(payload, { demoProfileReconciliation = false, prepareDiscoveryBody = (body) => body } = {}) {
  const baseline = await startLive({
    ...payload,
    transport: { invoke: ({ body }) => invokeLegacyDiscovery(prepareDiscoveryBody(body)) },
  });
  const prepared = demoProfileReconciliation
    ? prepareDemoReplayRecord(baseline.replayCapture)
    : { replayRecord: baseline.replayCapture, reconciliation: null };
  const successor = startReviewReplay({ replayRecord: prepared.replayRecord, profileId: payload?.profileId || "NOT_PROVIDED" });
  successor.sourceState = "LIVE";
  successor.sourceLabel = `Live Discovery · ${successor.companyContext.legalEntityName}`;
  successor.replayCapture = baseline.replayCapture;
  if (prepared.reconciliation) successor.demoProfileReconciliation = prepared.reconciliation;
  return successor;
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") return send(res, 200, {
    ...fixtureCatalogue(),
    review: reviewCatalogue(),
    applicant: applicantCatalogue(),
    preingestedEvidence: {
      fixtureId: "AJV2-EVIDENCE-01",
      label: "BETTERCOMMS — PRE-INGESTED OWNERSHIP CHART",
      productionAuthorized: false,
    },
  });
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const input = req.body || {};
    switch (input.operation) {
      case OPERATIONS.FIXTURE_CATALOGUE:
        return send(res, 200, fixtureCatalogue());
      case OPERATIONS.START_FIXTURE:
        return send(res, 200, startFixture(input.payload));
      case OPERATIONS.START_LIVE:
        return send(res, 200, await startLive({
          ...input.payload,
          transport: { invoke: ({ body }) => invokeLegacyDiscovery(body) },
        }));
      case OPERATIONS.START_REPLAY:
        return send(res, 200, startReplay(input.payload));
      case OPERATIONS.APPLY_REVIEWER_DECISIONS:
        return send(res, 200, applyReviewerDecisions(input.payload));
      case OPERATIONS.APPLY_CUSTOMER_ACTION:
        return send(res, 200, applyCustomerAction(input.payload));
      case OPERATIONS.COMPARE_SNAPSHOTS:
        return send(res, 200, compareSnapshotEntries(input.payload?.left, input.payload?.right));
      case OPERATIONS.START_REVIEW_FIXTURE:
        return send(res, 200, startReviewFixture(input.payload));
      case OPERATIONS.START_REVIEW_REPLAY:
        return send(res, 200, startReviewReplay(input.payload));
      case OPERATIONS.START_DEMO_REVIEW_REPLAY: {
        const validated = validateDiscoveryReplayRecord(input.payload?.replayRecord);
        const prepared = prepareDemoReplayRecord(validated);
        const replay = startReviewReplay({ ...input.payload, replayRecord: prepared.replayRecord });
        replay.demoProfileReconciliation = prepared.reconciliation;
        return send(res, 200, autoReviewDemoReplaySession(replay));
      }
      case OPERATIONS.START_REVIEW_LIVE: {
        return send(res, 200, await startSuccessorLive(input.payload));
      }
      case OPERATIONS.START_DEMO_REVIEW_LIVE:
        return send(res, 200, autoReviewDemoSession(await startSuccessorLive(input.payload, {
          demoProfileReconciliation: true,
          prepareDiscoveryBody: prepareDemoLiveDiscoveryBody,
        })));
      case OPERATIONS.START_DEMO_CALCULATION_FIXTURE:
        return send(res, 200, startDemoCalculationFixture(input.payload));
      case OPERATIONS.APPLY_REVIEW_DECISIONS:
        return send(res, 200, applyReviewDecisions(input.payload));
      case OPERATIONS.CHANGE_REVIEW_PROFILE:
        return send(res, 200, changeReviewProfile(input.payload));
      case OPERATIONS.REVIEW_COMPARISON: {
        const normalized = normalizedFixtureInput(input.payload);
        const replayRecord = createDiscoveryReplayRecord(normalized);
        const baseline = explicitlyReviewBaseline(startReplay({ replayRecord }));
        const successor = startReviewFixture(input.payload);
        return send(res, 200, comparisonSummary(baseline, successor));
      }
      case OPERATIONS.START_APPLICANT_FIXTURE:
        return send(res, 200, startApplicantFixture(input.payload));
      case OPERATIONS.APPLY_APPLICANT_CUSTOMER_ACTION:
        return send(res, 200, applyApplicantCustomerAction(input.payload));
      case OPERATIONS.APPLY_APPLICANT_DECISIONS:
        return send(res, 200, applyApplicantDecisions(input.payload));
      case OPERATIONS.EVALUATE_APPLICANT_JOURNEY:
        return send(res, 200, evaluateApplicantJourney(input.payload));
      case OPERATIONS.SUBMIT_APPLICANT_ACTION_AND_ADVANCE:
        return send(res, 200, submitApplicantActionAndAdvance(input.payload));
      case OPERATIONS.RESUME_APPLICANT_ADVANCE:
        return send(res, 200, resumeApplicantAdvance(input.payload));
      case OPERATIONS.COMPLETE_APPLICANT_FIXTURE_REVIEW:
        return send(res, 200, completeApplicantFixtureReviewAndAdvance(input.payload));
      case OPERATIONS.VALIDATE_APPLICANT_SESSION:
        return send(res, 200, validateApplicantSession(input.payload?.session));
      case OPERATIONS.START_PREINGESTED_EVIDENCE_DEMO:
        return send(res, 200, startPreingestedEvidenceDemo(input.payload));
      case OPERATIONS.USE_PREINGESTED_BETTERCOMMS_ARTIFACT:
        return send(res, 200, await usePreingestedBettercommsArtifact(input.payload));
      case OPERATIONS.APPLY_PREINGESTED_FIXTURE_DECISIONS:
        return send(res, 200, applyPreconfiguredFixtureDecisions(input.payload));
      case OPERATIONS.APPLY_DATED_CERTIFICATION_REVIEW:
        return send(res, 200, applyDatedCertificationReview(input.payload));
      case OPERATIONS.VALIDATE_PREINGESTED_EVIDENCE_SESSION:
        return send(res, 200, validatePreingestedEvidenceSession(input.payload?.session));
      default:
        return send(res, 400, { error: "Unsupported Lab operation" });
    }
  } catch (error) {
    const clientError = error instanceof TypeError || String(error.code || "").startsWith("ACTION_")
      || ["INVALID_CUSTOMER_ACTION", "UNAUTHORIZED_CUSTOMER_ACTION", "STALE_CUSTOMER_ACTION"].includes(error.code);
    return send(res, clientError ? 400 : 500, {
      error: clientError ? "Lab request rejected" : "UBO Control Lab operation failed",
      code: error.code || null,
      message: clientError ? error.message : "The operation could not be completed safely.",
    });
  }
};

module.exports.OPERATIONS = OPERATIONS;
