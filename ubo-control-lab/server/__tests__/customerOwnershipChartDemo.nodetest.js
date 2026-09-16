"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CUSTOMER_PROVIDER_TIMEOUT_MS, analyseCustomerOwnershipChart, buildChartAnalysis, buildSourceGraph, presentation, reevaluateSavedCustomerOwnershipChart, selectSemanticProvider, sourceGraphCoverage, statusForEvidenceFailure, validateRequest } = require("../customerOwnershipChartDemo.js");
const { DIGEST: REVIEWED_BETTERCOMMS_DIGEST } = require("../../fixtures/bettercomms-source-reviewed.js");
const api = require("../../../api/ubo-demo-customer-ownership-chart.js");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function input(overrides = {}) {
  return {
    demoContext: {
      demoCaseId: "demo-case-1",
      referenceCaseId: "CASE-42",
      company: { legalName: "Better Comms VOIP Ltd", registrationNumber: "00123456", countryCode: "GB", countryName: "United Kingdom", ownershipType: "PRIVATE_LIMITED" },
    },
    file: { originalFilename: "ownership-chart.png", declaredMediaType: "image/png", sizeBytes: PNG.length, contentBase64: PNG.toString("base64") },
    ...overrides,
  };
}

function provider(observed) {
  return {
    configuration() { return { provider: "fixture-provider", model: "fixture-v1", instructionReference: "fixture-instruction-v1" }; },
    capabilities() { return { contentKinds: ["image"], maxRequestBytes: 1024 * 1024, mediaTypes: ["image/png"] }; },
    async extract({ artifactInputs, requestedConcepts }) {
      observed.bytes = Buffer.from(artifactInputs[0].verifiedContent);
      observed.concepts = requestedConcepts.map(({ concept }) => concept);
      observed.requestedConcepts = structuredClone(requestedConcepts);
      const artifactId = artifactInputs[0].artifact.id;
      const company = { partyType: "legal_entity", name: "Better Comms VOIP Ltd", jurisdiction: "GB", identifiers: [] };
      const person = { partyType: "natural_person", name: "Mitchell Fortescue", jurisdiction: "GB", identifiers: [] };
      const certValue = (attribute, text, extra = {}) => ({ statementType: "SOURCE_CERTIFICATION_METADATA", subject: company, attribute, text, ...extra });
      const facts = [
        {
          concept: "economic_ownership", value: "75%", raw: "Mitchell Fortescue 75%", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId],
          typedRelationshipCandidate: { directionEstablished: true, relationshipType: "ECONOMIC_OWNERSHIP", subject: person, object: company, value: { kind: "EXACT", measurementType: "percentage", value: 75, unit: "percentage_points" }, temporal: { state: "unknown" }, qualifications: ["economic_interest_concept:SHARE_OWNERSHIP"] },
        },
        { concept: "certification_signer_name", value: certValue("certification_signer_name", "Alex Palmer"), raw: "Alex Palmer ACA", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId] },
        { concept: "certification_signer_postnominal", value: certValue("certification_signer_postnominal", "ACA"), raw: "ACA", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId] },
        { concept: "certification_signer_capacity", value: certValue("certification_signer_capacity", "Management Accountant"), raw: "Management Accountant", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId] },
        { concept: "certification_professional_reference", value: certValue("certification_professional_reference", "ACA No: 5246593", { referenceValue: "5246593" }), raw: "ACA No: 5246593", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId] },
        { concept: "certification_date", value: certValue("certification_date", "05/05/2026", { normalizedDate: "2026-05-05" }), raw: "05/05/2026", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId] },
        { concept: "certification_declaration", value: certValue("certification_declaration", "I certify that this chart is true and correct"), raw: "I certify that this chart is true and correct", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId] },
        { concept: "certification_signature_presence", value: certValue("certification_signature_presence", "Visible signature-like mark"), raw: "Signed", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId] },
      ];
      return {
        facts,
        requestedConceptOutcomes: requestedConcepts.map(({ concept }) => ({ concept, status: facts.some((fact) => fact.concept === concept) ? "found" : "not_found" })),
        completeness: { state: "complete", limitations: [] },
        support: { state: "supported", signals: { readability: "clear" } },
      };
    },
  };
}

test("uploaded bytes pass through R1 integrity, Evidence interpretation and the existing UBO adapter", async () => {
  const observed = {};
  const result = await analyseCustomerOwnershipChart(input(), { provider: provider(observed) });
  assert.deepEqual(observed.bytes, PNG);
  assert.ok(observed.concepts.includes("economic_ownership"));
  assert.match(observed.requestedConcepts.find(({ concept }) => concept === "economic_ownership").description, /every visible connector.*one separate Fact.*typed_relationship.*intermediate layers/i);
  assert.ok(observed.concepts.includes("certification_signer_name"));
  assert.equal(result.artifact.integrityVerified, true);
  assert.equal(result.artifact.persistence, "EPHEMERAL_DEMO_ONLY");
  assert.equal(result.company.registrationNumber, "00123456");
  assert.equal(result.ubo.downstreamDecision, "NOT_PERFORMED");
  assert.ok(["COMPLETE", "PARTIAL"].includes(result.ubo.adapterOutcome.state));
  assert.ok(result.ubo.candidateFactCount >= 2);
  assert.equal(result.certification.status, "FOUND");
  assert.equal(result.certification.signerName, "Alex Palmer");
  assert.equal(result.certification.verificationStatus, "VERIFICATION_REQUIRED");
  assert.equal(result.certification.signerIdentityVerified, false);
  assert.equal(result.owners[0].name, "Mitchell Fortescue");
  assert.equal(result.sourceGraph.contractVersion, "ubo-ownership-graph-projection-v1");
  assert.equal(result.sourceGraph.subject.displayName, "Better Comms VOIP Ltd");
  assert.equal(result.sourceGraph.relationships.length, 1);
  assert.equal(result.sourceCoverage.state, "CONNECTED");
  assert.equal(result.sourceGraph.qualifications.length, 0);
  assert.equal(result.chartAnalysis.contractVersion, "ubo-demo-chart-analysis-v1");
  assert.equal(result.chartAnalysis.state, "EVALUATED");
  assert.ok(result.chartAnalysis.view.graph.relationships.length >= 1);
  assert.equal(result.chartAnalysis.view.qualifications.length, 1);
  const effective = result.chartAnalysis.view.qualificationBases.find(({ route }) => route === "EFFECTIVE_INTEREST");
  assert.equal(effective.assessmentState, "SATISFIED");
  assert.equal(effective.recordedCalculation.value.value, "75");
  assert.equal(effective.orderedPathReferences.length, 1);
  assert.equal(effective.orderedPathReferences[0].contribution.value, "75");
  assert.equal(result.candidateFacts.find((fact) => fact.relationship === "ECONOMIC_OWNERSHIP").measurement.value, 75);
  assert.equal(result.candidateFacts.find((fact) => fact.relationship === "ECONOMIC_OWNERSHIP").qualifiers.currentState, "UNKNOWN");
  assert.equal(result.comparison, "NOT_PERFORMED");
});

test("full assertion presentation preserves zero, registry ranges, unknown values and non-percentage rights", () => {
  const relationship = (factId, relationshipType, measurement) => ({
    factId, type: "RELATIONSHIP", relationship: relationshipType,
    subject: { name: "Alice" }, object: { name: "Example Ltd" }, ...(measurement ? { measurement } : {}),
    qualifiers: { currentState: "CURRENT" }, evidenceReferences: [{ referenceId: `ref-${factId}` }],
  });
  const assertions = presentation([
    relationship("zero", "ECONOMIC_OWNERSHIP", { type: "EXACT", value: 0 }),
    relationship("range", "VOTING_RIGHTS", { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true }),
    relationship("unknown", "ECONOMIC_OWNERSHIP", { type: "UNKNOWN" }),
    relationship("control", "BOARD_APPOINTMENT_RIGHT"),
  ]).assertions;
  assert.match(assertions[0].statement, /0%/);
  assert.match(assertions[1].statement, /\(25%, 50%\]/);
  assert.match(assertions[2].statement, /percentage not established/);
  assert.match(assertions[3].statement, /non-percentage right/);
  assert.equal(assertions[1].evidenceReferences[0].referenceId, "ref-range");
});

test("chart-only analysis uses the shared engine for direct plus indirect ownership paths", () => {
  const party = (name, entityType, id) => ({ name, entityType, jurisdiction: "GB", externalIdentifiers: [{ namespace: entityType === "NATURAL_PERSON" ? "DEMO_PERSON" : "COMPANIES_HOUSE_COMPANY_NUMBER", value: id, jurisdiction: "GB" }], sourcePartySnapshot: {} });
  const alice = party("Alice Morgan", "NATURAL_PERSON", "ALICE-1");
  const holdco = party("Overseas HoldCo", "LEGAL_ENTITY", "HOLDCO-1");
  const subject = party("Example Trading Ltd", "LEGAL_ENTITY", "DEMO0028");
  const relationship = (factId, from, to, value) => ({ factId, type: "RELATIONSHIP", subject: from, relationship: "ECONOMIC_OWNERSHIP", object: to, measurement: { type: "EXACT", value }, qualifiers: { currentState: "CURRENT", economicInterestConcept: "SHARE_OWNERSHIP" }, evidenceReferences: [{ system: "evidence-platform-v1", referenceType: "ARTIFACT", referenceId: "artifact-alice" }] });
  const analysis = buildChartAnalysis({
    candidateFacts: [relationship("direct", alice, subject, 10), relationship("upper", alice, holdco, 60), relationship("lower", holdco, subject, 30)],
    operationEvidenceReferences: [], issues: [],
    company: { legalName: "Example Trading Ltd", registrationNumber: "DEMO0028", countryCode: "GB", ownershipType: "PRIVATE_LIMITED" },
    artifact: { artifactId: "artifact-alice", capturedAt: "2026-09-16T10:00:00.000Z" }, requestId: "chart-alice",
  });
  assert.equal(analysis.state, "EVALUATED");
  assert.equal(analysis.view.graph.relationships.length, 3);
  const aliceAssessment = analysis.view.qualifications.find((item) => item.personEntityId !== analysis.view.graph.subjectEntityId);
  assert.ok(aliceAssessment);
  const effective = analysis.view.qualificationBases.find((item) => item.personEntityId === aliceAssessment.personEntityId && item.route === "EFFECTIVE_INTEREST");
  assert.equal(effective.recordedCalculation.value.type, "EXACT");
  assert.equal(effective.recordedCalculation.value.value, "28");
  assert.equal(effective.orderedPathReferences.length, 2);
});

test("chart-only analysis preserves ownership with no explicit share basis without crashing evaluation", () => {
  const evidenceReferences = [{ system: "evidence-platform-v1", referenceType: "ARTIFACT", referenceId: "artifact-provisional" }];
  const analysis = buildChartAnalysis({
    candidateFacts: [{
      factId: "provisional-ownership",
      type: "RELATIONSHIP",
      subject: { name: "Alice Morgan", entityType: "UNKNOWN_OR_OTHER", sourcePartySnapshot: {} },
      relationship: "ECONOMIC_OWNERSHIP",
      object: { name: "Vodafone Limited", entityType: "UNKNOWN_OR_OTHER", sourcePartySnapshot: {} },
      measurement: { type: "EXACT", value: 30 },
      qualifiers: { currentState: "CURRENT" },
      evidenceReferences,
    }],
    operationEvidenceReferences: evidenceReferences,
    issues: [],
    company: { legalName: "Vodafone Limited", registrationNumber: "01471587", countryCode: "GB", ownershipType: "PRIVATE_LIMITED" },
    artifact: { artifactId: "artifact-provisional", capturedAt: "2026-09-16T10:00:00.000Z" },
    requestId: "chart-provisional",
  });
  assert.equal(analysis.state, "EVALUATED");
  assert.equal(analysis.provisionalDecisions.operativeClaims, 0);
  assert.equal(analysis.provisionalDecisions.unresolvedClaims, 1);
  assert.equal(analysis.view.graph.relationships.length, 0);
});

test("source visualization groups repeated chart names without inventing a UBO conclusion", () => {
  const company = { legalName: "Vodafone Limited", countryCode: "GB" };
  const party = (name, entityType = "LEGAL_ENTITY") => ({ name, entityType, externalIdentifiers: [], sourcePartySnapshot: {} });
  const relationship = (factId, subject, type, object, value) => ({
    factId,
    type: "RELATIONSHIP",
    subject,
    relationship: type,
    object,
    ...(value === undefined ? {} : { measurement: { type: "EXACT", value } }),
    qualifiers: { currentState: "UNKNOWN" },
    evidenceReferences: [{ system: "evidence-platform-v1", referenceType: "ARTIFACT", referenceId: "artifact-1" }],
  });
  const alice = party("Alice Morgan", "NATURAL_PERSON");
  const vodafoneThree = party("Vodafone Three Holdings Ltd");
  const vodafone = party("Vodafone Limited");
  const international = party("Vodafone International Holdings BV");
  const graph = buildSourceGraph([
    relationship("fact-1", international, "ECONOMIC_OWNERSHIP", vodafoneThree, 80),
    relationship("fact-2", alice, "ECONOMIC_OWNERSHIP", vodafoneThree, 20),
    relationship("fact-3", vodafoneThree, "ECONOMIC_OWNERSHIP", vodafone, 80),
    relationship("fact-4", alice, "ECONOMIC_OWNERSHIP", vodafone, 10),
    relationship("fact-5", alice, "VOTING_RIGHTS", vodafone, 10),
    relationship("fact-6", alice, "FORMAL_CONTROL_RIGHT", vodafone),
  ], company, { artifactId: "artifact-1", digest: "abc123", capturedAt: "2026-09-16T00:00:00.000Z" }, "request-1");
  const aliceNode = graph.nodes.filter(({ displayName }) => displayName === "Alice Morgan");
  const aliceRelationships = graph.relationships.filter(({ sourceEntityId }) => sourceEntityId === aliceNode[0].entityId);
  assert.equal(aliceNode.length, 1);
  assert.deepEqual(aliceRelationships.map(({ dimension }) => dimension).sort(), ["CONTROL", "ECONOMIC", "ECONOMIC", "VOTING"]);
  assert.equal(graph.qualifications.length, 0);
  assert.equal(graph.calculations.length, 0);
  assert.equal(graph.decision.terminalOutcome, "NOT_PERFORMED");
});

test("Bettercomms chart-local identities produce separate 75 and 25 percent effective-ownership results without altering source facts", () => {
  const party = (name, entityType) => ({ name, entityType, jurisdiction: "GB", externalIdentifiers: [], sourcePartySnapshot: {} });
  const mitchell = party("Mitchell Fortescue", "NATURAL_PERSON");
  const lee = party("Lee Taylor", "NATURAL_PERSON");
  const holdco = party("Better Holdco", "LEGAL_ENTITY");
  const subject = party("Better Comms VOIP Ltd", "LEGAL_ENTITY");
  const relationship = (factId, from, to, value) => ({
    factId, type: "RELATIONSHIP", subject: from, relationship: "ECONOMIC_OWNERSHIP", object: to,
    measurement: { type: "EXACT", value },
    qualifiers: { currentState: "UNKNOWN", economicInterestConcept: "SHARE_OWNERSHIP" },
    evidenceReferences: [{ system: "evidence-platform-v1", referenceType: "ARTIFACT", referenceId: "artifact-bettercomms" }],
  });
  const candidateFacts = [
    relationship("mitchell-holdco", mitchell, holdco, 75),
    relationship("lee-holdco", lee, holdco, 25),
    relationship("holdco-subject", holdco, subject, 100),
  ];
  const analysis = buildChartAnalysis({
    candidateFacts,
    operationEvidenceReferences: [], issues: [],
    company: { legalName: "BETTER COMMS (VOIP) LTD", registrationNumber: "14605186", countryCode: "GB", ownershipType: "PRIVATE_LIMITED" },
    artifact: { artifactId: "artifact-bettercomms", capturedAt: "2026-09-16T10:00:00.000Z" }, requestId: "chart-bettercomms",
  });
  const byName = Object.fromEntries(Object.entries(analysis.entityLabels).map(([entityId, name]) => [name, entityId]));
  const basisFor = (name) => analysis.view.qualificationBases.find((basis) => basis.personEntityId === byName[name] && basis.route === "EFFECTIVE_INTEREST");
  const qualificationFor = (name) => analysis.view.qualifications.find((qualification) => qualification.personEntityId === byName[name]);
  const mitchellBasis = basisFor("Mitchell Fortescue");
  const leeBasis = basisFor("Lee Taylor");
  assert.equal(mitchellBasis.recordedCalculation.value.type, "EXACT");
  assert.equal(mitchellBasis.recordedCalculation.value.value, "75");
  assert.equal(mitchellBasis.assessmentState, "SATISFIED");
  assert.equal(qualificationFor("Mitchell Fortescue").routeStatus, "ROUTE_SATISFIED");
  assert.equal(leeBasis.recordedCalculation.value.type, "EXACT");
  assert.equal(leeBasis.recordedCalculation.value.value, "25");
  assert.equal(leeBasis.assessmentState, "NOT_SATISFIED");
  assert.notEqual(qualificationFor("Lee Taylor").routeStatus, "ROUTE_SATISFIED");
  assert.equal(mitchellBasis.orderedPathReferences[0].relationshipIds.length, 2);
  assert.equal(leeBasis.orderedPathReferences[0].relationshipIds.length, 2);
  assert.equal(candidateFacts.every((fact) => fact.qualifiers.currentState === "UNKNOWN"), true);
  assert.equal(candidateFacts.some((fact) => fact.subject.entityId || fact.object.entityId), false);
});

test("saved structured chart facts re-enter the shared engine without document bytes or a provider call", () => {
  const party = (name, entityType, id) => ({ name, entityType, jurisdiction: "GB", externalIdentifiers: [{ namespace: entityType === "NATURAL_PERSON" ? "DEMO_PERSON" : "COMPANIES_HOUSE_COMPANY_NUMBER", value: id, jurisdiction: "GB" }], sourcePartySnapshot: {} });
  const alice = party("Alice Morgan", "NATURAL_PERSON", "ALICE-1");
  const holdco = party("Overseas HoldCo", "LEGAL_ENTITY", "HOLDCO-1");
  const subject = party("Example Trading Ltd", "LEGAL_ENTITY", "DEMO0028");
  const relationship = (factId, from, to, value) => ({ factId, type: "RELATIONSHIP", subject: from, relationship: "ECONOMIC_OWNERSHIP", object: to, measurement: { type: "EXACT", value }, qualifiers: { currentState: "CURRENT", economicInterestConcept: "SHARE_OWNERSHIP" }, evidenceReferences: [{ system: "evidence-platform-v1", referenceType: "ARTIFACT", referenceId: "artifact-alice" }] });
  const savedResult = {
    contractVersion: "ubo-demo-customer-ownership-chart-result-v1",
    company: { legalName: "Example Trading Ltd", registrationNumber: "DEMO0028", countryCode: "GB", ownershipType: "PRIVATE_LIMITED" },
    artifact: { artifactId: "artifact-alice", digest: "abc123", capturedAt: "2026-09-16T10:00:00.000Z" },
    candidateFacts: [relationship("direct", alice, subject, 10), relationship("upper", alice, holdco, 60), relationship("lower", holdco, subject, 30)],
    ubo: { operationEvidenceReferences: [], issues: [] },
    chartAnalysis: { state: "EVALUATED", view: { qualifications: [], qualificationBases: [] } },
  };
  const refreshed = reevaluateSavedCustomerOwnershipChart({
    operation: "REEVALUATE_SAVED_EXTRACTION",
    demoContext: { demoCaseId: "alice-case", company: savedResult.company },
    savedResult,
  });
  const effective = refreshed.chartAnalysis.view.qualificationBases.find(({ route }) => route === "EFFECTIVE_INTEREST");
  assert.equal(effective.recordedCalculation.value.value, "28");
  assert.equal(effective.orderedPathReferences.length, 2);
  assert.equal(JSON.stringify(refreshed).includes("contentBase64"), false);
  assert.deepEqual(savedResult.chartAnalysis.view.qualificationBases, [], "the saved source record is not mutated");
});

test("Bettercomms subject punctuation variant maps to one customer node in source and evaluated graphs", () => {
  const company = { legalName: "BETTER COMMS (VOIP) LTD", registrationNumber: "09000001", countryCode: "GB", ownershipType: "PRIVATE_LIMITED" };
  const holdco = { name: "Better Holdco Limited", entityType: "LEGAL_ENTITY", jurisdiction: "GB", externalIdentifiers: [], sourcePartySnapshot: {} };
  const extractedSubject = { name: "Better Comms VOIP Ltd", entityType: "LEGAL_ENTITY", jurisdiction: "GB", externalIdentifiers: [], sourcePartySnapshot: {} };
  const candidateFact = {
    factId: "better-holdco-to-comms",
    type: "RELATIONSHIP",
    subject: holdco,
    relationship: "ECONOMIC_OWNERSHIP",
    object: extractedSubject,
    measurement: { type: "EXACT", value: 100 },
    qualifiers: { currentState: "CURRENT", economicInterestConcept: "SHARE_OWNERSHIP" },
    evidenceReferences: [{ system: "evidence-platform-v1", referenceType: "ARTIFACT", referenceId: "bettercomms-chart" }],
  };
  const artifact = { artifactId: "artifact-bettercomms-punctuation", digest: "abc123", capturedAt: "2026-09-16T00:00:00.000Z" };
  const sourceGraph = buildSourceGraph([candidateFact], company, artifact, "bettercomms-punctuation");
  const analysis = buildChartAnalysis({ candidateFacts: [candidateFact], operationEvidenceReferences: [], issues: [], company, artifact, requestId: "bettercomms-punctuation" });

  assert.equal(sourceGraph.nodes.length, 2);
  assert.equal(sourceGraph.nodes.filter(({ semantics }) => semantics.includes("SUBJECT")).length, 1);
  assert.equal(sourceGraph.relationships[0].targetEntityId, sourceGraph.subject.entityId);
  assert.equal(sourceGraphCoverage(sourceGraph).state, "CONNECTED");
  assert.equal(analysis.view.graph.nodes.length, 2);
  assert.equal(analysis.view.graph.relationships[0].objectEntityId, analysis.view.graph.subjectEntityId);
});

test("a sibling subsidiary does not make a customer-connected Bettercomms chart incomplete", () => {
  const company = { legalName: "BETTER COMMS (VOIP) LTD", registrationNumber: "14605186", countryCode: "GB", ownershipType: "PRIVATE_LIMITED" };
  const party = (name, entityType = "LEGAL_ENTITY") => ({ name, entityType, jurisdiction: "GB", externalIdentifiers: [], sourcePartySnapshot: {} });
  const fact = (factId, subject, object, value) => ({
    factId,
    type: "RELATIONSHIP",
    subject,
    relationship: "ECONOMIC_OWNERSHIP",
    object,
    measurement: { type: "EXACT", value },
    qualifiers: { currentState: "UNKNOWN", economicInterestConcept: "SHARE_OWNERSHIP" },
    evidenceReferences: [{ referenceId: "bettercomms-chart" }],
  });
  const holdco = party("Better Holdco");
  const subject = party("Better Comms VOIP Ltd");
  const graph = buildSourceGraph([
    fact("mitchell-holdco", party("Mitchell Fortescue", "NATURAL_PERSON"), holdco, 75),
    fact("holdco-customer", holdco, subject, 100),
    fact("holdco-sibling", holdco, party("Better Network Services"), 100),
  ], company, { artifactId: "artifact-bettercomms", digest: "abc123", capturedAt: "2026-09-16T00:00:00.000Z" }, "request-bettercomms");

  assert.deepEqual(sourceGraphCoverage(graph), {
    state: "CONNECTED",
    sourceRelationshipCount: 3,
    subjectConnectedRelationshipCount: 2,
    disconnectedRelationshipIds: [],
  });
});

test("a Vodafone source map that stops above the customer is marked incomplete instead of presented as a complete chart", () => {
  const company = { legalName: "Vodafone Limited", countryCode: "GB" };
  const party = (name) => ({ name, entityType: "LEGAL_ENTITY", externalIdentifiers: [], sourcePartySnapshot: {} });
  const graph = buildSourceGraph([{
    factId: "vodafone-group-to-european-investments",
    type: "RELATIONSHIP",
    subject: party("Vodafone Group Plc"),
    relationship: "ECONOMIC_OWNERSHIP",
    object: party("Vodafone European Investments"),
    measurement: { type: "EXACT", value: 100 },
    qualifiers: { currentState: "UNKNOWN" },
    evidenceReferences: [{ referenceId: "vodafone-chart" }],
  }], company, { artifactId: "artifact-vodafone", digest: "abc123", capturedAt: "2026-09-16T00:00:00.000Z" }, "request-vodafone");

  assert.deepEqual(sourceGraphCoverage(graph), {
    state: "REVIEW_REQUIRED",
    sourceRelationshipCount: 1,
    subjectConnectedRelationshipCount: 0,
    disconnectedRelationshipIds: ["vodafone-group-to-european-investments"],
  });
});

test("invalid bytes and unsupported media fail before provider interpretation", () => {
  assert.throws(() => validateRequest(input({ file: { originalFilename: "chart.txt", declaredMediaType: "text/plain", sizeBytes: 3, contentBase64: Buffer.from("bad").toString("base64") } })), /PDF, PNG or JPEG/);
});

test("the exact reviewed Bettercomms digest selects the local source-backed interpretation", () => {
  const selected = selectSemanticProvider(REVIEWED_BETTERCOMMS_DIGEST);
  assert.deepEqual(selected.configuration(), {
    provider: "source-reviewed-bettercomms-fixture",
    model: "none",
    instructionReference: "pr60-recovered-source-review-v1",
  });
  const injected = provider({});
  assert.equal(selectSemanticProvider(REVIEWED_BETTERCOMMS_DIGEST, injected), injected);
});

test("unmatched customer charts receive the dense-chart provider timeout", () => {
  const selected = selectSemanticProvider("unmatched-chart-digest");
  assert.equal(CUSTOMER_PROVIDER_TIMEOUT_MS, 240000);
  assert.equal(selected.timeoutMs, CUSTOMER_PROVIDER_TIMEOUT_MS);
});

test("safe Evidence media failures remain actionable at the customer API boundary", () => {
  assert.equal(statusForEvidenceFailure({ code: "unsupported_media" }), 422);
  assert.equal(statusForEvidenceFailure({ code: "invalid_request" }), 422);
  assert.equal(statusForEvidenceFailure({ code: "provider_timeout" }), 502);
});

test("API handler is POST-only and returns a bounded customer error", async () => {
  const handler = api.createHandler(async () => { throw Object.assign(new Error("provider secret details"), { code: "provider_failed" }); });
  const response = { statusCode: null, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: "GET" }, response);
  assert.equal(response.statusCode, 405);
  await handler({ method: "POST", body: input() }, response);
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.message, "We could not analyse this ownership chart. Please try again.");
  assert.doesNotMatch(JSON.stringify(response.body), /secret details/);
});

test("API dispatches saved-extraction re-evaluation separately from document analysis", async () => {
  let analysisCalls = 0;
  let reevaluationCalls = 0;
  const handler = api.createHandler(async () => { analysisCalls += 1; }, async (body) => { reevaluationCalls += 1; return { contractVersion: body.savedResult.contractVersion }; });
  const response = { statusCode: null, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: "POST", body: { operation: "REEVALUATE_SAVED_EXTRACTION", savedResult: { contractVersion: "saved" } } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.result.contractVersion, "saved");
  assert.equal(analysisCalls, 0);
  assert.equal(reevaluationCalls, 1);
});
