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
} = require("../ubo-control-lab/server/labEngine");
const {
  applyReviewDecisions,
  catalogue: reviewCatalogue,
  changeReviewProfile,
  normalizedFixtureInput,
  startReviewFixture,
  startReviewReplay,
} = require("../ubo-control-lab/server/reviewLabEngine");

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
  START_REVIEW_REPLAY: "START_REVIEW_REPLAY",
  APPLY_REVIEW_DECISIONS: "APPLY_REVIEW_DECISIONS",
  CHANGE_REVIEW_PROFILE: "CHANGE_REVIEW_PROFILE",
  REVIEW_COMPARISON: "REVIEW_COMPARISON",
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

module.exports = async function handler(req, res) {
  if (req.method === "GET") return send(res, 200, { ...fixtureCatalogue(), review: reviewCatalogue() });
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
      case OPERATIONS.START_REVIEW_LIVE: {
        const baseline = await startLive({
          ...input.payload,
          transport: { invoke: ({ body }) => invokeLegacyDiscovery(body) },
        });
        const successor = startReviewReplay({ replayRecord: baseline.replayCapture, profileId: input.payload?.profileId || "NOT_PROVIDED" });
        successor.sourceState = "LIVE";
        successor.sourceLabel = `Live Discovery · ${successor.companyContext.legalEntityName}`;
        successor.replayCapture = baseline.replayCapture;
        return send(res, 200, successor);
      }
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
