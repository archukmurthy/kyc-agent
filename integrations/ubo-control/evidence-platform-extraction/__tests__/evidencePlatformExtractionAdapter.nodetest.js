"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
  validateCapabilityResult,
} = require("../../../../ubo-control/index.js");
const { isExtractionService } = require("../../../../ubo-control/contracts/capability.js");
const { StubExtractionService } = require("../../../../ubo-control/test-support/scriptedStubs.js");
const {
  CONSUMER_CONTRACT_VERSION,
  CONTRACT_VERSIONS,
  createEvidenceConsumer,
} = require("../../../../evidence/consumer/v1/index.js");
const {
  buildBettercommsServiceResult,
  DIGEST,
  IDS,
} = require("../../../../evidence/consumer/v1/__fixtures__/bettercomms.js");
const {
  ADAPTER_CONTRACT_VERSION,
  createEvidencePlatformExtractionAdapter,
} = require("../index.js");

const AUTH = Object.freeze({
  contractVersion: CONTRACT_VERSIONS.trustedAuthorization,
  tenantId: "tenant-bettercomms",
  contextId: IDS.context,
  callerScope: "ubo:g4.1-fixture",
  actorType: "service",
  actorId: "fixture-host",
  subjectReferenceId: IDS.subject,
});

function request(overrides = {}) {
  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: "g4-1-bettercomms-operation-1",
    caseId: "bettercomms-case",
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

function rawArtifact(artifactId = IDS.artifact) {
  return {
    id: artifactId,
    assetId: IDS.asset,
    collectionId: "fixture-collection",
    representationType: "original_image",
    mediaType: "image/png",
    sizeBytes: 4096,
    capturedAt: "2026-09-08T10:00:00.000Z",
    assetTitle: "Sanitized ownership chart",
    evidenceType: "ownership_chart",
    accessClass: "context_restricted",
    subjectReferenceId: IDS.subject,
    subjectDisplayName: "Better Comms VOIP Ltd",
    fingerprintAlgorithm: "sha256",
    fingerprintValue: DIGEST,
  };
}

function canonicalRequest(requestValue) {
  return JSON.stringify({
    artifactIds: requestValue.artifactIds,
    requestedConcepts: requestValue.requestedConcepts,
    extractionContext: requestValue.extractionContext,
    correlation: requestValue.correlation,
  });
}

function consumerHarness({ mutate, failCode, authorize } = {}) {
  const calls = { interpret: 0, provider: 0, history: 0, authorizations: [], requests: [] };
  const operations = new Map();
  const interpretationService = {
    async resolve({ artifactIds }, authorization) {
      if (authorize) authorize(authorization, artifactIds);
      return artifactIds.map((id) => rawArtifact(id));
    },
    async interpret(evidenceRequest, authorization) {
      calls.interpret += 1;
      calls.authorizations.push(structuredClone(authorization));
      calls.requests.push(structuredClone(evidenceRequest));
      if (authorize) authorize(authorization, evidenceRequest.artifactIds);
      if (failCode) throw Object.assign(new Error("private internal detail must not escape"), { code: failCode });
      const fingerprint = canonicalRequest(evidenceRequest);
      const previous = operations.get(evidenceRequest.operationKey);
      if (previous && previous.fingerprint !== fingerprint) {
        throw Object.assign(new Error("changed request"), { code: "idempotency_conflict" });
      }
      if (previous) return { ...structuredClone(previous.result), replayed: true, providerCalled: false };
      calls.provider += 1;
      let serviceResult = buildBettercommsServiceResult();
      serviceResult.operation.key = evidenceRequest.operationKey;
      serviceResult.correlation = structuredClone(evidenceRequest.correlation);
      if (mutate) serviceResult = mutate(serviceResult, evidenceRequest) || serviceResult;
      operations.set(evidenceRequest.operationKey, { fingerprint, result: structuredClone(serviceResult) });
      return serviceResult;
    },
    async history() {
      calls.history += 1;
      return { operations: [] };
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
  return { calls, consumer };
}

function adapter(harness, provider = async () => AUTH) {
  return createEvidencePlatformExtractionAdapter({
    evidenceConsumer: harness.consumer,
    trustedAuthorizationProvider: provider,
  });
}

test("adapter is the UBO-owned ExtractionService seam and imports only the frozen Evidence entry", () => {
  const implementation = path.resolve(__dirname, "../index.js");
  const source = fs.readFileSync(implementation, "utf8");
  const evidenceImports = [...source.matchAll(/require\(["']([^"']*evidence[^"']*)["']\)/gi)].map((match) => match[1]);
  assert.deepEqual(evidenceImports, ["../../../evidence/consumer/v1/index.js"]);
  assert.doesNotMatch(source, /createEvidenceConsumer\s*\(/);
  assert.doesNotMatch(source, /api[\\/]evidence|evidence[\\/](?:a\d|r\d|consumer[\\/]v1[\\/](?:facade|contracts|errors))|repository|database|storage/i);
  assert.equal(ADAPTER_CONTRACT_VERSION, "ubo-evidence-platform-extraction-adapter-v1-fixture");
  assert.equal(isExtractionService(adapter(consumerHarness())), true);
  assert.equal(isExtractionService(new StubExtractionService([])), true);
});

test("frozen Bettercomms fixture maps one Artifact to six distinct CandidateFacts without decision pollution", async () => {
  const harness = consumerHarness();
  const mapped = await adapter(harness).extract(request());
  assert.equal(validateCapabilityResult(mapped, { expectedRequestId: request().requestId }), true);
  assert.equal(mapped.outcome.state, CAPABILITY_OUTCOME_STATE.PARTIAL);
  assert.equal(mapped.candidateFacts.length, 6);
  assert.equal(new Set(mapped.candidateFacts.map(({ factId }) => factId)).size, 6);
  assert.deepEqual(mapped.candidateFacts.slice(0, 4).map(({ relationship }) => relationship), [
    RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
    RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
    RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
    RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
  ]);
  assert.deepEqual(mapped.candidateFacts.slice(0, 4).map(({ measurement }) => measurement.value), [75, 25, 100, 100]);
  const officers = mapped.candidateFacts.slice(4);
  assert.ok(officers.every(({ type, attribute }) => type === CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE && attribute === "officer_relationship"));
  assert.deepEqual(officers.map(({ value }) => value.relationshipType), ["OFFICER_OF", "OFFICER_OF"]);
  assert.deepEqual(officers.map(({ value }) => value.relationshipValue.qualitative), ["Managing Director", "Commercial Director"]);
  assert.ok(officers.every(({ value }) => value.object.name === "Better Holdco"));
  assert.ok(mapped.candidateFacts.every(({ evidenceReferences }) => evidenceReferences.length === 1
    && evidenceReferences[0].referenceId === IDS.artifact
    && evidenceReferences[0].integrity.digest === DIGEST));
  assert.equal(new Set(mapped.candidateFacts.map(({ evidenceReferences }) => evidenceReferences[0].referenceId)).size, 1);
  assert.ok(mapped.candidateFacts.every(({ evidenceReferences }) =>
    evidenceReferences[0].locator.extractionRunId === IDS.run
    && evidenceReferences[0].locator.locators.length === 1));
  assert.equal(new Set(mapped.candidateFacts.map(({ evidenceReferences }) =>
    evidenceReferences[0].locator.locators[0].locatorId)).size, 6);
  assert.equal(mapped.operationEvidenceReferences.length, 1);
  assert.equal(mapped.operationEvidenceReferences[0].referenceId, IDS.artifact);
  assert.equal(mapped.operationEvidenceReferences[0].locator.evidenceOperationId, IDS.operation);
  assert.equal(mapped.operationEvidenceReferences[0].locator.extractionRunId, IDS.run);
  assert.ok(mapped.candidateFacts.every((fact) => fact.type === CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE
    ? fact.value.temporal.state === "unknown"
    : fact.qualifiers.evidenceTemporalState === "unknown"));
  const serialized = JSON.stringify(mapped);
  for (const forbidden of ["isUbo", "thresholdPassed", "qualifyingPerson", "operativeClaim", "policySatisfied", "customerAction", "indirectOwnership", "graphMutation"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(harness.calls.provider, 1);
});

test("public Evidence ordinary certification facts remain typed, source-located CandidateFacts without degrading complete requested ownership", async () => {
  const certification = [
    ["certification_signer_name", "Alex Palmer"],
    ["certification_signer_postnominal", "ACA"],
    ["certification_signer_capacity", "Management Accountant"],
    ["certification_professional_reference", "ACA No: 5246593"],
    ["certification_date", "05/05/2026"],
    ["certification_declaration", "I hereby certify that the company structure chart is true, correct and accurate"],
    ["certification_scope", "Depicted company structure chart"],
    ["certification_signature_presence", "Visible signature-like mark"],
  ];
  const harness = consumerHarness({ mutate(serviceResult) {
    const supplementalRelationships = serviceResult.responsiveFacts.slice(4);
    serviceResult.responsiveFacts = serviceResult.responsiveFacts.slice(0, 4);
    serviceResult.discoveredFacts = [
      ...supplementalRelationships,
      ...certification.map(([semanticConceptId, text], index) => {
        const fact = structuredClone(serviceResult.responsiveFacts[0]);
        fact.id = `95000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
        fact.semanticConceptId = semanticConceptId;
        fact.value = {
          statementType: "SOURCE_CERTIFICATION_METADATA",
          subject: {
            partyType: "legal_entity",
            name: "Better Comms VOIP Ltd",
            jurisdiction: "GB",
            identifiers: [],
          },
          attribute: semanticConceptId,
          text,
          authenticationState: "NOT_VERIFIED",
        };
        fact.requestRelation = "supplemental_discovery";
        fact.supportState = "supported_with_limitations";
        fact.supportLocators[0].id = `96000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
        fact.supportLocators[0].description = `Certification block: ${semanticConceptId}`;
        delete fact.typedRelationship;
        return fact;
      }),
    ];
    serviceResult.requestedConceptOutcomes = [{ concept: "economic_ownership", status: "found" }];
    return serviceResult;
  } });
  const mapped = await adapter(harness).extract(request({
    informationNeeds: [{ informationNeedId: "need-economic", concepts: ["ECONOMIC_OWNERSHIP"] }],
  }));

  assert.equal(mapped.outcome.state, CAPABILITY_OUTCOME_STATE.COMPLETE);
  assert.equal(mapped.candidateFacts.length, 14);
  const attributes = mapped.candidateFacts.filter(({ attribute }) => attribute?.startsWith("source_certification_"));
  assert.equal(attributes.length, 8);
  assert.deepEqual(attributes.map(({ value }) => value.text).sort(), certification.map(([, text]) => text).sort());
  assert.ok(attributes.every(({ type, subject, value, evidenceReferences }) =>
    type === CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE
      && subject.name === "Better Comms VOIP Ltd"
      && value.authenticationState === "NOT_VERIFIED"
      && value.evidenceRequestRelation === "supplemental_discovery"
      && evidenceReferences[0].referenceId === IDS.artifact
      && evidenceReferences[0].locator.locators.length === 1));
  assert.equal(mapped.issues.filter(({ code }) => code === "EVIDENCE_FACT_NOT_TYPED").length, 0);
});

test("exact, range, unknown and qualitative values preserve percentage-point and endpoint semantics", async () => {
  const harness = consumerHarness({ mutate(serviceResult) {
    serviceResult.responsiveFacts[0].typedRelationship.value = {
      kind: "RANGE",
      measurementType: "percentage",
      lower: 25,
      upper: 50,
      lowerInclusive: false,
      upperInclusive: true,
      unit: "percentage_points",
    };
    serviceResult.responsiveFacts[1].typedRelationship.value = {
      kind: "UNKNOWN",
      measurementType: "none",
      unit: null,
    };
    return serviceResult;
  } });
  const mapped = await adapter(harness).extract(request());
  assert.deepEqual(mapped.candidateFacts[0].measurement, {
    type: PERCENTAGE_VALUE_TYPE.RANGE,
    lowerBound: 25,
    upperBound: 50,
    lowerInclusive: false,
    upperInclusive: true,
  });
  assert.equal(mapped.candidateFacts[0].qualifiers.evidenceValue.unit, "percentage_points");
  assert.deepEqual(mapped.candidateFacts[1].measurement, {
    type: PERCENTAGE_VALUE_TYPE.UNKNOWN,
    reason: "Evidence relationship value is unknown",
  });
  assert.notEqual(mapped.candidateFacts[1].measurement.value, 0);
  assert.equal(mapped.candidateFacts[4].value.relationshipValue.kind, "QUALITATIVE");
  assert.equal(mapped.candidateFacts[4].value.relationshipValue.qualitative, "Managing Director");
});

test("open percentage-domain bounds are completed without losing the original Evidence endpoint", async () => {
  const harness = consumerHarness({ mutate(serviceResult) {
    serviceResult.responsiveFacts[0].typedRelationship.value = {
      kind: "RANGE",
      measurementType: "percentage",
      lower: 75,
      upper: null,
      lowerInclusive: true,
      upperInclusive: null,
      unit: "percentage_points",
    };
    return serviceResult;
  } });
  const mapped = await adapter(harness).extract(request());
  assert.deepEqual(mapped.candidateFacts[0].measurement, {
    type: "RANGE",
    lowerBound: 75,
    upperBound: 100,
    lowerInclusive: true,
    upperInclusive: true,
  });
  assert.equal(mapped.candidateFacts[0].qualifiers.evidenceValue.upper, null);
  assert.equal(mapped.candidateFacts[0].qualifiers.evidenceValue.upperInclusive, null);
});

test("current, ceased, historical and unknown temporal states remain independently visible", async () => {
  const harness = consumerHarness({ mutate(serviceResult) {
    ["current", "ceased", "historical", "unknown"].forEach((state, index) => {
      serviceResult.responsiveFacts[index].typedRelationship.temporal = {
        state,
        effectiveFrom: index === 0 ? "2024-01-01" : null,
        effectiveTo: index === 1 ? "2025-01-01" : null,
        sourceEffectiveDate: "2026-09-01",
        precision: { source: "fixture" },
      };
    });
    return serviceResult;
  } });
  const mapped = await adapter(harness).extract(request());
  const ownership = mapped.candidateFacts.slice(0, 4);
  assert.deepEqual(ownership.map(({ qualifiers }) => qualifiers.evidenceTemporalState), ["current", "ceased", "historical", "unknown"]);
  assert.deepEqual(ownership.map(({ qualifiers }) => qualifiers.currentState), ["CURRENT", "CEASED", "CEASED", "UNKNOWN"]);
  assert.deepEqual(ownership.map(({ qualifiers }) => qualifiers.historical), [false, false, true, false]);
  assert.equal(ownership[0].qualifiers.effectiveFrom, "2024-01-01");
  assert.equal(ownership[1].qualifiers.effectiveTo, "2025-01-01");
  assert.ok(ownership.every(({ qualifiers }) => qualifiers.sourceEffectiveDate === "2026-09-01"));
});

test("one Fact with several Artifacts remains one CandidateFact with several source references", async () => {
  const secondArtifact = "10000000-0000-4000-8000-000000000099";
  const harness = consumerHarness({ mutate(serviceResult) {
    serviceResult.evidence.artifacts.push(rawArtifact(secondArtifact));
    serviceResult.evidence.integrity.artifacts.push({ artifactId: secondArtifact, verified: true, calculatedSha256: "a".repeat(64), algorithm: "sha256" });
    const fact = serviceResult.responsiveFacts[0];
    fact.supportingArtifactIds.push(secondArtifact);
    fact.supportLocators.push({
      id: "20000000-0000-4000-8000-000000000099",
      artifactId: secondArtifact,
      ordinal: 2,
      kind: "image",
      description: "corroborating source-visible relationship",
      metadata: { qualified: true },
    });
    serviceResult.discoveredFacts.push(structuredClone(fact));
    return serviceResult;
  } });
  const mapped = await adapter(harness).extract(request({
    artifactEvidenceReferences: [
      ...request().artifactEvidenceReferences,
      { system: "evidence-platform-v1", referenceType: "ARTIFACT", referenceId: secondArtifact },
    ],
  }));
  assert.equal(mapped.candidateFacts.length, 6);
  assert.equal(mapped.candidateFacts[0].evidenceReferences.length, 2);
  assert.deepEqual(mapped.candidateFacts[0].evidenceReferences.map(({ referenceId }) => referenceId), [IDS.artifact, secondArtifact]);
  assert.equal(mapped.operationEvidenceReferences.length, 2);
  assert.equal(new Set(mapped.candidateFacts.map(({ factId }) => factId)).size, 6);
});

test("complete, partial, not-found, not-evaluated and unsupported concept outcomes remain distinct", async () => {
  const cases = [
    {
      expected: CAPABILITY_OUTCOME_STATE.COMPLETE,
      mutate(serviceResult) {
        serviceResult.responsiveFacts = serviceResult.responsiveFacts.slice(0, 4);
        serviceResult.typedRelationshipCount = 4;
        serviceResult.requestedConceptOutcomes = [{ concept: "economic_ownership", status: "found" }];
        return serviceResult;
      },
      input: request({ informationNeeds: [{ informationNeedId: "need-economic", concepts: ["ECONOMIC_OWNERSHIP"] }] }),
    },
    {
      expected: CAPABILITY_OUTCOME_STATE.PARTIAL,
      mutate(serviceResult) {
        serviceResult.responsiveFacts = serviceResult.responsiveFacts.slice(0, 4);
        serviceResult.typedRelationshipCount = 4;
        serviceResult.requestedConceptOutcomes = [
          { concept: "economic_ownership", status: "found" },
          { concept: "officer_relationship", status: "not_evaluated" },
        ];
        serviceResult.completeness.extraction.state = "incomplete";
        return serviceResult;
      },
      input: request(),
    },
    {
      expected: CAPABILITY_OUTCOME_STATE.NO_DATA,
      mutate(serviceResult) {
        serviceResult.responsiveFacts = [];
        serviceResult.typedRelationshipCount = 0;
        serviceResult.requestedConceptOutcomes = [{ concept: "economic_ownership", status: "not_found" }];
        return serviceResult;
      },
      input: request({ informationNeeds: [{ informationNeedId: "need-economic", concepts: ["ECONOMIC_OWNERSHIP"] }] }),
    },
    {
      expected: CAPABILITY_OUTCOME_STATE.INCONCLUSIVE,
      mutate(serviceResult) {
        serviceResult.responsiveFacts = [];
        serviceResult.typedRelationshipCount = 0;
        serviceResult.requestedConceptOutcomes = [{ concept: "economic_ownership", status: "not_evaluated" }];
        serviceResult.completeness.extraction.state = "incomplete";
        return serviceResult;
      },
      input: request({ informationNeeds: [{ informationNeedId: "need-economic", concepts: ["ECONOMIC_OWNERSHIP"] }] }),
    },
    {
      expected: CAPABILITY_OUTCOME_STATE.UNSUPPORTED,
      mutate(serviceResult) {
        serviceResult.responsiveFacts = [];
        serviceResult.typedRelationshipCount = 0;
        serviceResult.requestedConceptOutcomes = [{ concept: "economic_ownership", status: "unsupported" }];
        return serviceResult;
      },
      input: request({ informationNeeds: [{ informationNeedId: "need-economic", concepts: ["ECONOMIC_OWNERSHIP"] }] }),
    },
  ];
  for (const item of cases) {
    const harness = consumerHarness({ mutate: item.mutate });
    const mapped = await adapter(harness).extract(item.input);
    assert.equal(mapped.outcome.state, item.expected);
    assert.equal(validateCapabilityResult(mapped, { expectedRequestId: item.input.requestId }), true);
  }
});

test("public Evidence failures retain authorization, availability, integrity, provider and persistence meaning", async () => {
  const mappings = [
    ["unsupported_concept", CAPABILITY_OUTCOME_STATE.UNSUPPORTED],
    ["unsupported_media", CAPABILITY_OUTCOME_STATE.UNSUPPORTED],
    ["incomplete_interpretation", CAPABILITY_OUTCOME_STATE.INCONCLUSIVE],
    ["artifact_unavailable", CAPABILITY_OUTCOME_STATE.UNAVAILABLE],
    ["not_found", CAPABILITY_OUTCOME_STATE.UNAVAILABLE],
    ["provider_unavailable", CAPABILITY_OUTCOME_STATE.UNAVAILABLE],
    ["provider_timeout", CAPABILITY_OUTCOME_STATE.UNAVAILABLE],
    ["provider_failure", CAPABILITY_OUTCOME_STATE.FAILED],
    ["malformed_provider_result", CAPABILITY_OUTCOME_STATE.FAILED],
    ["access_denied", CAPABILITY_OUTCOME_STATE.FAILED],
    ["artifact_integrity_mismatch", CAPABILITY_OUTCOME_STATE.FAILED],
    ["cross_asset_selection", CAPABILITY_OUTCOME_STATE.FAILED],
    ["idempotency_conflict", CAPABILITY_OUTCOME_STATE.FAILED],
    ["persistence_failure", CAPABILITY_OUTCOME_STATE.FAILED],
    ["operation_failed", CAPABILITY_OUTCOME_STATE.FAILED],
  ];
  for (const [code, state] of mappings) {
    const fake = {
      async interpretArtifacts() {
        return {
          contractVersion: CONSUMER_CONTRACT_VERSION,
          operation: "interpretArtifacts",
          ok: false,
          error: {
            contractVersion: CONTRACT_VERSIONS.operationOutcome,
            code,
            category: "fixture",
            message: "Public safe message",
            retryable: code.includes("provider") || code.includes("unavailable") || code === "incomplete_interpretation",
          },
        };
      },
    };
    const mapped = await adapter({ consumer: fake }).extract(request());
    assert.equal(mapped.outcome.state, state, code);
    assert.equal(mapped.outcome.code, `EVIDENCE_${code.toUpperCase()}`, code);
    assert.equal(mapped.issues[0].evidenceCode, code, code);
    assert.equal(JSON.stringify(mapped).includes("private"), false, code);
  }
});

test("malformed envelopes, truncated interpretation and pre-Artifact handoffs fail truthfully", async () => {
  const malformed = await adapter({ consumer: { async interpretArtifacts() { return { ok: true }; } } })
    .extract(request());
  assert.equal(malformed.outcome.state, CAPABILITY_OUTCOME_STATE.FAILED);
  assert.equal(malformed.outcome.code, "MALFORMED_EVIDENCE_CONSUMER_RESULT");

  const truncated = await adapter({ consumer: {
    async interpretArtifacts() {
      return {
        contractVersion: CONSUMER_CONTRACT_VERSION,
        operation: "interpretArtifacts",
        ok: false,
        error: {
          contractVersion: CONTRACT_VERSIONS.operationOutcome,
          code: "incomplete_interpretation",
          category: "interpretation",
          message: "Truncated",
          retryable: true,
        },
      };
    },
  } }).extract(request());
  assert.equal(truncated.outcome.state, CAPABILITY_OUTCOME_STATE.INCONCLUSIVE);

  const handoff = await adapter(consumerHarness()).extract(request({
    artifactEvidenceReferences: [{
      system: "ubo-control",
      referenceType: "EXTERNAL_EVIDENCE_HANDOFF",
      referenceId: "handoff-only",
    }],
  }));
  assert.equal(handoff.outcome.state, CAPABILITY_OUTCOME_STATE.UNSUPPORTED);
  assert.equal(handoff.outcome.code, "EXISTING_EVIDENCE_ARTIFACT_REQUIRED");
});

test("one grouped extraction becomes one multi-concept Evidence interpretation", async () => {
  const harness = consumerHarness();
  await adapter(harness).extract(request({
    informationNeeds: [
      { needId: "need-1", concept: "CURRENT_OWNERSHIP_AND_CONTROL", resolutionGroupId: "group-1", resolutionActionId: "action-1" },
      { needId: "need-2", concept: "OFFICER_RELATIONSHIP", resolutionGroupId: "group-1", resolutionActionId: "action-1" },
    ],
  }));
  assert.equal(harness.calls.interpret, 1);
  assert.equal(harness.calls.provider, 1);
  assert.deepEqual(harness.calls.requests[0].requestedConcepts.map(({ concept }) => concept), [
    "appointment_rights",
    "economic_ownership",
    "formal_control_rights",
    "officer_relationship",
    "removal_rights",
    "significant_influence_or_control",
    "voting_rights",
  ]);
  assert.deepEqual(harness.calls.requests[0].correlation.externalReferences, [
    { system: "ubo-control", type: "information-need", id: "need-1" },
    { system: "ubo-control", type: "information-need", id: "need-2" },
    { system: "ubo-control", type: "resolution-action", id: "action-1" },
    { system: "ubo-control", type: "resolution-group", id: "group-1" },
  ]);
  assert.equal("policyThreshold" in harness.calls.requests[0], false);
  assert.equal(JSON.stringify(harness.calls.requests[0]).includes("qualifyingPerson"), false);
});

test("trusted authorization is injected and untrusted request fields cannot override it", async () => {
  const harness = consumerHarness();
  const providerCalls = [];
  const extraction = adapter(harness, async (lookup) => {
    providerCalls.push(structuredClone(lookup));
    return AUTH;
  });
  const mapped = await extraction.extract(request({
    tenantId: "forged-tenant",
    contextId: "forged-context",
    callerScope: "forged-scope",
    actorId: "forged-actor",
    credentials: "must-not-propagate",
  }));
  assert.deepEqual(providerCalls, [{
    requestId: "g4-1-bettercomms-operation-1",
    caseId: "bettercomms-case",
  }]);
  const { contractVersion: _validatedAtConsumerBoundary, ...normalizedAuthorization } = AUTH;
  assert.deepEqual(harness.calls.authorizations, [normalizedAuthorization]);
  const evidenceRequest = JSON.stringify(harness.calls.requests[0]);
  assert.doesNotMatch(evidenceRequest, /forged|credentials|tenantId|contextId|callerScope|actorId/);
  assert.doesNotMatch(JSON.stringify(mapped), /forged|must-not-propagate|credentials/);
});

test("tenant, context and Artifact access failures remain fail-closed", async () => {
  function authorize(authorization, ids) {
    if (authorization.tenantId !== AUTH.tenantId || authorization.contextId !== AUTH.contextId
      || ids.includes("inaccessible-artifact")) {
      throw Object.assign(new Error("not authorized"), { code: "artifact_access_denied" });
    }
  }
  const acceptedHarness = consumerHarness({ authorize, mutate(serviceResult) {
    serviceResult.responsiveFacts[0].typedRelationship.temporal.state = "historical";
    return serviceResult;
  } });
  const accepted = await adapter(acceptedHarness).extract(request());
  assert.equal(accepted.candidateFacts[0].qualifiers.evidenceTemporalState, "historical");

  const wrongContext = await adapter(
    consumerHarness({ authorize }),
    async () => ({ ...AUTH, contextId: "wrong-context" }),
  ).extract(request());
  assert.equal(wrongContext.outcome.state, CAPABILITY_OUTCOME_STATE.FAILED);
  assert.equal(wrongContext.outcome.code, "EVIDENCE_ACCESS_DENIED");

  const wrongTenant = await adapter(
    consumerHarness({ authorize }),
    async () => ({ ...AUTH, tenantId: "wrong-tenant" }),
  ).extract(request());
  assert.equal(wrongTenant.outcome.code, "EVIDENCE_ACCESS_DENIED");

  const inaccessible = await adapter(consumerHarness({ authorize })).extract(request({
    artifactEvidenceReferences: [{
      system: "evidence-platform-v1",
      referenceType: "ARTIFACT",
      referenceId: "inaccessible-artifact",
    }],
  }));
  assert.equal(inaccessible.outcome.code, "EVIDENCE_ACCESS_DENIED");
});

test("same operation key replays, changed input conflicts, and a new key permits fresh interpretation", async () => {
  const harness = consumerHarness();
  const extraction = adapter(harness);
  const first = await extraction.extract(request());
  const replay = await extraction.extract(request());
  assert.equal(first.outcome.state, CAPABILITY_OUTCOME_STATE.PARTIAL);
  assert.equal(replay.outcome.state, CAPABILITY_OUTCOME_STATE.PARTIAL);
  assert.equal(harness.calls.provider, 1);
  assert.equal(harness.calls.history, 0);

  const conflict = await extraction.extract(request({
    informationNeeds: [{ informationNeedId: "need-voting", concepts: ["VOTING_RIGHTS"] }],
  }));
  assert.equal(conflict.outcome.state, CAPABILITY_OUTCOME_STATE.FAILED);
  assert.equal(conflict.outcome.code, "EVIDENCE_IDEMPOTENCY_CONFLICT");
  assert.equal(harness.calls.provider, 1);

  const fresh = await extraction.extract(request({ requestId: "g4-1-bettercomms-operation-2" }));
  assert.equal(fresh.outcome.state, CAPABILITY_OUTCOME_STATE.PARTIAL);
  assert.equal(harness.calls.provider, 2);
  assert.equal(harness.calls.history, 0);
});
