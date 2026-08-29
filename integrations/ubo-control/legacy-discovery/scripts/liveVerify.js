"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  CAPABILITY_CONTRACT_VERSION,
  DECISION_APPLICATION_CONTRACT_VERSION,
} = require("../../../../ubo-control");
const { createLegacyDiscoveryComposition } = require("..");

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === "") throw new Error(`${name} is required for opt-in live verification`);
  return value.trim();
}

function optional(name, fallback) {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new Error(`${label} could not be read as JSON`, { cause: error });
  }
}

function subjectFromEnvironment() {
  const registrationNumber = optional("UBO_LIVE_REGISTRATION_NUMBER", undefined);
  return {
    entityId: optional("UBO_LIVE_SUBJECT_ENTITY_ID", "live-subject"),
    name: required("UBO_LIVE_ENTITY_NAME"),
    entityType: optional("UBO_LIVE_ENTITY_TYPE", "COMPANY"),
    jurisdiction: optional("UBO_LIVE_JURISDICTION", "GB").toUpperCase(),
    externalIdentifiers: registrationNumber
      ? [{ namespace: "GB_COMPANIES_HOUSE", value: registrationNumber }]
      : [],
  };
}

function decisionTargetSummary(decisionTargets) {
  return {
    candidateParties: decisionTargets.candidateParties.map((target) => ({
      candidatePartyKey: target.candidatePartyKey,
      claimId: target.claimId,
      endpoint: target.endpoint,
      assertedName: target.party.name,
      entityType: target.party.entityType,
      jurisdiction: target.party.jurisdiction,
      externalIdentifiers: target.party.externalIdentifiers || [],
    })),
    candidateClaims: decisionTargets.candidateClaims.map((target) => ({
      claimId: target.claimId,
      claimType: target.claimType,
      relationship: target.relationship,
      currentState: target.currentState,
    })),
  };
}

function verificationReport(subject, capabilityResult, plan, snapshot) {
  const content = snapshot.decisionContent;
  return {
    verification: "LIVE_LEGACY_TO_FRESH_UBO_CONTROL",
    subject: {
      name: subject.name,
      jurisdiction: subject.jurisdiction,
      registrationNumber: subject.externalIdentifiers[0]?.value,
    },
    discovery: {
      outcome: capabilityResult.outcome,
      candidateFactCount: capabilityResult.candidateFacts.length,
      candidateFactTypes: capabilityResult.candidateFacts.map(({ type, relationship, measurement }) => ({
        type,
        relationship,
        measurementType: measurement?.type,
      })),
      issueCodes: capabilityResult.issues.map(({ code }) => code),
    },
    explicitHarnessDecisions: {
      entityRegistrations: plan.entityRegistrations.length,
      identityDecisions: plan.identityDecisions.length,
      claimAdjudications: plan.claimAdjudications.length,
    },
    freshEngine: {
      algorithms: content.algorithms,
      graphFingerprint: content.reasoning.graph.graphVersion,
      calculatedInterests: content.reasoning.calculations.map((calculation) => ({
        subjectEntityId: calculation.subjectEntityId,
        targetEntityId: calculation.targetEntityId,
        dimension: calculation.dimension,
        status: calculation.status,
        aggregateKnownValue: calculation.aggregateKnownValue,
      })),
      qualifyingPersons: content.decision.qualifyingPersons,
      unresolvedInformationNeeds: content.decision.informationNeeds.map(({ needId, concept, state, reasonCodes }) => ({
        needId,
        concept,
        state,
        reasonCodes,
      })),
      terminal: content.decision.terminal,
      customerProjection: content.decision.customerProjection,
      policyIdentity: content.policy.identity,
      decisionSnapshotHash: snapshot.snapshotId,
    },
  };
}

async function main() {
  const baseUrl = required("UBO_LEGACY_BASE_URL");
  const policyPack = readJson(required("UBO_POLICY_PACK_PATH"), "UBO_POLICY_PACK_PATH");
  const subject = subjectFromEnvironment();
  const caseId = optional("UBO_LIVE_CASE_ID", `g32-live-${Date.now()}`);
  const requestId = `${caseId}:discovery`;
  const operationId = `${caseId}:operation`;
  const recordedAt = optional("UBO_LIVE_RECORDED_AT", new Date().toISOString());
  const composition = createLegacyDiscoveryComposition({ baseUrl, policyPack });
  const capabilityResult = await composition.discoveryService.discover({
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId,
    caseId,
    informationNeeds: [{ needId: "live-current-structure", concepts: ["CURRENT_OWNERSHIP_AND_CONTROL"] }],
    subject,
  });
  const intake = composition.decisionApplication.intake({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseInput: {
      caseId,
      subjectReference: subject,
      externalReferences: [{ system: "g32-live-verification", referenceId: caseId }],
      createdAt: recordedAt,
    },
    capabilityResult,
    operationId,
    recordedAt,
  });

  const decisionPlanPath = process.env.UBO_LIVE_DECISION_PLAN_PATH;
  if (!decisionPlanPath) {
    process.stdout.write(`${JSON.stringify({
      verification: "LIVE_DISCOVERY_COMPLETE_DECISIONS_REQUIRED",
      subject: { name: subject.name, jurisdiction: subject.jurisdiction },
      discoveryOutcome: capabilityResult.outcome,
      candidateFactCount: capabilityResult.candidateFacts.length,
      decisionTargets: decisionTargetSummary(intake.decisionTargets),
      nextStep: "Review these stable targets and rerun with UBO_LIVE_DECISION_PLAN_PATH.",
    }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  const plan = readJson(decisionPlanPath, "UBO_LIVE_DECISION_PLAN_PATH");
  const applied = composition.decisionApplication.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseState: intake.caseState,
    entityRegistrations: plan.entityRegistrations,
    identityDecisions: plan.identityDecisions,
    claimAdjudications: plan.claimAdjudications,
  });
  const evaluationTime = optional("UBO_LIVE_EVALUATION_TIME", recordedAt);
  const evaluation = composition.decisionApplication.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseState: applied.caseState,
    caseContext: {
      entityType: optional("UBO_LIVE_POLICY_ENTITY_TYPE", "private_limited_company"),
      subjectEntityId: subject.entityId,
      jurisdiction: subject.jurisdiction,
      riskLevel: optional("UBO_LIVE_RISK_LEVEL", "LOW"),
    },
    evaluationTime,
    checkpoint: "CASE_OPEN",
    checkpointReference: { referenceId: `${caseId}:live-verification` },
    resolutionInputs: {},
  });
  process.stdout.write(`${JSON.stringify(verificationReport(subject, capabilityResult, plan, evaluation.decisionSnapshot), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    verification: "LIVE_VERIFICATION_FAILED",
    errorName: error.name,
    errorCode: error.code,
    message: error.message,
  }, null, 2)}\n`);
  process.exitCode = 1;
});
