"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { autoReviewDemoReplaySession, autoReviewDemoSession, buildPlan, prepareDemoLiveDiscoveryBody, prepareDemoReplayRecord } = require("../server/demoAutoReview");
const { normalizedFixtureInput, startReviewReplay } = require("../server/reviewLabEngine");
const tdrPscFixture = require("../fixtures/tdr-psc.json");

function replaySession(fixtureId) {
  const normalized = normalizedFixtureInput({ fixtureId });
  const session = startReviewReplay({ replayRecord: {
    replayId: `demo-${fixtureId}`,
    subject: normalized.subject,
    companyContext: normalized.companyContext,
    discoveryResult: normalized.result,
    savedAt: "2026-09-15T08:00:00.000Z",
  } });
  session.sourceState = "LIVE";
  session.sourceLabel = `Live Discovery · ${session.companyContext.legalEntityName}`;
  return session;
}

test("demo LIVE research bypasses a pre-fix investigation cache without mutating the translated request", () => {
  const body = { entityName: "TDR CAPITAL GENERAL PARTNER V L.P.", registrationNumber: "SL035224", jurisdiction: "GB" };
  assert.deepEqual(prepareDemoLiveDiscoveryBody(body), { ...body, forceRefresh: true, demoRegistryContext: true });
  assert.equal(body.forceRefresh, undefined);
});

test("demo-only review makes source-backed voting ranges operative without changing their dimension or endpoints", () => {
  const result = autoReviewDemoSession(replaySession("V2-LAB-06"), "2026-09-15T08:01:00.000Z");
  assert.equal(result.snapshots.length, 1);
  assert.equal(result.demoAutoReview.operativeClaims, 3);
  assert.equal(result.demoAutoReview.unresolvedClaims, 0);
  const relationships = result.snapshots[0].view.graph.relationships;
  assert.equal(relationships.length, 3);
  assert.equal(relationships.every(({ relationshipType }) => relationshipType === "VOTING_RIGHTS"), true);
  assert.equal(relationships.every(({ measurement }) => measurement.type === "RANGE"
    && measurement.lowerBound === 25 && measurement.upperBound === 50
    && measurement.lowerInclusive === false && measurement.upperInclusive === true), true);
  assert.equal(result.snapshots[0].reason, "DEMO_AUTOMATIC_REVIEW");
  assert.match(result.sourceLabel, /provisional demo result/);
});

test("ordinary successor live/replay intake still waits for explicit decisions", () => {
  const session = replaySession("V2-LAB-01");
  assert.equal(session.snapshots.length, 0);
  assert.equal(session.lastOperation, "EXPLICIT_DECISIONS_REQUIRED");
  assert.equal(session.demoAutoReview, undefined);
});

test("saved live replay can run the same provisional demo review with zero provider calls", () => {
  const session = replaySession("V2-LAB-01");
  session.sourceState = "REPLAY";
  session.discovery = { replay: { replayId: "saved-live", transportCalls: 0 } };
  const result = autoReviewDemoReplaySession(session, "2026-09-15T08:01:00.000Z");
  assert.equal(result.sourceState, "REPLAY");
  assert.equal(result.discovery.replay.transportCalls, 0);
  assert.equal(result.snapshots.length, 1);
  assert.match(result.sourceLabel, /Saved live replay.*no provider call/);
});

test("live and saved acquisition share the same post-acquisition demo evaluation semantics", () => {
  const normalized = normalizedFixtureInput({ fixtureId: "V2-LAB-01" });
  const record = { replayId: "saved-parity-record", subject: normalized.subject, companyContext: normalized.companyContext, discoveryResult: normalized.result, savedAt: "2026-09-15T08:00:00.000Z" };
  const live = startReviewReplay({ replayRecord: record });
  live.sourceState = "LIVE";
  const replay = startReviewReplay({ replayRecord: record });
  replay.discovery = { replay: { replayId: record.replayId, transportCalls: 0 } };
  let providerCalls = 0;
  replay.provider = { invoke() { providerCalls += 1; throw new Error("Saved replay must not call a provider"); } };
  const liveResult = autoReviewDemoSession(live, "2026-09-15T08:01:00.000Z");
  const replayResult = autoReviewDemoReplaySession(replay, "2026-09-15T08:01:00.000Z");
  const sorted = (items) => items.map((item) => JSON.stringify(item)).sort();
  const semantics = (result) => {
    const view = result.snapshots.at(-1).view;
    const names = new Map(view.graph.nodes.map(({ entityId, primaryName }) => [entityId, primaryName]));
    return {
      subject: result.companyContext,
      facts: sorted(result.candidateSources.flatMap(({ candidateFacts }) => candidateFacts)),
      relationships: sorted(view.graph.relationships.map((relationship) => ({
        from: names.get(relationship.subjectEntityId), to: names.get(relationship.objectEntityId),
        type: relationship.relationshipType, dimension: relationship.dimension,
        measurement: relationship.measurement || null, qualifiers: relationship.qualifiers || null,
      }))),
      calculations: sorted(view.graph.calculations.map(({ dimension, state, aggregateKnownValue, unknownPathCount }) => ({ dimension, state, aggregateKnownValue, unknownPathCount }))),
      needs: sorted(view.informationNeeds.map(({ concept, status, reasonCode, targetKind, requiredByRequirementIds }) => ({ concept, status, reasonCode, targetKind, requiredByRequirementIds }))),
      planState: view.plan.state,
      customerBundles: sorted(view.journeyProjection.customerWorkBundles.map(({ state, permittedSemanticActions }) => ({ state, permittedSemanticActions }))),
    };
  };
  assert.deepEqual(semantics(replayResult), semantics(liveResult));
  assert.equal(providerCalls, 0);
  assert.equal(replayResult.discovery.replay.transportCalls, 0);
  assert.equal(replayResult.sourceState, "REPLAY");
});

test("a truthful live no-data result still evaluates to a subject-centred unresolved graph", () => {
  const result = autoReviewDemoSession(replaySession("V2-LAB-09"), "2026-09-15T08:01:00.000Z");
  assert.equal(result.snapshots.length, 1);
  assert.equal(result.snapshots[0].view.graph.nodes.length, 1);
  assert.equal(result.demoAutoReview.operativeClaims, 0);
  assert.ok(result.snapshots[0].view.informationNeeds.length > 0);
});

test("conflicting relationships and same-name identities remain non-operative while safe facts can continue", () => {
  const evidenceReferences = [{ system: "registry", referenceType: "SOURCE_REFERENCE", referenceId: "source-1" }];
  const person = { name: "Same Name", entityType: "NATURAL_PERSON", jurisdiction: "GB", externalIdentifiers: [] };
  const company = { entityId: "target", name: "Target Ltd", entityType: "COMPANY", jurisdiction: "GB", externalIdentifiers: [] };
  const facts = [40, 45].map((value, index) => ({ factId: `conflict-${index}`, type: "RELATIONSHIP", subject: person, object: company, relationship: "ECONOMIC_OWNERSHIP", measurement: { type: "EXACT", value }, evidenceReferences }));
  const claims = facts.map((fact, index) => ({ targetType: "CANDIDATE_CLAIM", claimId: `claim-${index}`, currentState: "CANDIDATE", relationship: fact.relationship, originatingCandidateFact: { candidateFactId: fact.factId } }));
  const parties = claims.map((claim) => ({ targetType: "CANDIDATE_PARTY", candidatePartyKey: `${claim.claimId}:subject`, claimId: claim.claimId, endpoint: "SUBJECT", party: person }));
  const plan = buildPlan({ caseId: "demo", candidateSources: [{ candidateFacts: facts }], decisionTargets: { candidateParties: parties, candidateClaims: claims }, entityDirectory: [{ entityId: "target", party: company }] });
  assert.equal(plan.identityDecisions.every(({ action }) => action === "LEAVE_UNRESOLVED"), true);
  assert.equal(plan.claimDecisions.every(({ resultingState }) => resultingState === "DISPUTED"), true);
});

test("unsafe live assertions do not block a safely sourced remainder from reaching the graph", () => {
  const normalized = normalizedFixtureInput({ fixtureId: "V2-LAB-01" });
  const safe = normalized.result.candidateFacts[0];
  const ambiguousParty = { name: "Duplicated Registry Name", entityType: "NATURAL_PERSON", jurisdiction: "GB", externalIdentifiers: [] };
  const ambiguous = [35, 45].map((value, index) => ({
    ...safe,
    factId: `ambiguous-${index}`,
    subject: ambiguousParty,
    measurement: { type: "EXACT", value },
    evidenceReferences: [{ system: "registry", referenceType: "SOURCE_REFERENCE", referenceId: `ambiguous-source-${index}` }],
  }));
  const session = startReviewReplay({ replayRecord: {
    replayId: "mixed-live",
    subject: normalized.subject,
    companyContext: normalized.companyContext,
    discoveryResult: { ...normalized.result, candidateFacts: [safe, ...ambiguous] },
    savedAt: "2026-09-15T08:00:00.000Z",
  } });
  session.sourceState = "LIVE";
  const result = autoReviewDemoSession(session, "2026-09-15T08:01:00.000Z");
  assert.equal(result.demoAutoReview.operativeClaims, 1);
  assert.equal(result.demoAutoReview.unresolvedClaims, 2);
  assert.equal(result.snapshots[0].view.graph.relationships.length, 1);
  assert.equal(result.snapshots[0].view.graph.relationships[0].relationshipType, "ECONOMIC_OWNERSHIP");
});

test("ASDA-style mutually impossible current PSC percentage bands stay disputed without blocking the demo evaluation", () => {
  const normalized = normalizedFixtureInput({ fixtureId: "V2-LAB-01" });
  const template = normalized.result.candidateFacts[0];
  const impossible = ["TDR GP V", "TDR GP III", "TDR GP I"].map((name, index) => ({
    ...template,
    factId: `bellis-75-to-100-${index}`,
    subject: { entityId: `bellis-owner-${index}`, name, entityType: "COMPANY", jurisdiction: "GB", externalIdentifiers: [] },
    measurement: { type: "RANGE", lowerBound: 75, upperBound: 100, lowerInclusive: false, upperInclusive: true },
    evidenceReferences: [{ system: "registry", referenceType: "SOURCE_REFERENCE", referenceId: `companies-house:bellis:psc:${index}` }],
  }));
  const safeVoting = {
    ...template,
    factId: "bellis-safe-voting",
    subject: { entityId: "bellis-voter", name: "Registry Voter", entityType: "NATURAL_PERSON", jurisdiction: "GB", externalIdentifiers: [] },
    relationship: "VOTING_RIGHTS",
    measurement: { type: "EXACT", value: 10 },
    evidenceReferences: [{ system: "registry", referenceType: "SOURCE_REFERENCE", referenceId: "companies-house:bellis:voting" }],
  };
  const session = startReviewReplay({ replayRecord: {
    replayId: "asda-impossible-minimum-live",
    subject: normalized.subject,
    companyContext: normalized.companyContext,
    discoveryResult: { ...normalized.result, candidateFacts: [...impossible, safeVoting] },
    savedAt: "2026-09-15T08:00:00.000Z",
  } });
  session.sourceState = "LIVE";

  const result = autoReviewDemoSession(session, "2026-09-15T08:01:00.000Z");
  assert.equal(result.snapshots.length, 1);
  assert.equal(result.demoAutoReview.operativeClaims, 1);
  assert.equal(result.demoAutoReview.unresolvedClaims, 3);
  assert.deepEqual(result.snapshots[0].view.graph.relationships.map(({ relationshipType }) => relationshipType), ["VOTING_RIGHTS"]);
  assert.equal(result.candidateSources.flatMap(({ candidateFacts }) => candidateFacts).length, 4, "all source assertions remain inspectable");
});

test("an officer role stays unresolved while an exact source-backed combined director right becomes operative without splitting", () => {
  const subject = { name: "Alice", entityType: "NATURAL_PERSON", jurisdiction: "GB", externalIdentifiers: [] };
  const object = { entityId: "target", name: "Target Ltd", entityType: "COMPANY", jurisdiction: "GB", externalIdentifiers: [] };
  const facts = [
    { factId: "officer", type: "RELATIONSHIP", subject, object, relationship: "OFFICER_OF", evidenceReferences: [{ referenceId: "officer-source" }] },
    { factId: "combined", type: "RELATIONSHIP", subject: { ...subject, name: "Bob" }, object, relationship: "FORMAL_CONTROL_RIGHT", qualifiers: { controlConcept: "APPOINT_OR_REMOVE_PERSONS", sourceStatementMode: "COMBINED_ALTERNATIVE", sourceNatureOfControl: "right-to-appoint-and-remove-directors", requiresInterpretation: true }, evidenceReferences: [{ referenceId: "companies-house:target:psc:combined" }] },
    { factId: "generic", type: "RELATIONSHIP", subject: { ...subject, name: "Carol" }, object, relationship: "FORMAL_CONTROL_RIGHT", qualifiers: { requiresInterpretation: true }, evidenceReferences: [{ referenceId: "control-source-generic" }] },
  ];
  const claims = facts.map((fact) => ({ claimId: `claim-${fact.factId}`, currentState: "CANDIDATE", originatingCandidateFact: { candidateFactId: fact.factId }, relationship: fact.relationship }));
  const parties = facts.map((fact, index) => ({ candidatePartyKey: `party-${index}`, claimId: claims[index].claimId, party: fact.subject }));
  const plan = buildPlan({ caseId: "demo", candidateSources: [{ candidateFacts: facts }], decisionTargets: { candidateParties: parties, candidateClaims: claims }, entityDirectory: [{ entityId: "target", party: object }] });
  assert.deepEqual(plan.claimDecisions.map(({ resultingState }) => resultingState), ["DISPUTED", "OPERATIVE", "DISPUTED"]);
});

test("IAG to British Airways and Law Debenture to LDC retain two direct combined control rights through demo review and projection", () => {
  const normalized = normalizedFixtureInput({ fixtureId: "V2-LAB-01" });
  const company = (entityId, name, number) => ({ entityId, name, entityType: "COMPANY", jurisdiction: "GB", externalIdentifiers: [{ namespace: "COMPANIES_HOUSE_COMPANY_NUMBER", value: number }] });
  const ba = company("ba", "BRITISH AIRWAYS PLC", "01777777");
  const iag = company("iag", "INTERNATIONAL CONSOLIDATED AIRLINES GROUP S.A.", "M-492,129");
  const ldc = company("ldc", "LAW DEBENTURE CORPORATE SERVICES LIMITED", "07384180");
  const law = company("law", "THE LAW DEBENTURE CORPORATION P.L.C.", "00030397");
  const evidence = (id) => [{ system: "legacy-ubo-discovery", referenceType: "SOURCE_REFERENCE", referenceId: `companies-house:${id}:psc`, locator: { source: "companies-house" } }];
  const control = (factId, subject, object) => ({
    factId, type: "RELATIONSHIP", subject, object, relationship: "FORMAL_CONTROL_RIGHT",
    qualifiers: { currentState: "CURRENT", controlConcept: "APPOINT_OR_REMOVE_PERSONS", sourceStatementMode: "COMBINED_ALTERNATIVE", sourceNatureOfControl: "right-to-appoint-and-remove-directors", requiresInterpretation: true },
    evidenceReferences: evidence(factId),
  });
  const facts = [
    { factId: "ldc-ba-economic", type: "RELATIONSHIP", subject: ldc, object: ba, relationship: "ECONOMIC_OWNERSHIP", measurement: { type: "EXACT", value: 10 }, qualifiers: { currentState: "CURRENT", economicInterestConcept: "SHARE_OWNERSHIP" }, evidenceReferences: evidence("ldc-ba-economic") },
    control("iag-ba-directors", iag, ba),
    control("law-ldc-directors", law, ldc),
  ];
  const session = startReviewReplay({ replayRecord: {
    replayId: "director-control-two-chain", subject: ba,
    companyContext: { ...normalized.companyContext, legalEntityName: ba.name, registrationNumber: "01777777" },
    discoveryResult: { ...normalized.result, candidateFacts: facts }, savedAt: "2026-09-15T08:00:00.000Z",
  } });
  session.sourceState = "LIVE";
  const result = autoReviewDemoSession(session, "2026-09-15T08:01:00.000Z");
  const graph = result.snapshots[0].view.graph;
  const controls = graph.relationships.filter(({ relationshipType }) => relationshipType === "FORMAL_CONTROL_RIGHT");
  const names = new Map(result.entityDirectory.map(({ entityId, party }) => [entityId, party.name]));
  assert.deepEqual(controls.map((relationship) => `${names.get(relationship.subjectEntityId)}>${names.get(relationship.objectEntityId)}`).sort(), [
    "INTERNATIONAL CONSOLIDATED AIRLINES GROUP S.A.>BRITISH AIRWAYS PLC",
    "THE LAW DEBENTURE CORPORATION P.L.C.>LAW DEBENTURE CORPORATE SERVICES LIMITED",
  ]);
  assert.equal(controls.every((relationship) => relationship.measurement === undefined), true);
  assert.equal(controls.every((relationship) => relationship.qualifiers.sourceStatementMode === "COMBINED_ALTERNATIVE"), true);
  assert.equal(controls.every((relationship) => relationship.support.claimCount === 1), true, "each source assertion remains one claim and one edge");
  assert.equal(result.snapshots[0].view.qualifications.length, 0, "director rights do not create percentage or majority qualification");
});

test("an unqualified legacy ownership label cannot be auto-reviewed as company shares", () => {
  const subject = { name: "Source article holder", entityType: "COMPANY", jurisdiction: "GB", externalIdentifiers: [] };
  const object = { entityId: "target", name: "Target Ltd", entityType: "COMPANY", jurisdiction: "GB", externalIdentifiers: [] };
  const fact = { factId: "unqualified-ownership", type: "RELATIONSHIP", subject, object, relationship: "ECONOMIC_OWNERSHIP", measurement: { type: "EXACT", value: 5.7 }, evidenceReferences: [{ referenceId: "web-source" }] };
  const plan = buildPlan({
    caseId: "demo",
    candidateSources: [{ candidateFacts: [fact] }],
    decisionTargets: { candidateParties: [{ candidatePartyKey: "party", claimId: "claim", party: subject }], candidateClaims: [{ claimId: "claim", originatingCandidateFact: { candidateFactId: fact.factId } }] },
    entityDirectory: [{ entityId: "target", party: object }],
  });
  assert.equal(plan.claimDecisions[0].resultingState, "DISPUTED");
});

test("TDR limited-partnership surplus-asset evidence selects the existing LLP review path without changing source semantics", () => {
  const subject = tdrPscFixture.scenario.context.customer;
  const original = {
    replayId: "tdr-live-company-default",
    subject: { ...subject, entityType: "COMPANY" },
    companyContext: { legalEntityName: subject.name, registrationNumber: "SL035224", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "MEDIUM" },
    discoveryResult: tdrPscFixture.scenario.steps[0].response,
    savedAt: "2026-09-15T08:00:00.000Z",
  };
  const prepared = prepareDemoReplayRecord(original);
  assert.equal(original.companyContext.entityProfile, "COMPANY", "the captured live replay remains unchanged");
  assert.equal(prepared.replayRecord.companyContext.entityProfile, "LLP");
  assert.equal(prepared.replayRecord.replayId, original.replayId, "demo reconciliation retains the original saved-record provenance ID");
  assert.equal(prepared.reconciliation.basis, "SOURCE_BACKED_LLP_SURPLUS_ASSET_RELATIONSHIP");
  const session = startReviewReplay({ replayRecord: prepared.replayRecord });
  session.sourceState = "LIVE";
  session.demoProfileReconciliation = prepared.reconciliation;
  const result = autoReviewDemoSession(session, "2026-09-15T08:01:00.000Z");
  const relationships = result.snapshots[0].view.graph.relationships;
  assert.deepEqual(relationships.map(({ relationshipType }) => relationshipType).sort(), ["ECONOMIC_OWNERSHIP", "FORMAL_CONTROL_RIGHT", "SIGNIFICANT_INFLUENCE_OR_CONTROL"]);
  assert.deepEqual(relationships.find(({ relationshipType }) => relationshipType === "ECONOMIC_OWNERSHIP").measurement, {
    type: "RANGE", lowerBound: 75, upperBound: 100, lowerInclusive: true, upperInclusive: true,
  });
  const combined = relationships.find(({ relationshipType }) => relationshipType === "FORMAL_CONTROL_RIGHT");
  assert.equal(combined.measurement, undefined, "a non-percentage right must not manufacture a value");
  assert.equal(combined.qualifiers.sourceStatementMode, "COMBINED_ALTERNATIVE", "one combined source assertion stays combined");
  assert.equal(result.demoAutoReview.unresolvedClaims, 0, "the recorded right is operative while its policy scope remains separately reviewable");
  assert.equal(result.demoAutoReview.profileReconciliation.effectiveProfile, "LLP");
});

test("demo reconciliation prefers the source-backed registry legal form over Screen 1 context", () => {
  const subject = { entityId: "target", name: "TDR CAPITAL GENERAL PARTNER V L.P.", entityType: "COMPANY", jurisdiction: "GB", externalIdentifiers: [{ namespace: "COMPANIES_HOUSE_COMPANY_NUMBER", value: "SL035224" }] };
  const fact = {
    factId: "registry-profile-source",
    type: "RELATIONSHIP",
    subject: { name: "TDR CAPITAL LLP", entityType: "LLP", jurisdiction: "GB", externalIdentifiers: [{ namespace: "legacy-company-register:GB", value: "OC302604" }] },
    relationship: "SIGNIFICANT_INFLUENCE_OR_CONTROL",
    object: { ...subject, entityType: "LLP" },
    qualifiers: { objectRegistryCompanyType: "limited-partnership", objectRegistryLegalForm: "Limited partnership / PFLP", currentState: "CURRENT" },
    evidenceReferences: [{ referenceId: "companies-house:SL035224:psc:0" }],
  };
  const original = {
    replayId: "registry-profile-replay",
    subject,
    companyContext: { legalEntityName: subject.name, registrationNumber: "SL035224", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "MEDIUM" },
    discoveryResult: { contractVersion: "ubo-capability-result-v1", requestId: "registry-profile-request", outcome: { state: "PARTIAL" }, candidateFacts: [fact], operationEvidenceReferences: [], issues: [] },
    savedAt: "2026-09-15T08:00:00.000Z",
  };
  const prepared = prepareDemoReplayRecord(original);
  assert.equal(prepared.replayRecord.companyContext.entityProfile, "LLP");
  assert.equal(prepared.replayRecord.subject.entityType, "LLP");
  assert.equal(prepared.reconciliation.basis, "SOURCE_BACKED_REGISTRY_PROFILE");
  assert.equal(prepared.reconciliation.registryLegalForm, "Limited partnership / PFLP");
  assert.equal(original.companyContext.entityProfile, "COMPANY");
});
