"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CONSUMER_CONTRACT_VERSION,
  CONTRACT_VERSIONS,
  createEvidenceConsumer,
} = require("../../../../evidence/consumer/v1/index.js");
const {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  DECISION_APPLICATION_CONTRACT_VERSION_V3,
  RELATIONSHIP_TYPE,
  createUboDecisionApplication,
} = require("../../../../ubo-control/index.js");
const POLICY = require("../../../../ubo-control/policies/uk-corporate/1.6-rc/policy.json");
const { StubExtractionService } = require("../../../../ubo-control/test-support/scriptedStubs.js");
const { createEvidencePlatformExtractionAdapter } = require("../index.js");

const AT = "2026-09-08T10:00:00.000Z";
const IDS = Object.freeze({
  context: "70000000-0000-4000-8000-000000000001",
  subject: "70000000-0000-4000-8000-000000000002",
  asset: "70000000-0000-4000-8000-000000000003",
  artifact: "70000000-0000-4000-8000-000000000004",
  secondArtifact: "70000000-0000-4000-8000-000000000005",
  inaccessibleArtifact: "70000000-0000-4000-8000-000000000006",
});
const DIGEST = "6b3f5c40e341873a62d906718986833f32ea050c2946cfc55c6cf3c001a81983";
const AUTH = Object.freeze({
  contractVersion: CONTRACT_VERSIONS.trustedAuthorization,
  tenantId: "tenant-bettercomms",
  contextId: IDS.context,
  callerScope: "ubo:g4.1c-contract-test",
  actorType: "service",
  actorId: "trusted-composition-root",
  subjectReferenceId: IDS.subject,
});

function party(partyType, name, identifiers = []) {
  return { partyType, name, jurisdiction: "GB", identifiers };
}

function artifact(id = IDS.artifact, overrides = {}) {
  return {
    id,
    assetId: IDS.asset,
    collectionId: "g4-1c-authorized-collection",
    representationType: "original_image",
    mediaType: "image/png",
    sizeBytes: 4096,
    capturedAt: AT,
    assetTitle: "Sanitized Bettercomms ownership chart",
    evidenceType: "ownership_chart",
    accessClass: "context_restricted",
    tenantId: AUTH.tenantId,
    contextId: AUTH.contextId,
    subjectReferenceId: IDS.subject,
    subjectDisplayName: "Better Comms VOIP Ltd",
    fingerprintAlgorithm: "sha256",
    fingerprintValue: id === IDS.artifact ? DIGEST : "a".repeat(64),
    storageKey: "must-not-leak",
    ...overrides,
  };
}

function evidenceFact(runOrdinal, index, concept, subject, relationshipType, object, value, artifactId = IDS.artifact) {
  const id = `g4-1c-fact-${runOrdinal}-${index}`;
  return {
    id,
    artifactId,
    supportingArtifactIds: [artifactId],
    semanticConceptId: concept,
    value: value.kind === "EXACT" ? `${value.exact}%` : value.qualitative,
    requestRelation: "requested_concept_response",
    persistedRequestStatus: "discovered",
    groundingType: "direct",
    supportState: "supported",
    supportLocators: [{
      id: `g4-1c-locator-${runOrdinal}-${index}`,
      artifactId,
      ordinal: index,
      kind: "image",
      description: `${subject.name} ${relationshipType} ${object.name}`,
      metadata: { qualified: true, limitations: [] },
    }],
    createdAt: AT,
    typedRelationship: {
      factId: id,
      schemaVersion: "evidence-relationship-v1",
      relationshipType,
      subject,
      object,
      value,
      temporal: {
        state: "unknown",
        effectiveFrom: null,
        effectiveTo: null,
        sourceEffectiveDate: null,
        precision: {},
      },
      qualifications: relationshipType === "OFFICER_OF" ? ["ordinary_officer_title_only"] : [],
      mapping: {
        method: "deterministic_contract_fixture",
        id: "g4-1c-fixture-mapper",
        version: "1",
        reference: "g4-1c-actual-facade",
      },
      createdAt: AT,
    },
  };
}

function bettercommsResult(runOrdinal, evidenceRequest) {
  const mitchell = party("natural_person", "Mitchell Fortescue");
  const lee = party("natural_person", "Lee Taylor");
  const holdco = party("legal_entity", "Better Holdco");
  const comms = party("legal_entity", "Better Comms VOIP Ltd");
  const network = party("legal_entity", "Better Network Services");
  const exact = (value) => ({
    kind: "EXACT",
    measurementType: "percentage",
    exact: value,
    unit: "percentage_points",
  });
  const facts = [
    evidenceFact(runOrdinal, 1, "economic_ownership", mitchell, "ECONOMIC_OWNERSHIP", holdco, exact(75)),
    evidenceFact(runOrdinal, 2, "economic_ownership", lee, "ECONOMIC_OWNERSHIP", holdco, exact(25)),
    evidenceFact(runOrdinal, 3, "economic_ownership", holdco, "ECONOMIC_OWNERSHIP", comms, exact(100)),
    evidenceFact(runOrdinal, 4, "economic_ownership", holdco, "ECONOMIC_OWNERSHIP", network, exact(100)),
    evidenceFact(runOrdinal, 5, "officer_relationship", mitchell, "OFFICER_OF", holdco, {
      kind: "QUALITATIVE", measurementType: "qualitative", qualitative: "Managing Director", unit: null,
    }),
    evidenceFact(runOrdinal, 6, "officer_relationship", lee, "OFFICER_OF", holdco, {
      kind: "QUALITATIVE", measurementType: "qualitative", qualitative: "Commercial Director", unit: null,
    }),
  ];
  return {
    replayed: false,
    operation: {
      id: `g4-1c-operation-${runOrdinal}`,
      key: evidenceRequest.operationKey,
      status: "completed",
      outcome: "completed",
      startedAt: AT,
      completedAt: AT,
    },
    extractionRun: {
      id: `g4-1c-run-${runOrdinal}`,
      status: "completed",
      startedAt: AT,
      completedAt: AT,
      provider: "deterministic-contract-fake",
      model: "fixture-v1",
      instructionReference: "g4-1c-actual-facade",
    },
    evidence: {
      assetId: IDS.asset,
      artifacts: [artifact()],
      integrity: {
        verified: true,
        artifacts: [{ artifactId: IDS.artifact, verified: true, calculatedSha256: DIGEST, algorithm: "sha256" }],
      },
    },
    requestedConceptOutcomes: [
      { concept: "economic_ownership", status: "found" },
      { concept: "officer_relationship", status: "found" },
    ],
    responsiveFacts: facts,
    discoveredFacts: [],
    completeness: {
      input: { state: "complete", limitations: [] },
      extraction: { state: "complete", limitations: [] },
    },
    limitations: [],
    typedRelationshipCount: 6,
    correlation: structuredClone(evidenceRequest.correlation),
    downstreamEvaluation: "not_performed",
    providerCalled: true,
  };
}

function canonicalRequest(value) {
  return JSON.stringify({
    artifactIds: value.artifactIds,
    requestedConcepts: value.requestedConcepts,
    extractionContext: value.extractionContext,
    correlation: value.correlation,
  });
}

function actualFacadeHarness({ failureCode, mutate, extraArtifacts = [] } = {}) {
  const calls = {
    resolve: 0,
    interpret: 0,
    provider: 0,
    runs: 0,
    history: 0,
    collection: 0,
    authorizations: [],
  };
  const artifacts = new Map([
    [IDS.artifact, artifact()],
    [IDS.secondArtifact, artifact(IDS.secondArtifact)],
    [IDS.inaccessibleArtifact, artifact(IDS.inaccessibleArtifact, { contextId: "different-context" })],
    ...extraArtifacts.map((item) => [item.id, item]),
  ]);
  const operations = new Map();

  function authorize(authorization, artifactIds) {
    calls.authorizations.push(structuredClone(authorization));
    return artifactIds.map((artifactId) => {
      const item = artifacts.get(artifactId);
      if (!item) throw Object.assign(new Error("not found"), { code: "artifact_not_found" });
      if (item.tenantId !== authorization.tenantId || item.contextId !== authorization.contextId) {
        throw Object.assign(new Error("denied"), { code: "artifact_access_denied" });
      }
      return item;
    });
  }

  const interpretationService = {
    async resolve({ artifactIds }, authorization) {
      calls.resolve += 1;
      return authorize(authorization, artifactIds);
    },
    async interpret(evidenceRequest, authorization) {
      calls.interpret += 1;
      authorize(authorization, evidenceRequest.artifactIds);
      if (failureCode) throw Object.assign(new Error("private detail must not escape"), { code: failureCode });
      const fingerprint = canonicalRequest(evidenceRequest);
      const prior = operations.get(evidenceRequest.operationKey);
      if (prior && prior.fingerprint !== fingerprint) {
        throw Object.assign(new Error("changed canonical request"), { code: "idempotency_conflict" });
      }
      if (prior) return { ...structuredClone(prior.result), replayed: true, providerCalled: false };
      calls.provider += 1;
      calls.runs += 1;
      let result = bettercommsResult(calls.runs, evidenceRequest);
      if (mutate) result = mutate(result, evidenceRequest) || result;
      operations.set(evidenceRequest.operationKey, { fingerprint, result: structuredClone(result) });
      return result;
    },
    async history() {
      calls.history += 1;
      return {
        providerCalled: false,
        operations: [...operations.values()].map(({ result }) => ({
          id: result.operation.id,
          operationKey: result.operation.key,
          status: result.operation.status,
          startedAt: result.operation.startedAt,
          completedAt: result.operation.completedAt,
          result,
        })),
      };
    },
  };
  const consumer = createEvidenceConsumer({
    interpretationService,
    reconstructionService: { async reconstructEvidence() { throw new Error("not used"); } },
    packageService: {
      async listAuthorizedPackages() { throw new Error("not used"); },
      async reopenPackage() { throw new Error("not used"); },
      async verifyPackageManifest() { throw new Error("not used"); },
    },
  });
  return { calls, consumer, operations };
}

function extractionRequest(overrides = {}) {
  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: "g4-1c-request-1",
    caseId: "g4-1c-bettercomms-case",
    informationNeeds: [
      { informationNeedId: "need-economic", concepts: ["ECONOMIC_OWNERSHIP"] },
      { informationNeedId: "need-officer", concepts: ["OFFICER_RELATIONSHIP"] },
    ],
    artifactEvidenceReferences: [{
      system: "evidence-platform-v1",
      referenceType: "ARTIFACT",
      referenceId: IDS.artifact,
    }],
    ...overrides,
  };
}

function actualAdapter(harness, provider = async () => AUTH) {
  return createEvidencePlatformExtractionAdapter({
    evidenceConsumer: harness.consumer,
    trustedAuthorizationProvider: provider,
  });
}

test("G4.1C composes the actual frozen public façade without a production boundary deep import", () => {
  const testSource = fs.readFileSync(__filename, "utf8");
  const adapterSource = fs.readFileSync(path.resolve(__dirname, "../index.js"), "utf8");
  const evidenceImports = [...testSource.matchAll(/require\(["']([^"']*evidence[^"']*)["']\)/gi)]
    .map((match) => match[1]);
  assert.deepEqual(evidenceImports, ["../../../../evidence/consumer/v1/index.js"]);
  assert.match(testSource, /createEvidenceConsumer\s*\(/);
  assert.deepEqual(
    [...adapterSource.matchAll(/require\(["']([^"']*evidence[^"']*)["']\)/gi)].map((match) => match[1]),
    ["../../../evidence/consumer/v1/index.js"],
  );
  assert.doesNotMatch(adapterSource, /createEvidenceConsumer\s*\(/);
  assert.doesNotMatch(adapterSource, /repository|database|storage|api[\\/]evidence|producer|collector|onboarding/i);
  assert.doesNotThrow(() => new StubExtractionService([]));
  assert.equal(CONSUMER_CONTRACT_VERSION, "evidence-consumer-v1");
  assert.equal(typeof actualFacadeHarness().consumer.interpretArtifacts, "function");
});

test("actual façade Bettercomms vertical returns six source-backed candidates and no UBO conclusion", async () => {
  const harness = actualFacadeHarness();
  const result = await actualAdapter(harness).extract(extractionRequest());
  assert.equal(result.outcome.state, CAPABILITY_OUTCOME_STATE.PARTIAL);
  assert.equal(result.candidateFacts.length, 6);
  assert.deepEqual(result.candidateFacts.slice(0, 4).map(({ relationship }) => relationship), [
    RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
    RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
    RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
    RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
  ]);
  assert.deepEqual(result.candidateFacts.slice(0, 4).map(({ measurement }) => measurement.value), [75, 25, 100, 100]);
  const officers = result.candidateFacts.slice(4);
  assert.ok(officers.every(({ type, attribute }) =>
    type === CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE && attribute === "officer_relationship"));
  assert.deepEqual(officers.map(({ value }) => value.relationshipValue.qualitative), ["Managing Director", "Commercial Director"]);
  assert.ok(officers.every(({ value }) => value.qualifications.includes("ordinary_officer_title_only")));
  assert.equal(new Set(result.candidateFacts.map(({ factId }) => factId)).size, 6);
  assert.equal(new Set(result.candidateFacts.map(({ evidenceReferences }) => evidenceReferences[0].referenceId)).size, 1);
  assert.equal(new Set(result.candidateFacts.map(({ evidenceReferences }) =>
    evidenceReferences[0].locator.locators[0].locatorId)).size, 6);
  assert.ok(result.candidateFacts.every(({ evidenceReferences }) =>
    evidenceReferences[0].locator.extractionRunId === "g4-1c-run-1"));
  assert.ok(result.candidateFacts.every((fact) => fact.type === CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE
    ? fact.value.temporal.state === "unknown"
    : fact.qualifiers.evidenceTemporalState === "unknown"));
  const serialized = JSON.stringify(result);
  for (const forbidden of ["isUbo", "thresholdPassed", "qualifyingPerson", "operativeClaim", "policySatisfied", "customerAction", "indirectOwnership", "graphMutation", "needResolution"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.deepEqual({ provider: harness.calls.provider, runs: harness.calls.runs, collection: harness.calls.collection }, {
    provider: 1, runs: 1, collection: 0,
  });
});

test("actual adapter result fits Decision Application v3 intake without hidden evaluation", async () => {
  const capabilityResult = await actualAdapter(actualFacadeHarness()).extract(extractionRequest());
  const application = createUboDecisionApplication({
    policyPack: POLICY,
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
  });
  const intake = application.intake({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseInput: {
      caseId: "g4-1c-bettercomms-case",
      subjectReference: {
        name: "Better Comms VOIP Ltd",
        entityType: "COMPANY",
        entityId: "entity-bettercomms",
        externalIdentifiers: [],
        jurisdiction: "GB",
      },
      externalReferences: [{ system: "g4-1c-contract-test", referenceId: "g4-1c-bettercomms-case" }],
      createdAt: AT,
    },
    capabilityResult,
    operationId: "g4-1c-evidence-intake-1",
    recordedAt: AT,
  });
  assert.equal(intake.successorApplicationState.sealed, true);
  assert.equal(intake.successorApplicationState.hiddenEvaluationPerformed, false);
  assert.equal(intake.successorApplicationState.productionAuthorized, false);
  assert.equal(intake.decisionTargets.candidateClaims.length, 6);
  assert.equal(intake.decisionTargets.candidateParties.length, 10);
  assert.equal(new Set(intake.decisionTargets.candidateClaims.map(({ originatingCandidateFact }) =>
    originatingCandidateFact.candidateFactId)).size, 6);
  assert.ok(intake.decisionTargets.candidateParties.every(({ party }) =>
    party && Array.isArray(party.externalIdentifiers) && !party.entityId));
  const serialized = JSON.stringify(intake);
  for (const forbidden of ["operativeClaims", "graphMutation", "ownershipCalculation", "qualification", "informationNeedSatisfaction", "decisionSnapshot", "resolutionPlan"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
  assert.equal(typeof intake.caseState.statePayload, "string");
});

test("repeated and same-name source parties remain separate non-canonical candidate references", async () => {
  const ordinary = await actualAdapter(actualFacadeHarness()).extract(extractionRequest());
  const mitchellFacts = ordinary.candidateFacts.filter(({ subject }) => subject.name === "Mitchell Fortescue");
  assert.equal(mitchellFacts.length, 2);
  assert.ok(mitchellFacts.every(({ subject }) => !subject.entityId));
  assert.notStrictEqual(mitchellFacts[0].subject, mitchellFacts[1].subject);

  const harness = actualFacadeHarness({ mutate(result) {
    result.responsiveFacts[0].typedRelationship.subject = party("natural_person", "Alex Morgan", [
      { scheme: "source_occurrence", value: "A", jurisdiction: "GB" },
    ]);
    result.responsiveFacts[1].typedRelationship.subject = party("natural_person", "Alex Morgan", [
      { scheme: "source_occurrence", value: "B", jurisdiction: "GB" },
    ]);
    return result;
  } });
  const mapped = await actualAdapter(harness).extract(extractionRequest());
  const sameName = mapped.candidateFacts.slice(0, 2).map(({ subject }) => subject);
  assert.deepEqual(sameName.map(({ name }) => name), ["Alex Morgan", "Alex Morgan"]);
  assert.deepEqual(sameName.map(({ externalIdentifiers }) => externalIdentifiers[0].value), ["A", "B"]);
  assert.ok(sameName.every((reference) => !reference.entityId));
  assert.notDeepEqual(sameName[0], sameName[1]);
});

test("OFFICER_OF stays a supported non-ownership candidate and ordinary title alone never qualifies", async () => {
  const harness = actualFacadeHarness({ mutate(result) {
    result.responsiveFacts = result.responsiveFacts.slice(4);
    result.typedRelationshipCount = 2;
    result.requestedConceptOutcomes = [{ concept: "officer_relationship", status: "found" }];
    return result;
  } });
  const result = await actualAdapter(harness).extract(extractionRequest({
    informationNeeds: [{ informationNeedId: "need-officer", concepts: ["OFFICER_RELATIONSHIP"] }],
  }));
  assert.equal(result.candidateFacts.length, 2);
  assert.ok(result.candidateFacts.every(({ type, attribute }) =>
    type === CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE && attribute === "officer_relationship"));
  const serialized = JSON.stringify(result);
  for (const forbidden of ["ECONOMIC_OWNERSHIP", "VOTING_RIGHTS", "BOARD_APPOINTMENT_RIGHT", "BOARD_REMOVAL_RIGHT", "SIGNIFICANT_INFLUENCE_OR_CONTROL", "MANAGEMENT_CONTROL", "qualifying", "controller"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("trusted authorization remains external to untrusted extraction input through the actual façade", async () => {
  const acceptedHarness = actualFacadeHarness();
  const accepted = await actualAdapter(acceptedHarness).extract(extractionRequest({
    tenantId: "forged-tenant",
    contextId: "forged-context",
    actorId: "forged-actor",
    callerScope: "forged-scope",
    credentials: "must-not-propagate",
  }));
  assert.equal(accepted.candidateFacts.length, 6);
  assert.ok(acceptedHarness.calls.authorizations.every((authorization) =>
    authorization.tenantId === AUTH.tenantId
    && authorization.contextId === AUTH.contextId
    && authorization.actorId === AUTH.actorId
    && authorization.callerScope === AUTH.callerScope));
  assert.doesNotMatch(JSON.stringify(accepted), /forged|credentials|must-not-propagate/);

  for (const trustedOverride of [
    { ...AUTH, contextId: "wrong-context" },
    { ...AUTH, tenantId: "wrong-tenant" },
  ]) {
    const denied = await actualAdapter(actualFacadeHarness(), async () => trustedOverride).extract(extractionRequest());
    assert.equal(denied.outcome.state, CAPABILITY_OUTCOME_STATE.FAILED);
    assert.equal(denied.outcome.code, "EVIDENCE_ACCESS_DENIED");
    assert.equal(denied.issues[0].evidenceCode, "access_denied");
  }

  const inaccessible = await actualAdapter(actualFacadeHarness()).extract(extractionRequest({
    artifactEvidenceReferences: [{
      system: "evidence-platform-v1",
      referenceType: "ARTIFACT",
      referenceId: IDS.inaccessibleArtifact,
    }],
  }));
  assert.equal(inaccessible.outcome.code, "EVIDENCE_ACCESS_DENIED");
});

test("actual façade preserves idempotency, fresh-run intent and inspection paid-call safety", async () => {
  const harness = actualFacadeHarness();
  const extraction = actualAdapter(harness);
  const first = await extraction.extract(extractionRequest());
  const replay = await extraction.extract(extractionRequest());
  assert.deepEqual(replay.candidateFacts.map(({ factId }) => factId), first.candidateFacts.map(({ factId }) => factId));
  assert.equal(replay.operationEvidenceReferences[0].locator.evidenceOperationId,
    first.operationEvidenceReferences[0].locator.evidenceOperationId);
  assert.deepEqual({ provider: harness.calls.provider, runs: harness.calls.runs }, { provider: 1, runs: 1 });

  const history = await harness.consumer.getInterpretationHistory(AUTH, {
    contractVersion: CONTRACT_VERSIONS.interpretationHistory,
    artifactIds: [IDS.artifact],
  });
  assert.equal(history.ok, true);
  assert.equal(history.result.providerCalled, false);
  assert.equal(history.result.operations.length, 1);
  assert.deepEqual({ provider: harness.calls.provider, runs: harness.calls.runs }, { provider: 1, runs: 1 });

  const conflict = await extraction.extract(extractionRequest({
    informationNeeds: [{ informationNeedId: "need-voting", concepts: ["VOTING_RIGHTS"] }],
  }));
  assert.equal(conflict.outcome.state, CAPABILITY_OUTCOME_STATE.FAILED);
  assert.equal(conflict.outcome.code, "EVIDENCE_IDEMPOTENCY_CONFLICT");
  assert.equal(conflict.issues[0].evidenceCode, "idempotency_conflict");
  assert.equal(harness.calls.provider, 1);

  const fresh = await extraction.extract(extractionRequest({ requestId: "g4-1c-request-2" }));
  assert.equal(fresh.candidateFacts.length, 6);
  assert.notDeepEqual(fresh.candidateFacts.map(({ factId }) => factId), first.candidateFacts.map(({ factId }) => factId));
  assert.deepEqual({ provider: harness.calls.provider, runs: harness.calls.runs, collection: harness.calls.collection }, {
    provider: 2, runs: 2, collection: 0,
  });
});

test("actual façade outcome and typed-error distinctions survive adapter mapping", async () => {
  const successful = [
    [CAPABILITY_OUTCOME_STATE.COMPLETE, (result) => {
      result.responsiveFacts = result.responsiveFacts.slice(0, 4);
      result.typedRelationshipCount = 4;
      result.requestedConceptOutcomes = [{ concept: "economic_ownership", status: "found" }];
      return result;
    }, [{ informationNeedId: "need-economic", concepts: ["ECONOMIC_OWNERSHIP"] }]],
    [CAPABILITY_OUTCOME_STATE.PARTIAL, (result) => result, extractionRequest().informationNeeds],
    [CAPABILITY_OUTCOME_STATE.NO_DATA, (result) => {
      result.responsiveFacts = [];
      result.typedRelationshipCount = 0;
      result.requestedConceptOutcomes = [{ concept: "economic_ownership", status: "not_found" }];
      return result;
    }, [{ informationNeedId: "need-economic", concepts: ["ECONOMIC_OWNERSHIP"] }]],
    [CAPABILITY_OUTCOME_STATE.INCONCLUSIVE, (result) => {
      result.responsiveFacts = [];
      result.typedRelationshipCount = 0;
      result.requestedConceptOutcomes = [{ concept: "economic_ownership", status: "not_evaluated" }];
      result.completeness.extraction.state = "incomplete";
      return result;
    }, [{ informationNeedId: "need-economic", concepts: ["ECONOMIC_OWNERSHIP"] }]],
  ];
  for (const [expected, mutate, informationNeeds] of successful) {
    const mapped = await actualAdapter(actualFacadeHarness({ mutate })).extract(extractionRequest({ informationNeeds }));
    assert.equal(mapped.outcome.state, expected);
  }

  const failures = [
    ["unsupported_concept", CAPABILITY_OUTCOME_STATE.UNSUPPORTED, "unsupported_concept"],
    ["unsupported_media_type", CAPABILITY_OUTCOME_STATE.UNSUPPORTED, "unsupported_media"],
    ["provider_timeout", CAPABILITY_OUTCOME_STATE.UNAVAILABLE, "provider_timeout"],
    ["provider_unavailable", CAPABILITY_OUTCOME_STATE.UNAVAILABLE, "provider_unavailable"],
    ["artifact_storage_unavailable", CAPABILITY_OUTCOME_STATE.UNAVAILABLE, "artifact_unavailable"],
    ["artifact_access_denied", CAPABILITY_OUTCOME_STATE.FAILED, "access_denied"],
    ["artifact_integrity_mismatch", CAPABILITY_OUTCOME_STATE.FAILED, "artifact_integrity_mismatch"],
    ["provider_malformed_output", CAPABILITY_OUTCOME_STATE.FAILED, "malformed_provider_result"],
    ["database_persistence_failed", CAPABILITY_OUTCOME_STATE.FAILED, "persistence_failure"],
  ];
  for (const [failureCode, expectedState, publicCode] of failures) {
    const mapped = await actualAdapter(actualFacadeHarness({ failureCode })).extract(extractionRequest());
    assert.equal(mapped.outcome.state, expectedState, failureCode);
    assert.equal(mapped.issues[0].evidenceCode, publicCode, failureCode);
  }
});

test("requested concept fulfilment governs outcome while supplemental OFFICER_OF limitations remain visible", async () => {
  const ownershipWithSupplementalOfficers = await actualAdapter(actualFacadeHarness({ mutate(result) {
    result.discoveredFacts = result.responsiveFacts.slice(4).map((fact) => ({
      ...fact,
      requestRelation: "supplemental_discovery",
    }));
    result.responsiveFacts = result.responsiveFacts.slice(0, 4);
    result.requestedConceptOutcomes = [{ concept: "economic_ownership", status: "found" }];
    return result;
  } })).extract(extractionRequest({
    informationNeeds: [{ informationNeedId: "need-economic", concepts: ["ECONOMIC_OWNERSHIP"] }],
  }));
  assert.equal(ownershipWithSupplementalOfficers.outcome.state, CAPABILITY_OUTCOME_STATE.COMPLETE);
  assert.equal(ownershipWithSupplementalOfficers.candidateFacts.length, 6);
  assert.equal(ownershipWithSupplementalOfficers.candidateFacts.filter(({ attribute }) =>
    attribute === "officer_relationship").length, 2);
  const supplementalIssues = ownershipWithSupplementalOfficers.issues.filter(({ code }) =>
    code === "RELATIONSHIP_PRESERVED_AS_ENTITY_ATTRIBUTE");
  assert.equal(supplementalIssues.length, 2);
  assert.ok(supplementalIssues.every(({ factScope }) => factScope === "DISCOVERED"));

  const requestedOfficer = await actualAdapter(actualFacadeHarness({ mutate(result) {
    result.responsiveFacts = result.responsiveFacts.slice(4);
    result.typedRelationshipCount = 2;
    result.requestedConceptOutcomes = [{ concept: "officer_relationship", status: "found" }];
    return result;
  } })).extract(extractionRequest({
    informationNeeds: [{ informationNeedId: "need-officer", concepts: ["OFFICER_RELATIONSHIP"] }],
  }));
  assert.equal(requestedOfficer.outcome.state, CAPABILITY_OUTCOME_STATE.PARTIAL);
  assert.ok(requestedOfficer.issues.filter(({ code }) =>
    code === "RELATIONSHIP_PRESERVED_AS_ENTITY_ATTRIBUTE")
    .every(({ factScope }) => factScope === "REQUESTED"));

  const incompleteOwnership = await actualAdapter(actualFacadeHarness({ mutate(result) {
    result.responsiveFacts = result.responsiveFacts.slice(0, 2);
    result.typedRelationshipCount = 2;
    result.requestedConceptOutcomes = [{ concept: "economic_ownership", status: "not_evaluated" }];
    result.completeness.extraction.state = "incomplete";
    return result;
  } })).extract(extractionRequest({
    informationNeeds: [{ informationNeedId: "need-economic", concepts: ["ECONOMIC_OWNERSHIP"] }],
  }));
  assert.equal(incompleteOwnership.outcome.state, CAPABILITY_OUTCOME_STATE.PARTIAL);
  assert.ok(incompleteOwnership.issues.some(({ code, status }) =>
    code === "EVIDENCE_REQUESTED_CONCEPT_OUTCOME" && status === "not_evaluated"));
});

test("actual façade keeps one source identity for six facts and retains multi-Artifact support once", async () => {
  const harness = actualFacadeHarness({ mutate(result) {
    result.evidence.artifacts.push(artifact(IDS.secondArtifact));
    result.evidence.integrity.artifacts.push({
      artifactId: IDS.secondArtifact,
      verified: true,
      calculatedSha256: "a".repeat(64),
      algorithm: "sha256",
    });
    const first = result.responsiveFacts[0];
    first.supportingArtifactIds.push(IDS.secondArtifact);
    first.supportLocators.push({
      id: "g4-1c-second-artifact-locator",
      artifactId: IDS.secondArtifact,
      ordinal: 2,
      kind: "image",
      description: "corroborating support",
      metadata: { qualified: true },
    });
    result.discoveredFacts.push(structuredClone(first));
    return result;
  } });
  const mapped = await actualAdapter(harness).extract(extractionRequest({
    artifactEvidenceReferences: [
      ...extractionRequest().artifactEvidenceReferences,
      { system: "evidence-platform-v1", referenceType: "ARTIFACT", referenceId: IDS.secondArtifact },
    ],
  }));
  assert.equal(mapped.candidateFacts.length, 6);
  assert.equal(mapped.candidateFacts[0].evidenceReferences.length, 2);
  assert.deepEqual(mapped.candidateFacts[0].evidenceReferences.map(({ referenceId }) => referenceId), [
    IDS.artifact, IDS.secondArtifact,
  ]);
  assert.equal(mapped.operationEvidenceReferences.length, 2);
  assert.equal(new Set(mapped.candidateFacts.map(({ factId }) => factId)).size, 6);
});
