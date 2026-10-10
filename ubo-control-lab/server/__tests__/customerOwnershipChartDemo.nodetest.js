"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CUSTOMER_PROVIDER_TIMEOUT_MS, analyseCustomerOwnershipChart, buildChartAnalysis, buildSourceGraph, deduplicateChartCandidateFacts, presentation, reconcileSourceGraphInventory, reevaluateSavedCustomerOwnershipChart, selectSemanticProvider, sourceGraphCoverage, statusForEvidenceFailure, validateRequest } = require("../customerOwnershipChartDemo.js");
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
      observed.calls = (observed.calls || 0) + 1;
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
          typedRelationshipCandidate: { directionEstablished: true, relationshipType: "ECONOMIC_OWNERSHIP", subject: person, object: company, value: { kind: "EXACT", measurementType: "percentage", value: 75, unit: "percentage_points" }, temporal: { state: "unknown" }, sourceSpecificMetadata: { connectorInventoryId: "connector-1", subjectInventoryId: "party-person", objectInventoryId: "party-company" }, qualifications: ["economic_interest_concept:SHARE_OWNERSHIP"] },
        },
        { concept: "certification_signer_name", value: certValue("certification_signer_name", "Alex Palmer"), raw: "Alex Palmer ACA", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId] },
        { concept: "certification_signer_postnominal", value: certValue("certification_signer_postnominal", "ACA"), raw: "ACA", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId] },
        { concept: "certification_signer_capacity", value: certValue("certification_signer_capacity", "Management Accountant"), raw: "Management Accountant", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId] },
        { concept: "certification_professional_reference", value: certValue("certification_professional_reference", "ACA No: 5246593", { referenceValue: "5246593" }), raw: "ACA No: 5246593", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId] },
        { concept: "certification_date", value: certValue("certification_date", "05/05/2026", { normalizedDate: "2026-05-05" }), raw: "05/05/2026", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId] },
        { concept: "certification_declaration", value: certValue("certification_declaration", "I certify that this chart is true and correct"), raw: "I certify that this chart is true and correct", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId] },
        { concept: "certification_signature_presence", value: certValue("certification_signature_presence", "Visible signature-like mark"), raw: "Signed", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: [artifactId] },
      ];
      facts.forEach((fact) => { fact.supportLocators = [{ artifact_id: artifactId, excerpt: fact.raw, description: fact.raw, locator_method: "fixture", qualified: true }]; });
      return {
        facts,
        requestedConceptOutcomes: requestedConcepts.map(({ concept }) => ({ concept, status: facts.some((fact) => fact.concept === concept) ? "found" : "not_found" })),
        completeness: { state: "complete", limitations: [] },
        ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
        ownershipPartyInventory: [
          { inventoryId: "party-person", visibleLabel: person.name, partyType: person.partyType, disposition: "RELATIONSHIP_ENDPOINT" },
          { inventoryId: "party-company", visibleLabel: company.name, partyType: company.partyType, disposition: "RELATIONSHIP_ENDPOINT" },
        ],
        ownershipConnectorInventory: [{ connectorId: "connector-1", subjectInventoryId: "party-person", objectInventoryId: "party-company", visibleLabel: "75%", percentageText: "75%", disposition: "RELATIONSHIP_MAPPED" }],
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
  assert.equal(result.extractionQuality.state, "EXTRACTION_SUCCESS_COMPLETE", JSON.stringify(result.evidence.ownershipDiagramCompleteness));
  assert.equal(result.extractionQuality.canContinueToQuestions, true);
  assert.equal(observed.calls, 1);
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

test("a locator-only completeness warning does not run a second full chart extraction", async () => {
  const observed = {};
  const completeProvider = provider(observed);
  const partialProvider = {
    configuration: () => completeProvider.configuration(),
    capabilities: () => completeProvider.capabilities(),
    async extract(request) {
      const result = await completeProvider.extract(request);
      return { ...result, completeness: { state: "incomplete", limitations: ["One image locator was not available"] } };
    },
  };
  const result = await analyseCustomerOwnershipChart(input(), { provider: partialProvider });
  assert.equal(observed.calls, 1);
  assert.equal(result.evidence.ownershipDiagramCompleteness.metrics.verificationPassUsed, false);
  assert.equal(result.evidence.ownershipDiagramCompleteness.metrics.unresolvedPartyCount, 0);
  assert.equal(result.evidence.ownershipDiagramCompleteness.metrics.unresolvedConnectorCount, 0);
  assert.equal(result.sourceGraph.relationships.length, 1);
});

test("a complete 40 percent diagram remains COMPLETE when only the single-Artifact page locator is advisory", async () => {
  const observed = {};
  const baseProvider = provider(observed);
  const smokeProvider = {
    configuration: () => baseProvider.configuration(),
    capabilities: () => baseProvider.capabilities(),
    async extract(request) {
      const result = await baseProvider.extract(request);
      result.facts.forEach((fact) => { fact.supportLocators = []; });
      const ownership = result.facts.find(({ concept }) => concept === "economic_ownership");
      ownership.value = "40%";
      ownership.raw = "ALICE MORGAN owns 40% of shares in HIGGS LLP";
      ownership.typedRelationshipCandidate.subject.name = "ALICE MORGAN";
      ownership.typedRelationshipCandidate.object.name = "HIGGS LLP";
      ownership.typedRelationshipCandidate.value.value = 40;
      result.ownershipPartyInventory = [
        { inventoryId: "party-person", visibleLabel: "ALICE MORGAN", partyType: "natural_person", disposition: "RESOLVED" },
        { inventoryId: "party-company", visibleLabel: "HIGGS LLP", partyType: "legal_entity", disposition: "RESOLVED" },
      ];
      result.ownershipConnectorInventory = [{ connectorId: "connector-1", subjectInventoryId: "party-person", objectInventoryId: "party-company", visibleLabel: "OWNS 40% OF SHARES IN", percentageText: "40%", disposition: "RESOLVED" }];
      return result;
    },
  };
  const result = await analyseCustomerOwnershipChart(input({ demoContext: { ...input().demoContext, company: { ...input().demoContext.company, legalName: "HIGGS LLP", registrationNumber: "OC435996", ownershipType: "LLP" } } }), { provider: smokeProvider });
  assert.equal(result.extractionQuality.state, "EXTRACTION_SUCCESS_COMPLETE", JSON.stringify(result.extractionQuality));
  assert.equal(result.extractionQuality.metrics.unresolvedPartyCount, 0);
  assert.equal(result.extractionQuality.metrics.unresolvedConnectorCount, 0);
  assert.equal(result.extractionQuality.canContinueToQuestions, true);
  assert.equal(result.ubo.adapterOutcome.state, "COMPLETE", JSON.stringify(result.ubo.issues));
  assert.equal(result.candidateFacts.filter(({ relationship }) => relationship === "ECONOMIC_OWNERSHIP").length, 1);
  assert.equal(result.candidateFacts.find(({ relationship }) => relationship === "ECONOMIC_OWNERSHIP").measurement.value, 40);
  assert.equal(result.sourceGraph.relationships.length, 1);
  assert.deepEqual(result.evidence.extractionCompleteness.blockingLimitations, []);
  assert.ok(result.evidence.extractionCompleteness.nonBlockingLimitations.some((item) => /valid image source locator/i.test(item)));
});

test("resolution evidence handoff adds only supported fact concepts to the existing Evidence extraction", async () => {
  const observed = {};
  await analyseCustomerOwnershipChart(input({
    evidenceHandoff: {
      contractVersion: "ubo-external-evidence-handoff-v1",
      requestedConcepts: ["NOMINEE_RELATIONSHIP", "RELATIONSHIP_PERCENTAGE", "RELATIONSHIP_CURRENTNESS", "UNSUPPORTED_CONCEPT"],
    },
  }), { provider: provider(observed) });
  assert.ok(observed.concepts.includes("nominee_relationship"));
  assert.ok(observed.concepts.includes("ownership_percentage"));
  assert.ok(observed.concepts.includes("temporal_state"));
  assert.equal(observed.concepts.includes("UNSUPPORTED_CONCEPT"), false);
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

test("a verification-pass copy without a connector ID cannot duplicate a source relationship", () => {
  const party = (name, entityType) => ({ name, entityType, externalIdentifiers: [], sourcePartySnapshot: {} });
  const amelia = party("Amelia Hart", "NATURAL_PERSON");
  const northstar = party("Northstar Aviation Holdings Ltd", "LEGAL_ENTITY");
  const relationship = (factId, connectorInventoryId) => ({
    factId, type: "RELATIONSHIP", subject: amelia, relationship: "ECONOMIC_OWNERSHIP", object: northstar,
    measurement: { type: "EXACT", value: 55 },
    qualifiers: {
      currentState: "UNKNOWN",
      evidenceSourceSpecificMetadata: connectorInventoryId ? { connectorInventoryId } : {},
    },
    evidenceReferences: [{ system: "evidence-platform-v1", referenceType: "ARTIFACT", referenceId: "artifact-ba" }],
  });
  const facts = [relationship("primary", "conn_001"), relationship("verification-copy", null)];
  const deduplicated = deduplicateChartCandidateFacts(facts);
  const graph = buildSourceGraph(deduplicated, { legalName: "British Airways PLC", countryCode: "GB" }, { artifactId: "artifact-ba", digest: "abc", capturedAt: "2026-09-25T09:44:46.000Z" }, "ba-request");
  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0].factId, "primary");
  assert.equal(graph.relationships.length, 1);
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

test("typed source-backed chart percentages identify Alice as a provisional UBO across direct and indirect paths", () => {
  const party = (name, entityType) => ({ name, entityType, jurisdiction: "GB", externalIdentifiers: [], sourcePartySnapshot: {} });
  const alice = party("Alice Morgan", "NATURAL_PERSON");
  const sophia = party("Sophia Patel", "NATURAL_PERSON");
  const vodafone = party("Vodafone Limited", "LEGAL_ENTITY");
  const vodafoneThree = party("Vodafonethree Holdings Limited", "LEGAL_ENTITY");
  const international = party("Vodafone International Operations Limited", "LEGAL_ENTITY");
  const european = party("Vodafone European Investments", "LEGAL_ENTITY");
  const group = party("Vodafone Group Plc", "LEGAL_ENTITY");
  const relationship = (factId, from, to, value) => ({
    factId,
    type: "RELATIONSHIP",
    subject: from,
    relationship: "ECONOMIC_OWNERSHIP",
    object: to,
    measurement: { type: "EXACT", value },
    qualifiers: {
      currentState: "UNKNOWN",
      evidenceRelationshipType: "ECONOMIC_OWNERSHIP",
      evidenceValue: { kind: "EXACT", measurementType: "percentage", exact: value, unit: "percentage_points" },
      evidenceMapping: { method: "provider_structured", id: "chart-provider", version: "1" },
      evidenceSupportState: "needs_verification",
    },
    evidenceReferences: [{ system: "evidence-platform-v1", referenceType: "ARTIFACT", referenceId: "artifact-vodafone" }],
  });
  const candidateFacts = [
    relationship("three-vodafone", vodafoneThree, vodafone, 80),
    relationship("alice-three", alice, vodafoneThree, 20),
    relationship("group-european", group, european, 100),
    relationship("sophia-vodafone", sophia, vodafone, 10),
    relationship("european-international", european, international, 100),
    relationship("alice-vodafone", alice, vodafone, 10),
    relationship("international-three", international, vodafoneThree, 80),
  ];
  const analysis = buildChartAnalysis({
    candidateFacts,
    operationEvidenceReferences: [],
    issues: [],
    company: { legalName: "Vodafone Limited", registrationNumber: "01471587", countryCode: "GB", ownershipType: "PRIVATE_LIMITED" },
    artifact: { artifactId: "artifact-vodafone", capturedAt: "2026-09-17T10:00:00.000Z" },
    requestId: "chart-vodafone",
  });
  const aliceEntityId = Object.entries(analysis.entityLabels).find(([, name]) => name === "Alice Morgan")?.[0];
  const effective = analysis.view.qualificationBases.find((basis) => basis.personEntityId === aliceEntityId && basis.route === "EFFECTIVE_INTEREST");
  const qualification = analysis.view.qualifications.find((item) => item.personEntityId === aliceEntityId);

  assert.equal(analysis.provisionalDecisions.operativeClaims, 7);
  assert.equal(effective.recordedCalculation.value.type, "EXACT");
  assert.equal(effective.recordedCalculation.value.value, "26");
  assert.equal(effective.assessmentState, "SATISFIED");
  assert.equal(effective.orderedPathReferences.length, 2);
  assert.equal(qualification.routeStatus, "ROUTE_SATISFIED");
  assert.equal(candidateFacts.some((fact) => fact.qualifiers.economicInterestConcept), false, "source CandidateFacts remain unchanged");
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

function canonicalParty(name, externalIdentifiers = [], sourcePartyId = null) {
  return { name, entityType: "LEGAL_ENTITY", jurisdiction: "GB", externalIdentifiers, ...(sourcePartyId ? { sourcePartyId } : {}), sourcePartySnapshot: { description: name } };
}

function canonicalRelationship(factId, subject, object) {
  return {
    factId,
    type: "RELATIONSHIP",
    subject,
    relationship: "ECONOMIC_OWNERSHIP",
    object,
    measurement: { type: "EXACT", value: 100 },
    qualifiers: { currentState: "CURRENT", economicInterestConcept: "SHARE_OWNERSHIP" },
    evidenceReferences: [{ system: "evidence-platform-v1", referenceType: "ARTIFACT", referenceId: "canonical-test-chart" }],
  };
}

function canonicalGraph(facts, company = { legalName: "Customer Limited", registrationNumber: "CUSTOMER-1", countryCode: "GB" }) {
  return buildSourceGraph(facts, company, { artifactId: "canonical-test-chart", digest: "canonical123", capturedAt: "2026-09-18T00:00:00.000Z" }, "canonical-test");
}

test("canonical legal-name equality reconciles British Airways PLC with BRITISHAIRWAYS PLC before projection", () => {
  const graph = canonicalGraph([
    canonicalRelationship("owner-to-customer", canonicalParty("Parent Aviation Ltd"), canonicalParty("BRITISHAIRWAYS PLC")),
  ], { legalName: "British Airways PLC", registrationNumber: "01777777", countryCode: "GB" });

  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.relationships[0].targetEntityId, graph.subject.entityId);
  assert.equal(graph.nodes.filter(({ semantics }) => semantics.includes("SUBJECT")).length, 1);
});

test("configured legal-form equality reconciles ABC Holdings Ltd with ABC Holdings Limited", () => {
  const graph = canonicalGraph([
    canonicalRelationship("holdings-ltd", canonicalParty("ABC Holdings Ltd"), canonicalParty("Subsidiary One Ltd")),
    canonicalRelationship("holdings-limited", canonicalParty("ABC Holdings Limited"), canonicalParty("Subsidiary Two Ltd")),
  ]);
  const [first, second] = graph.relationships;

  assert.equal(first.sourceEntityId, second.sourceEntityId);
  assert.equal(graph.nodes.filter(({ sourceAliases = [] }) => sourceAliases.some(({ name }) => name.startsWith("ABC Holdings"))).length, 1);
});

test("duplicate intermediate HoldCo names across Evidence relationships resolve once before nodes are created", () => {
  const graph = canonicalGraph([
    canonicalRelationship("owner-one-holdco", canonicalParty("Owner One Ltd"), canonicalParty("Intermediate HoldCo Ltd")),
    canonicalRelationship("owner-two-holdco", canonicalParty("Owner Two Ltd"), canonicalParty("INTERMEDIATE HOLDCO LIMITED")),
  ]);

  assert.equal(graph.relationships[0].targetEntityId, graph.relationships[1].targetEntityId);
  assert.equal(graph.nodes.filter(({ sourceAliases = [] }) => sourceAliases.some(({ name }) => /intermediate holdco/i.test(name))).length, 1);
});

test("the same company used as relationship target and source keeps one canonical endpoint", () => {
  const facts = [
    canonicalRelationship("parent-to-holdco", canonicalParty("Parent Ltd"), canonicalParty("Formatting HoldCo Ltd")),
    canonicalRelationship("holdco-to-customer", canonicalParty("FORMATTING HOLDCO LIMITED"), canonicalParty("Customer Limited")),
  ];
  const graph = canonicalGraph(facts);

  assert.equal(graph.relationships[0].targetEntityId, graph.relationships[1].sourceEntityId);
  assert.equal(graph.relationships[1].targetEntityId, graph.subject.entityId);

  const analysis = buildChartAnalysis({
    candidateFacts: facts,
    operationEvidenceReferences: [],
    issues: [],
    company: { legalName: "Customer Limited", registrationNumber: "CUSTOMER-1", countryCode: "GB", ownershipType: "PRIVATE_LIMITED" },
    artifact: { artifactId: "canonical-test-chart", digest: "canonical123", capturedAt: "2026-09-18T00:00:00.000Z" },
    requestId: "canonical-analysis-test",
  });
  const parentToHoldco = analysis.view.graph.relationships.find(({ supportingClaimIds }) => supportingClaimIds.some((claimId) => claimId.endsWith(":parent-to-holdco")));
  const holdcoToCustomer = analysis.view.graph.relationships.find(({ supportingClaimIds }) => supportingClaimIds.some((claimId) => claimId.endsWith(":holdco-to-customer")));
  assert.equal(parentToHoldco.objectEntityId, holdcoToCustomer.subjectEntityId);
  assert.equal(holdcoToCustomer.objectEntityId, analysis.view.graph.subjectEntityId);
});

test("a trusted company identifier reconciles formatting-independent names before name equality", () => {
  const graph = canonicalGraph([
    canonicalRelationship("identified-one", canonicalParty("Legacy Name Ltd", [{ namespace: "COMPANY_NUMBER", value: "01234567", jurisdiction: "GB" }]), canonicalParty("Subsidiary One Ltd")),
    canonicalRelationship("identified-two", canonicalParty("Renamed Company Plc", [{ namespace: "COMPANIES_HOUSE_COMPANY_NUMBER", value: "01234567", jurisdiction: "GB" }]), canonicalParty("Subsidiary Two Ltd")),
  ]);

  assert.equal(graph.relationships[0].sourceEntityId, graph.relationships[1].sourceEntityId);
});

test("conflicting trusted company identifiers prevent a same-name merge", () => {
  const graph = canonicalGraph([
    canonicalRelationship("identified-one", canonicalParty("Same Name Ltd", [{ namespace: "COMPANY_NUMBER", value: "11111111", jurisdiction: "GB" }]), canonicalParty("Subsidiary One Ltd")),
    canonicalRelationship("identified-two", canonicalParty("SAME NAME LIMITED", [{ namespace: "COMPANIES_HOUSE_COMPANY_NUMBER", value: "22222222", jurisdiction: "GB" }]), canonicalParty("Subsidiary Two Ltd")),
  ]);

  assert.notEqual(graph.relationships[0].sourceEntityId, graph.relationships[1].sourceEntityId);
});

test("canonicalization does not merge ABC Holdings Ltd with ABC Trading Ltd", () => {
  const graph = canonicalGraph([
    canonicalRelationship("holdings", canonicalParty("ABC Holdings Ltd"), canonicalParty("Subsidiary One Ltd")),
    canonicalRelationship("trading", canonicalParty("ABC Trading Ltd"), canonicalParty("Subsidiary Two Ltd")),
  ]);

  assert.notEqual(graph.relationships[0].sourceEntityId, graph.relationships[1].sourceEntityId);
});

test("canonicalization does not remove the meaningful Holdings token from ABC Holdings Ltd", () => {
  const graph = canonicalGraph([
    canonicalRelationship("abc", canonicalParty("ABC Ltd"), canonicalParty("Subsidiary One Ltd")),
    canonicalRelationship("abc-holdings", canonicalParty("ABC Holdings Ltd"), canonicalParty("Subsidiary Two Ltd")),
  ]);

  assert.notEqual(graph.relationships[0].sourceEntityId, graph.relationships[1].sourceEntityId);
});

test("visibly truncated legal-entity labels remain distinct unless Evidence supplies the same source-party identity", () => {
  const graph = canonicalGraph([
    canonicalRelationship("left-truncated", canonicalParty("Tdr Capital General P...", [], "party-level-4-left"), canonicalParty("Subsidiary One Ltd")),
    canonicalRelationship("middle-truncated", canonicalParty("Tdr Capital General P...", [], "party-level-4-middle"), canonicalParty("Subsidiary Two Ltd")),
    canonicalRelationship("middle-reused", canonicalParty("Tdr Capital General P...", [], "party-level-4-middle"), canonicalParty("Subsidiary Three Ltd")),
  ]);

  assert.notEqual(graph.relationships[0].sourceEntityId, graph.relationships[1].sourceEntityId);
  assert.equal(graph.relationships[1].sourceEntityId, graph.relationships[2].sourceEntityId);
  assert.equal(graph.nodes.filter(({ displayName }) => displayName === "Tdr Capital General P...").length, 2);
  assert.deepEqual(graph.nodes
    .filter(({ displayName }) => displayName === "Tdr Capital General P...")
    .map(({ canonicalResolution }) => canonicalResolution.priority), ["SOURCE_SCOPED_PARTY", "SOURCE_SCOPED_PARTY"]);
});

test("canonical nodes retain literal Evidence labels and endpoint provenance without mutating source facts", () => {
  const facts = [
    canonicalRelationship("parent-to-holdco", canonicalParty("Parent Ltd"), canonicalParty("Evidence HoldCo Ltd")),
    canonicalRelationship("holdco-to-customer", canonicalParty("EVIDENCE HOLDCO LIMITED"), canonicalParty("Customer Limited")),
  ];
  const originalFacts = structuredClone(facts);
  const graph = canonicalGraph(facts);
  const holdco = graph.nodes.find(({ sourceAliases = [] }) => sourceAliases.some(({ name }) => name === "Evidence HoldCo Ltd"));

  assert.ok(holdco);
  assert.deepEqual(holdco.sourceAliases
    .filter(({ provenance }) => provenance.source === "EVIDENCE")
    .map(({ name, provenance }) => ({ name, factId: provenance.factId, endpointRole: provenance.endpointRole })), [
    { name: "Evidence HoldCo Ltd", factId: "parent-to-holdco", endpointRole: "OBJECT" },
    { name: "EVIDENCE HOLDCO LIMITED", factId: "holdco-to-customer", endpointRole: "SUBJECT" },
  ]);
  assert.deepEqual(facts, originalFacts);
});

test("person identity remains on the conservative non-legal-entity path", () => {
  const person = (name) => ({ name, entityType: "NATURAL_PERSON", jurisdiction: "GB", externalIdentifiers: [], sourcePartySnapshot: { description: name } });
  const graph = canonicalGraph([
    canonicalRelationship("alice-one", person("Alice Morgan"), canonicalParty("Subsidiary One Ltd")),
    canonicalRelationship("alice-two", person("Alice M. Morgan"), canonicalParty("Subsidiary Two Ltd")),
  ]);

  assert.notEqual(graph.relationships[0].sourceEntityId, graph.relationships[1].sourceEntityId);
});

test("confirmed zero relationships remains a non-progressable quality outcome rather than ordinary success", async () => {
  const emptyProvider = {
    configuration() { return { provider: "empty-fixture", model: "none", instructionReference: "empty-v1" }; },
    capabilities() { return { contentKinds: ["image"], maxRequestBytes: 1024 * 1024, mediaTypes: ["image/png"] }; },
    async extract({ requestedConcepts }) {
      return {
        facts: [],
        requestedConceptOutcomes: requestedConcepts.map(({ concept }) => ({ concept, status: "not_found" })),
        completeness: { state: "complete", limitations: [] },
        ownershipDataStatus: "NO_OWNERSHIP_RELATIONSHIPS_CONFIRMED",
        ownershipPartyInventory: [],
        ownershipConnectorInventory: [],
      };
    },
  };
  const result = await analyseCustomerOwnershipChart(input(), { provider: emptyProvider });
  assert.equal(result.sourceGraph.relationships.length, 0);
  assert.equal(result.extractionQuality.state, "NO_OWNERSHIP_DATA_CONFIRMED");
  assert.equal(result.extractionQuality.canContinueToQuestions, false);
});

test("same-name natural people remain distinct when Evidence supplies separate source inventory identities", () => {
  const person = (sourcePartyId) => ({ name: "Alex Morgan", entityType: "NATURAL_PERSON", sourcePartyId, jurisdiction: "GB", externalIdentifiers: [], sourcePartySnapshot: { description: "Alex Morgan" } });
  const graph = canonicalGraph([
    canonicalRelationship("alex-one", person("artifact:party-1"), canonicalParty("Subsidiary One Ltd")),
    canonicalRelationship("alex-two", person("artifact:party-2"), canonicalParty("Subsidiary Two Ltd")),
  ]);
  const alexNodes = graph.nodes.filter(({ displayName }) => displayName === "Alex Morgan");
  assert.equal(alexNodes.length, 2);
  assert.notEqual(graph.relationships[0].sourceEntityId, graph.relationships[1].sourceEntityId);
});

test("ASDA-style dense inventory is losslessly split between source graph facts and explicit unresolved items", () => {
  const labels = [
    ["P1", "Mr Gary Lindsay", "natural_person"],
    ["P2", "Mr Thomas Andrew Mitc...", "natural_person"],
    ["P3", "Manjit Dale", "natural_person"],
    ["P4", "Tdr Capital Llp", "legal_entity"],
    ["P5", "Tdr Capital General P... (Level 3 left)", "legal_entity"],
    ["P6", "Tdr Capital Nominees...", "legal_entity"],
    ["P7", "TDR CAPITAL GENERAL P... (Level 4 left)", "legal_entity"],
    ["P8", "Tdr Capital General P... (Level 4 middle)", "legal_entity"],
    ["P9", "Tdr Capital General P... (Level 4 right)", "legal_entity"],
    ["P10", "Bella Finco Plc", "legal_entity"],
    ["P11", "Bella Acquisition Co...", "legal_entity"],
    ["P12", "Asda Group Limited", "legal_entity"],
    ["P13", "Asda Storm Limited", "legal_entity"],
    ["P14", "Alice Morgan", "natural_person"],
    ["P15", "Sophia Patel", "natural_person"],
    ["P16", "Asda Delivery Limited", "legal_entity"],
  ];
  const parties = labels.map(([inventoryId, visibleLabel, partyType]) => ({ inventoryId, visibleLabel, partyType, sourcePartyId: `artifact-asda:${inventoryId}`, providerDisposition: "RESOLVED" }));
  const connectorPairs = [
    ["P1", "P4", "33.33%"], ["P2", "P4", null], ["P3", "P4", null], ["P4", "P5", "100%"], ["P4", "P6", null],
    ["P5 or P6 (unclear)", "P7", "100%"], ["P5 or P6 (unclear)", "P8", null], ["P6 (unclear)", "P9", "100%"],
    ["P8", "P10", null], ["P10", "P11", "100%"], ["P11", "P12", null], ["P12", "P13", null], ["P13", "P16", null],
    ["P14", "P16", "90%"], ["P15", "P16", "5%"],
  ];
  const connectors = connectorPairs.map(([subjectInventoryId, objectInventoryId, percentageText], index) => ({
    connectorId: `C${index + 1}`,
    sourceConnectorId: `artifact-asda:C${index + 1}`,
    subjectInventoryId,
    objectInventoryId,
    visibleLabel: percentageText || "",
    percentageText,
    providerDisposition: index === 6 ? "UNRESOLVED" : "RESOLVED",
  }));
  const unresolvedParties = parties.filter(({ inventoryId }) => !["P1", "P4"].includes(inventoryId)).map((item) => ({ ...item, resolution: "UNRESOLVED_RELATIONSHIP" }));
  const unresolvedRelationships = connectors.slice(1).map((item) => ({ ...item, resolution: "UNRESOLVED_RELATIONSHIP" }));
  const diagram = {
    inventory: { parties, connectors },
    unresolvedParties,
    unresolvedRelationships,
    metrics: { inventoryPartyCount: 16, extractedTypedRelationshipCount: 1, unresolvedPartyCount: 14, unresolvedConnectorCount: 14 },
  };
  const candidateFacts = [{
    factId: "asda-c1",
    type: "RELATIONSHIP",
    subject: { name: "Mr Gary Lindsay", entityType: "NATURAL_PERSON" },
    relationship: "ECONOMIC_OWNERSHIP",
    object: { name: "Tdr Capital Llp", entityType: "LEGAL_ENTITY" },
    measurement: { type: "EXACT", value: 33.33 },
    qualifiers: { currentState: "UNKNOWN", evidenceSourceSpecificMetadata: {} },
    evidenceReferences: [{ system: "evidence-platform-v1", referenceType: "ARTIFACT", referenceId: "artifact-asda" }],
  }];
  const graph = reconcileSourceGraphInventory(buildSourceGraph(candidateFacts, {
    legalName: "Asda Delivery Limited", registrationNumber: "03873501", countryCode: "GB",
  }, { artifactId: "artifact-asda", digest: "asda-digest", capturedAt: "2026-09-16T00:00:00.000Z" }, "asda-regression"), diagram);

  assert.equal(parties.length, 16);
  assert.equal(connectors.length, 15);
  assert.equal(diagram.metrics.extractedTypedRelationshipCount, 1);
  assert.equal(candidateFacts.length, 1);
  assert.equal(graph.nodes.length, 16, "every extracted customer party is represented; the onboarding subject and P16 are one display entity");
  assert.equal(graph.relationships.length, 12, "every connector with structurally determined endpoints is reconstructed");
  assert.equal(graph.relationships.filter(({ calculationEligible }) => calculationEligible !== false).length, 1);
  assert.equal(graph.relationships.filter(({ calculationEligible }) => calculationEligible === false).length, 11);
  assert.deepEqual(
    new Set(graph.nodes.map(({ displayName }) => displayName)),
    new Set(parties.map(({ visibleLabel }) => visibleLabel)),
    "the reconstructed chart contains every extracted customer party",
  );
  assert.deepEqual(
    new Set(graph.relationships.map((edge) => edge.qualifiers?.evidenceSourceSpecificMetadata?.connectorInventoryId)),
    new Set(["C1", "C2", "C3", "C4", "C5", "C9", "C10", "C11", "C12", "C13", "C14", "C15"]),
    "the reconstructed chart contains every connector whose direction and endpoints are structurally determined",
  );
  assert.equal(graph.unresolved.length, 28);
  assert.deepEqual(graph.inventoryReconciliation, {
    contractVersion: "ubo-source-inventory-reconciliation-v2",
    evidencePartyCount: 16,
    evidenceConnectorCount: 15,
    mappedPartyCount: 2,
    mappedCandidateFactCount: 1,
    sourceGraphNodeCount: 16,
    sourceGraphEdgeCount: 12,
    displayOnlyRelationshipCount: 11,
    ambiguousRelationshipCount: 3,
    structurallyDeterminedConnectorCount: 12,
    renderedConnectorCount: 12,
    silentCustomerAssertionLossCount: 0,
    unresolvedPartyCount: 14,
    unresolvedRelationshipCount: 14,
    accountedPartyCount: 16,
    accountedConnectorCount: 15,
    silentPartyLossCount: 0,
    silentConnectorLossCount: 0,
  });
  assert.equal(graph.unresolved.find(({ connectorInventoryId }) => connectorInventoryId === "C7").reasonCode, "PROVIDER_DIRECTION_UNRESOLVED");
  assert.equal(graph.unresolved.filter(({ displayName }) => /Level 4/.test(displayName)).length, 3, "visually similar truncated entities stay explicit and distinct");
  assert.equal(graph.relationships.some(({ sourceEntityId, targetEntityId }) => sourceEntityId === targetEntityId), false);
  const displayOnly = graph.relationships.find(({ relationshipId }) => relationshipId.endsWith(":C2"));
  assert.deepEqual(displayOnly.measurement, { type: "UNKNOWN", reason: "Percentage not established" });
  assert.equal(displayOnly.evidenceStatus, "CUSTOMER_SOURCE_ASSERTION");
  assert.equal(displayOnly.calculationEligible, false);
  const analysis = buildChartAnalysis({
    candidateFacts,
    operationEvidenceReferences: [],
    issues: [],
    company: { legalName: "Asda Delivery Limited", registrationNumber: "03873501", countryCode: "GB", ownershipType: "PRIVATE_LIMITED" },
    artifact: { artifactId: "artifact-asda", capturedAt: "2026-09-16T00:00:00.000Z" },
    requestId: "asda-operative-separation",
  });
  assert.equal(analysis.view.graph.relationships.some(({ relationshipId, supportingClaimIds = [] }) =>
    String(relationshipId).includes("customer-source") || supportingClaimIds.some((id) => String(id).includes("customer-source"))), false,
  "display-only customer assertions never enter the operative chart calculation");
});

test("source graph reconciliation fails closed when a validated Evidence relationship is lost downstream", () => {
  const graph = buildSourceGraph([], { legalName: "Target Limited", countryCode: "GB" }, { artifactId: "artifact-loss", digest: "loss", capturedAt: "2026-09-16T00:00:00.000Z" }, "loss");
  const diagram = {
    inventory: {
      parties: [{ inventoryId: "P1", providerDisposition: "RESOLVED" }, { inventoryId: "P2", providerDisposition: "RESOLVED" }],
      connectors: [{ connectorId: "C1", providerDisposition: "RESOLVED" }],
    },
    unresolvedParties: [],
    unresolvedRelationships: [],
  };
  assert.throws(() => reconcileSourceGraphInventory(graph, diagram), (error) => error.code === "SOURCE_GRAPH_INCOMPLETE" && error.statusCode === 422);
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
  assert.equal(response.body.message, "We couldn't save or analyse this document right now. Please try again.");
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

// A failure Evidence says cannot go differently is not offered for a retry -
// each retry is another paid reading (2026-10-09: the database refusing what
// was read was retried as an outage, three paid readings).
test("a failure Evidence marks as not retryable reaches the job as not retryable", async () => {
  const { publicError } = require("../../../evidence/consumer/v1/errors.js");
  assert.equal(publicError({ code: "database_persistence_rejected" }).retryable, false);
  assert.equal(publicError({ code: "database_persistence_failed" }).retryable, true, "an outage still is");
  const rejecting = { ...provider({}), async extract() { throw Object.assign(new Error("rejected"), { code: "provider_media_rejected" }); } };
  await assert.rejects(analyseCustomerOwnershipChart(input(), { provider: rejecting }), (error) => error.retryable === false);
  const unavailable = { ...provider({}), async extract() { throw Object.assign(new Error("down"), { code: "provider_unavailable" }); } };
  await assert.rejects(analyseCustomerOwnershipChart(input(), { provider: unavailable }), (error) => error.retryable === undefined);
});

// Review, 2026-10-09: Evidence marks failures it has no name for, and readings
// that found nothing, as not retryable; a second attempt can still succeed, so
// the job retries them itself rather than failing and making the customer pay
// for a manual retry.
test("an unclassified failure or an empty reading is left to the job's retry rules", async () => {
  const unknown = { ...provider({}), async extract() { throw Object.assign(new Error("odd"), { code: "something_unmapped" }); } };
  await assert.rejects(analyseCustomerOwnershipChart(input(), { provider: unknown }), (error) => error.retryable === undefined);
});
