"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  DECISION_APPLICATION_CONTRACT_VERSION_V2,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
  createUboDecisionApplication,
  projectOwnershipGraph,
  validateCapabilityResult,
} = require("../../../../ubo-control");
const {
  ADAPTER_ISSUE_CODE,
  LEGACY_DISCOVERY_ENDPOINT,
  createLegacyDiscoveryAdapter,
} = require("..");
const { companiesHouseOwnershipAdapter } = require("../../../../agents/ubo/companiesHouseOwnershipAdapter");
const { EDGE_TYPES } = require("../../../../agents/ubo/constants");
const { cloneFixture, response, edge } = require("../test-support/legacyResponseFixtures");
const tdrPsc = require("../test-support/tdrPscCharacterization.json");
const UK_POLICY_15 = require("../../../../ubo-control/policies/uk-corporate/1.5-rc/policy.json");

function discoveryRequest(overrides = {}) {
  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: "g31-request-1",
    caseId: "g31-case-1",
    informationNeeds: [{ needId: "current-structure", concepts: ["CURRENT_OWNERSHIP_AND_CONTROL"] }],
    subject: {
      entityId: "canonical-customer",
      name: "Example Customer Ltd",
      entityType: "COMPANY",
      jurisdiction: "GB",
      externalIdentifiers: [{ namespace: "GB_COMPANIES_HOUSE", value: "01234567" }],
    },
    ...overrides,
  };
}

function transportReturning(body, status = 200, calls = []) {
  return { async invoke(input) { calls.push(input); return { status, body }; } };
}

async function discoverFixture(id, options = {}) {
  const calls = [];
  const adapter = createLegacyDiscoveryAdapter({ transport: transportReturning(cloneFixture(id), options.status || 200, calls) });
  const result = await adapter.discover(options.request || discoveryRequest());
  validateCapabilityResult(result, { expectedRequestId: (options.request || discoveryRequest()).requestId });
  return { result, calls };
}

test("L01 exact direct ownership maps the minimum request and a directed EXACT economic candidate", async () => {
  const { result, calls } = await discoverFixture("L01");
  assert.deepEqual(calls, [{
    method: "POST",
    path: LEGACY_DISCOVERY_ENDPOINT,
    body: { entityName: "Example Customer Ltd", jurisdiction: "GB", registrationNumber: "01234567" },
  }]);
  assert.equal(result.outcome.state, CAPABILITY_OUTCOME_STATE.PARTIAL);
  assert.equal(result.candidateFacts.length, 1);
  const fact = result.candidateFacts[0];
  assert.equal(fact.relationship, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP);
  assert.deepEqual(fact.measurement, { type: PERCENTAGE_VALUE_TYPE.EXACT, value: 40 });
  assert.equal(fact.subject.name, "Alice Owner");
  assert.equal(fact.object.entityId, "canonical-customer");
  assert.equal(Object.hasOwn(fact.subject, "entityId"), false);
  assert.equal(Object.isFrozen(result), true);
});

test("L02 Companies House band preserves RANGE endpoints and never scalarizes the lower bound", async () => {
  const { result } = await discoverFixture("L02");
  assert.deepEqual(result.candidateFacts[0].measurement, {
    type: PERCENTAGE_VALUE_TYPE.RANGE,
    lowerBound: 25,
    upperBound: 50,
    lowerInclusive: false,
    upperInclusive: true,
  });
  assert.notEqual(result.candidateFacts[0].measurement.type, PERCENTAGE_VALUE_TYPE.EXACT);
});

test("L03 voting source becomes VOTING_RIGHTS and never economic ownership", async () => {
  const { result } = await discoverFixture("L03");
  assert.deepEqual(result.candidateFacts.map((fact) => fact.relationship), [RELATIONSHIP_TYPE.VOTING_RIGHTS]);
  assert.deepEqual(result.candidateFacts[0].measurement, {
    type: PERCENTAGE_VALUE_TYPE.RANGE,
    lowerBound: 50,
    upperBound: 75,
    lowerInclusive: false,
    upperInclusive: true,
  });
});

test("Companies House LLP voting bands retain their range instead of degrading to Unknown", async () => {
  const body = response({ edges: [edge("llp-vote", "legacy-owner-node", "legacy-root-node", {
    ownershipPercentage: 25,
    ownershipIsMinimum: true,
    metadata: { naturesOfControl: ["voting-rights-25-to-50-percent-limited-liability-partnership"] },
  })] });
  const result = await createLegacyDiscoveryAdapter({ transport: transportReturning(body) }).discover(discoveryRequest());
  assert.deepEqual(result.candidateFacts.map(({ relationship, measurement }) => ({ relationship, measurement })), [{
    relationship: RELATIONSHIP_TYPE.VOTING_RIGHTS,
    measurement: {
      type: PERCENTAGE_VALUE_TYPE.RANGE,
      lowerBound: 25,
      upperBound: 50,
      lowerInclusive: false,
      upperInclusive: true,
    },
  }]);
  assert.equal(result.issues.some(({ code }) => code === ADAPTER_ISSUE_CODE.PERCENTAGE_PRECISION_LOSS), false);
});

test("ASDA source PSC voting bands remain current control facts before G3 translation", async (t) => {
  const previousKey = process.env.COMPANIES_HOUSE_API_KEY;
  const previousFetch = global.fetch;
  t.after(() => {
    if (previousKey === undefined) delete process.env.COMPANIES_HOUSE_API_KEY;
    else process.env.COMPANIES_HOUSE_API_KEY = previousKey;
    global.fetch = previousFetch;
  });
  process.env.COMPANIES_HOUSE_API_KEY = "test-only";
  const activeNature = "voting-rights-25-to-50-percent-limited-liability-partnership";
  global.fetch = async () => ({
    ok: true,
    async json() {
      return { items: [
        { name: "Mr Gary Lindsay", kind: "individual-person-with-significant-control", natures_of_control: [activeNature] },
        { name: "Mr Thomas Andrew Mitchell", kind: "individual-person-with-significant-control", natures_of_control: [activeNature] },
        { name: "Mr Stephen James Robertson", kind: "individual-person-with-significant-control", ceased_on: "2022-12-22", natures_of_control: [activeNature] },
        { name: "Manjit Dale", kind: "individual-person-with-significant-control", natures_of_control: [activeNature] },
      ] };
    },
  });

  const source = await companiesHouseOwnershipAdapter({ entity: {
    name: "TDR Capital LLP", type: "company", jurisdiction: "GB", registrationNumber: "OC302604",
  } });
  assert.deepEqual(source.statements.map((statement) => ({
    name: statement.owner.name,
    type: statement.type,
    percentage: statement.ownershipPercentage,
    evidenceId: statement.evidenceIds[0],
    currentState: statement.metadata.currentState,
    concept: statement.metadata.relationshipConcept,
    range: statement.metadata.percentageRange,
    naturesOfControl: statement.metadata.naturesOfControl,
  })), ["Mr Gary Lindsay", "Mr Thomas Andrew Mitchell", "Manjit Dale"].map((name, index) => ({
    name,
    type: EDGE_TYPES.CONTROL,
    percentage: null,
    evidenceId: `companies-house:OC302604:psc:${index === 2 ? 3 : index}`,
    currentState: "CURRENT",
    concept: "VOTING_RIGHTS",
    range: { lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true },
    naturesOfControl: [activeNature],
  })));
  assert.equal(source.statements.some(({ type }) => type === EDGE_TYPES.OWNERSHIP), false);
});

test("L04 ambiguous voting/economic source is omitted and remains INCONCLUSIVE with a stable issue", async () => {
  const { result } = await discoverFixture("L04");
  assert.equal(result.outcome.state, CAPABILITY_OUTCOME_STATE.INCONCLUSIVE);
  assert.deepEqual(result.candidateFacts, []);
  assert.ok(result.issues.some(({ code }) => code === ADAPTER_ISSUE_CODE.AMBIGUOUS_RELATIONSHIP_SEMANTICS));
});

test("L05 legal-entity owner retains registry identity without adopting a legacy node ID", async () => {
  const { result } = await discoverFixture("L05");
  const owner = result.candidateFacts[0].subject;
  assert.equal(owner.entityType, "COMPANY");
  assert.deepEqual(owner.externalIdentifiers, [{ namespace: "legacy-company-register:GB", value: "09876543" }]);
  assert.equal(Object.hasOwn(owner, "entityId"), false);
});

test("L06 legacy UBO and effective-ownership conclusions cannot alter candidate output", async () => {
  const first = await discoverFixture("L06");
  const changed = cloneFixture("L06");
  changed.ubos = [{ personId: "someone-else", ownership: 100, basis: "changed" }];
  changed.ownership = { individuals: [{ effectiveOwnership: 0 }] };
  changed.control = [{ personId: "someone-else", legacyController: false }];
  changed.threshold = 99;
  const second = await createLegacyDiscoveryAdapter({ transport: transportReturning(changed) }).discover(discoveryRequest());
  assert.deepEqual(second, first.result);
});

test("L07 legacy gaps, stakeholder projection, remediation and reviewer state are ignored", async () => {
  const { result } = await discoverFixture("L07");
  const serialized = JSON.stringify(result);
  for (const forbidden of ["needs_customer_evidence", "Ask customer", "legacy remediation", "legacy-approved", "confidence"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("L08 distinct conflicting source assertions remain separate candidate facts", async () => {
  const { result } = await discoverFixture("L08");
  assert.equal(result.candidateFacts.length, 2);
  assert.deepEqual(result.candidateFacts.map(({ measurement }) => measurement.value), [40, 45]);
  assert.deepEqual(result.candidateFacts.map(({ evidenceReferences }) => evidenceReferences[0].referenceId), ["source-a", "source-b"]);
});

test("L09 successful empty discovery is NO_DATA and creates no negative fact", async () => {
  const { result } = await discoverFixture("L09");
  assert.equal(result.outcome.state, CAPABILITY_OUTCOME_STATE.NO_DATA);
  assert.deepEqual(result.candidateFacts, []);
});

test("L10 useful legacy output remains PARTIAL even when legacy status says resolved", async () => {
  const { result } = await discoverFixture("L10");
  assert.equal(result.outcome.state, CAPABILITY_OUTCOME_STATE.PARTIAL);
  assert.notEqual(result.outcome.state, CAPABILITY_OUTCOME_STATE.COMPLETE);
  assert.ok(result.issues.some(({ code }) => code === ADAPTER_ISSUE_CODE.KNOWN_COVERAGE_LIMITATION));
});

test("L11 malformed legacy response becomes FAILED, not NO_DATA", async () => {
  const { result } = await discoverFixture("L11");
  assert.equal(result.outcome.state, CAPABILITY_OUTCOME_STATE.FAILED);
  assert.equal(result.outcome.code, "LEGACY_MALFORMED_RESPONSE");
  assert.deepEqual(result.candidateFacts, []);
});

test("L12 connection/service failure becomes UNAVAILABLE and creates no fact", async () => {
  const error = Object.assign(new Error("offline fixture"), { code: "ECONNREFUSED" });
  const adapter = createLegacyDiscoveryAdapter({ transport: { async invoke() { throw error; } } });
  const result = await adapter.discover(discoveryRequest());
  assert.equal(result.outcome.state, CAPABILITY_OUTCOME_STATE.UNAVAILABLE);
  assert.equal(result.outcome.code, "LEGACY_SERVICE_UNAVAILABLE");
  assert.deepEqual(result.candidateFacts, []);
});

test("L13 rate limit, authentication, dependency 5xx and timeout remain operational outcomes", async (t) => {
  const cases = [
    [429, "LEGACY_RATE_LIMITED", true],
    [401, "LEGACY_AUTHENTICATION_UNAVAILABLE", false],
    [503, "LEGACY_SERVICE_UNAVAILABLE", true],
  ];
  for (const [status, code, retryable] of cases) {
    await t.test(String(status), async () => {
      const adapter = createLegacyDiscoveryAdapter({ transport: transportReturning({}, status) });
      const result = await adapter.discover(discoveryRequest());
      assert.equal(result.outcome.state, CAPABILITY_OUTCOME_STATE.UNAVAILABLE);
      assert.equal(result.outcome.code, code);
      assert.equal(result.outcome.retryable, retryable);
      assert.notEqual(result.outcome.state, CAPABILITY_OUTCOME_STATE.NO_DATA);
    });
  }
  await t.test("timeout", async () => {
    const adapter = createLegacyDiscoveryAdapter({ transport: { async invoke() {
      throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    } } });
    const result = await adapter.discover(discoveryRequest());
    assert.equal(result.outcome.state, CAPABILITY_OUTCOME_STATE.UNAVAILABLE);
    assert.equal(result.outcome.code, "LEGACY_TIMEOUT");
  });
});

test("L14 weak provenance stays fact-level empty and produces no invented evidence proof", async () => {
  const { result } = await discoverFixture("L14");
  assert.deepEqual(result.candidateFacts[0].evidenceReferences, []);
  assert.ok(result.issues.some(({ code }) => code === ADAPTER_ISSUE_CODE.MISSING_DURABLE_EVIDENCE_REFERENCE));
  assert.deepEqual(result.operationEvidenceReferences.map(({ referenceType }) => referenceType), ["DISCOVERY_RUN", "DISCOVERY_AUDIT"]);
  assert.equal(JSON.stringify(result).includes("operation-only-source"), false);
  assert.equal(JSON.stringify(result).includes("integrity"), false);
});

test("anti-corruption invariance ignores every legacy conclusion and presentation category", async () => {
  const baseline = response();
  const polluted = JSON.parse(JSON.stringify(baseline));
  Object.assign(polluted, {
    ubos: [{ final: true }],
    ownership: { effectiveOwnership: 88 },
    threshold: 10,
    control: { finalController: true },
    ownershipGaps: { recommendation: "collect passport" },
    stakeholders: [{ roles: ["ubo"] }],
    reviewerPresentation: { status: "green" },
    cache: { hit: true, determination: "cached" },
  });
  const first = await createLegacyDiscoveryAdapter({ transport: transportReturning(baseline) }).discover(discoveryRequest());
  const second = await createLegacyDiscoveryAdapter({ transport: transportReturning(polluted) }).discover(discoveryRequest());
  assert.deepEqual(second, first);
});

test("lower-bound scalar without reconstructable range becomes UNKNOWN with precision-loss issue", async () => {
  const body = response({ edges: [edge("lower-only", "legacy-owner-node", "legacy-root-node", {
    ownershipPercentage: 25, ownershipIsMinimum: true, metadata: { ownershipIsMinimum: true },
  })] });
  const result = await createLegacyDiscoveryAdapter({ transport: transportReturning(body) }).discover(discoveryRequest());
  assert.equal(result.candidateFacts[0].measurement.type, PERCENTAGE_VALUE_TYPE.UNKNOWN);
  assert.ok(result.issues.some(({ code }) => code === ADAPTER_ISSUE_CODE.PERCENTAGE_PRECISION_LOSS));
});

test("explicit economic and voting natures produce separate candidates while combined appointment/removal stays one non-percentage fact", async () => {
  const body = response({ edges: [
    edge("dual", "legacy-owner-node", "legacy-root-node", {
      ownershipPercentage: 25,
      metadata: { naturesOfControl: [
        "ownership-of-shares-25-to-50-percent",
        "voting-rights-25-to-50-percent",
      ] },
    }),
    edge("appointment", "legacy-owner-node", "legacy-root-node", {
      ownershipPercentage: null,
      metadata: { naturesOfControl: ["right-to-appoint-and-remove-directors"] },
    }),
  ] });
  const result = await createLegacyDiscoveryAdapter({ transport: transportReturning(body) }).discover(discoveryRequest());
  assert.deepEqual(result.candidateFacts.map(({ relationship }) => relationship), [
    RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
    RELATIONSHIP_TYPE.VOTING_RIGHTS,
    RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT,
  ]);
  assert.equal(Object.hasOwn(result.candidateFacts[2], "measurement"), false);
  assert.equal(result.candidateFacts[2].qualifiers.sourceStatementMode, "COMBINED_ALTERNATIVE");
  assert.equal(result.candidateFacts[2].qualifiers.requiresInterpretation, true);
});

test("TDR PSC assertions retain one-source/one-semantic-fact fidelity through canonical projection", async (t) => {
  const previousKey = process.env.COMPANIES_HOUSE_API_KEY;
  const previousFetch = global.fetch;
  t.after(() => {
    if (previousKey === undefined) delete process.env.COMPANIES_HOUSE_API_KEY;
    else process.env.COMPANIES_HOUSE_API_KEY = previousKey;
    global.fetch = previousFetch;
  });
  process.env.COMPANIES_HOUSE_API_KEY = "test-only";
  global.fetch = async () => ({ ok: true, async json() { return { items: structuredClone(tdrPsc.pscItems) }; } });

  const legacy = await companiesHouseOwnershipAdapter({ entity: {
    name: tdrPsc.subject.name,
    type: "company",
    jurisdiction: tdrPsc.subject.jurisdiction,
    registrationNumber: tdrPsc.subject.registrationNumber,
  } });
  assert.equal(legacy.statements.length, 3);
  assert.deepEqual(legacy.statements.map(({ metadata, type, ownershipPercentage }) => ({
    nature: metadata.naturesOfControl[0], concept: metadata.relationshipConcept, type, ownershipPercentage,
  })), [
    { nature: "significant-influence-or-control", concept: "SIGNIFICANT_INFLUENCE_OR_CONTROL", type: EDGE_TYPES.CONTROL, ownershipPercentage: null },
    { nature: "right-to-appoint-and-remove-person", concept: "APPOINT_OR_REMOVE_PERSONS", type: EDGE_TYPES.CONTROL, ownershipPercentage: null },
    { nature: "part-right-to-share-surplus-assets-75-to-100-percent", concept: "SURPLUS_ASSET_RIGHTS", type: EDGE_TYPES.OWNERSHIP, ownershipPercentage: 75 },
  ]);
  assert.deepEqual(legacy.statements[2].metadata.percentageRange, {
    lowerBound: 75, upperBound: 100, lowerInclusive: true, upperInclusive: true,
  });

  const rootId = "legacy-tdr-gp-v-lp";
  const legacyResponse = {
    ownershipGraph: {
      rootEntityId: rootId,
      nodes: [
        { id: rootId, name: tdrPsc.subject.name, type: "company", jurisdiction: "GB", registrationNumber: tdrPsc.subject.registrationNumber },
        ...legacy.statements.map((statement, index) => ({ id: `legacy-psc-${index + 1}`, ...statement.owner })),
      ],
      edges: legacy.statements.map((statement, index) => ({ ...statement, from: `legacy-psc-${index + 1}`, to: rootId })),
    },
    evidence: legacy.evidence,
    run: { id: "tdr-psc-characterization-run" },
    audit: { id: "tdr-psc-characterization-audit" },
  };
  const request = discoveryRequest({
    requestId: "tdr-psc-characterization-request",
    caseId: "tdr-psc-characterization-case",
    subject: {
      entityId: "entity-tdr-gp-v-lp",
      name: tdrPsc.subject.name,
      entityType: "LLP",
      jurisdiction: "GB",
      externalIdentifiers: [{ namespace: "COMPANIES_HOUSE_COMPANY_NUMBER", value: tdrPsc.subject.registrationNumber }],
    },
  });
  const capability = await createLegacyDiscoveryAdapter({ transport: transportReturning(legacyResponse) }).discover(request);
  assert.deepEqual(capability.candidateFacts.map(({ relationship }) => relationship), [
    RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL,
    RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT,
    RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
  ]);
  assert.equal(capability.candidateFacts.some(({ relationship }) => relationship === RELATIONSHIP_TYPE.VOTING_RIGHTS), false);
  assert.equal(capability.candidateFacts.some(({ relationship }) => relationship === RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT), false);
  assert.equal(capability.candidateFacts.some(({ relationship }) => relationship === RELATIONSHIP_TYPE.BOARD_REMOVAL_RIGHT), false);
  assert.equal(Object.hasOwn(capability.candidateFacts[0], "measurement"), false);
  assert.equal(Object.hasOwn(capability.candidateFacts[1], "measurement"), false);
  assert.deepEqual(capability.candidateFacts[2].measurement, {
    type: PERCENTAGE_VALUE_TYPE.RANGE,
    lowerBound: 75,
    upperBound: 100,
    lowerInclusive: true,
    upperInclusive: true,
  });
  assert.equal(capability.candidateFacts[2].qualifiers.economicInterestConcept, "SURPLUS_ASSET_RIGHTS");

  const application = createUboDecisionApplication({ policyPack: UK_POLICY_15, contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2 });
  const intake = application.intake({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseInput: {
      caseId: request.caseId,
      subjectReference: request.subject,
      externalReferences: [{ system: "tdr-psc-characterization", referenceId: request.caseId }],
      createdAt: "2026-09-02T09:00:00.000Z",
    },
    capabilityResult: capability,
    operationId: "tdr-psc-characterization-intake",
    recordedAt: "2026-09-02T09:01:00.000Z",
  });
  const entityIds = new Map([[tdrPsc.subject.name, request.subject.entityId]]);
  tdrPsc.pscItems.forEach((item, index) => entityIds.set(item.name, `entity-tdr-psc-${index + 1}`));
  const registrations = [...entityIds].map(([name, entityId]) => ({
    entityId,
    category: "LEGAL_ENTITY",
    primaryName: name,
    aliases: [],
    externalIdentifiers: [],
    jurisdiction: "GB",
    entityTypeMetadata: {},
    recordedAt: "2026-09-02T09:02:00.000Z",
  }));
  const identities = intake.decisionTargets.candidateParties.map((target, index) => ({
    decisionId: `tdr-identity-${index + 1}`,
    candidatePartyKey: target.candidatePartyKey,
    status: "RESOLVED",
    entityId: entityIds.get(target.party.name),
    basisReasonCodes: ["EXPLICIT_CHARACTERIZATION_REVIEW"],
    evidenceReferences: [],
    decidedAt: "2026-09-02T09:02:00.000Z",
    decisionOrigin: "TDR_PSC_CHARACTERIZATION",
    decisionActor: "TEST_REVIEWER",
  }));
  const adjudications = intake.decisionTargets.candidateClaims.map((target, index) => ({
    decisionId: `tdr-claim-${index + 1}`,
    claimId: target.claimId,
    previousState: target.currentState,
    resultingState: "OPERATIVE",
    reasonBasisCode: "EXPLICIT_CHARACTERIZATION_REVIEW",
    supportingEvidenceReferences: [],
    decisionOrigin: "TDR_PSC_CHARACTERIZATION",
    decisionActor: "TEST_REVIEWER",
    decidedAt: "2026-09-02T09:02:00.000Z",
    supersededByClaimIds: [],
    adversarialClaimIds: [],
  }));
  const reviewed = application.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseState: intake.caseState,
    entityRegistrations: registrations,
    identityDecisions: identities,
    claimAdjudications: adjudications,
  });
  const evaluation = application.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseState: reviewed.caseState,
    caseContext: { entityType: "limited_liability_partnership", subjectEntityId: request.subject.entityId, jurisdiction: "GB", riskLevel: "LOW" },
    evaluationTime: "2026-09-02T09:03:00.000Z",
    checkpoint: "CASE_OPEN",
    checkpointReference: { referenceId: "tdr-psc-characterization-evaluation" },
    resolutionInputs: {},
  });
  const claims = evaluation.decisionSnapshot.decisionContent.reasoning.operativeClaims;
  assert.deepEqual(claims.map(({ relationship }) => relationship).sort(), capability.candidateFacts.map(({ relationship }) => relationship).sort());
  const projection = projectOwnershipGraph({ decisionSnapshot: evaluation.decisionSnapshot });
  assert.equal(projection.nodes.length, 4, "one canonical entity node per PSC and subject");
  assert.equal(new Set(projection.nodes.map(({ entityId }) => entityId)).size, 4);
  assert.deepEqual(projection.relationships.map(({ relationshipType }) => relationshipType).sort(), capability.candidateFacts.map(({ relationship }) => relationship).sort());
  assert.equal(projection.relationships.every(({ support }) => support.claimCount === 1 && support.evidenceReferenceCount === 1), true);
});

test("unknown legacy relationship type is quarantined with the stable unsupported-field issue", async () => {
  const body = response({ edges: [edge("unknown", "legacy-owner-node", "legacy-root-node", {
    type: "legacy_magic_control", ownershipPercentage: null,
  })] });
  const result = await createLegacyDiscoveryAdapter({ transport: transportReturning(body) }).discover(discoveryRequest());
  assert.equal(result.outcome.state, CAPABILITY_OUTCOME_STATE.INCONCLUSIVE);
  assert.deepEqual(result.candidateFacts, []);
  assert.ok(result.issues.some(({ code }) => code === ADAPTER_ISSUE_CODE.UNSUPPORTED_LEGACY_FIELD));
});

test("unsupported subject or InformationNeed does not invoke transport", async () => {
  let calls = 0;
  const adapter = createLegacyDiscoveryAdapter({ transport: { async invoke() { calls += 1; } } });
  const result = await adapter.discover(discoveryRequest({
    informationNeeds: [{ needId: "identity", concepts: ["IDENTITY_VERIFICATION"] }],
  }));
  assert.equal(result.outcome.state, CAPABILITY_OUTCOME_STATE.UNSUPPORTED);
  assert.equal(calls, 0);
});

test("transport injection and production request validation are mandatory", async () => {
  assert.throws(() => createLegacyDiscoveryAdapter(), /injected transport/);
  const adapter = createLegacyDiscoveryAdapter({ transport: transportReturning({}) });
  await assert.rejects(() => adapter.discover({ ...discoveryRequest(), contractVersion: "wrong" }), /supported contract version/);
});

test("malformed transport envelope and non-availability HTTP rejection remain FAILED", async () => {
  const malformed = createLegacyDiscoveryAdapter({ transport: { async invoke() { return { body: {} }; } } });
  assert.equal((await malformed.discover(discoveryRequest())).outcome.state, CAPABILITY_OUTCOME_STATE.FAILED);
  const badRequest = createLegacyDiscoveryAdapter({ transport: transportReturning({}, 400) });
  assert.equal((await badRequest.discover(discoveryRequest())).outcome.code, "LEGACY_HTTP_ERROR");
});
