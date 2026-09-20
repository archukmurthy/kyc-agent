"use strict";

const { buildA1FixtureGraph, ids: a1 } = require("../a1/fixtures");
const { sha256 } = require("../a1/domain");
const { FixtureSemanticProvider } = require("./providers");
const { runIndependentVerification, runSemanticExtraction } = require("./extractor");
const { validateA3Bundle } = require("./domain");

const ids = Object.freeze({
  runDeterministic: "a3000000-0000-4000-8000-000000000001", runSemantic: "a3000000-0000-4000-8000-000000000002",
  runDerived: "a3000000-0000-4000-8000-000000000003", runUncertain: "a3000000-0000-4000-8000-000000000004",
  runAgreement: "a3000000-0000-4000-8000-000000000005", runDisagreement: "a3000000-0000-4000-8000-000000000006",
  runFailed: "a3000000-0000-4000-8000-000000000007",
  factCompanyName: "a3100000-0000-4000-8000-000000000001", factSemanticName: "a3100000-0000-4000-8000-000000000002",
  factPreviousName: "a3100000-0000-4000-8000-000000000003", factSic: "a3100000-0000-4000-8000-000000000004",
  factDerivedActivity: "a3100000-0000-4000-8000-000000000005", factUncertainAddress: "a3100000-0000-4000-8000-000000000006",
  factAgreement: "a3100000-0000-4000-8000-000000000007", factDisagreement: "a3100000-0000-4000-8000-000000000008",
  verificationAgreement: "a3200000-0000-4000-8000-000000000001", verificationDisagreement: "a3200000-0000-4000-8000-000000000002",
});

const captured = "2026-08-03T09:15:20.123Z";
const monday = "2026-08-03T10:00:00.456Z";
const friday = "2026-08-07T14:30:10.789Z";
const semanticContent = "Registered name: ABC Limited\nFormerly ABC Technology Limited.\nSIC: 62020";
const ambiguousContent = "Registered address: 28 King Street\nAddress: 25 King Street";

function enrichRun(id, artifactId, assetId, mode, name, when, overrides = {}) {
  return { id, assetId, artifactId, extractorType: mode === "ai" ? "semantic" : "deterministic", extractorName: name, extractorVersion: "a3-fixture-v1", schemaReference: "fixture:current-kyb", schemaVersionReference: null, tenantConfigVersion: 1, status: overrides.status || "completed", startedAt: when, completedAt: when, runMetadata: { acceptanceFixture: true }, createdAt: when, executionMode: mode, provider: mode === "ai" ? "fixture-semantic-provider" : null, modelIdentifier: mode === "ai" ? "fixture-model-v1" : null, instructionReference: mode === "ai" ? "a3-semantic-fixture-v1" : "a3-deterministic-fixture-v1", extractionContext: { jurisdiction: "GB", requestedConcepts: ["business_name", "registered_address"], sourcePolicyContext: overrides.sourcePolicyContext || {} }, supportAssessment: overrides.supportAssessment || {}, errorCode: overrides.errorCode || null, errorMessage: overrides.errorMessage || null };
}

function directFact(id, runId, artifactId, concept, value, options = {}) {
  const signals = options.supportSignals || { readability: "clear", grounding: "direct", extractionMethod: options.method || "deterministic", semanticMappingAmbiguity: false, multiplePlausibleValues: false };
  return { id, extractionRunId: runId, artifactId, informationNeedId: options.informationNeedId || null, schemaFieldId: options.schemaFieldId || null, semanticConceptId: concept, requestStatus: options.requestStatus || "requested", groundingType: "direct", factValue: value, rawRepresentation: options.raw || String(value), supportState: options.supportState || "supported", supportSignals: signals, sourcePolicyContext: options.sourcePolicyContext || {}, createdAt: options.createdAt || monday };
}

async function buildA3FixtureBundle() {
  const graph = buildA1FixtureGraph();
  const profileArtifact = graph.artifacts.find((a) => a.id === a1.artifactAugustJson);
  profileArtifact.fixtureContent = Buffer.from(JSON.stringify({ company_name: "ABC Limited", registered_office_address: "25 King Street", sic_codes: ["62020"] }));
  profileArtifact.sizeBytes = profileArtifact.fixtureContent.length; profileArtifact.fingerprintValue = sha256(profileArtifact.fixtureContent); profileArtifact.capturedAt = captured;
  const semanticArtifact = graph.artifacts.find((a) => a.id === a1.artifactPublicDocument);
  semanticArtifact.fixtureContent = Buffer.from(semanticContent); semanticArtifact.sizeBytes = semanticArtifact.fixtureContent.length; semanticArtifact.fingerprintValue = sha256(semanticArtifact.fixtureContent); semanticArtifact.capturedAt = captured;
  const screenshotArtifact = graph.artifacts.find((a) => a.id === a1.artifactAugustScreenshot);
  screenshotArtifact.fixtureContent = Buffer.from(ambiguousContent); screenshotArtifact.sizeBytes = screenshotArtifact.fixtureContent.length; screenshotArtifact.fingerprintValue = sha256(screenshotArtifact.fixtureContent); screenshotArtifact.capturedAt = captured;

  const runs = [
    enrichRun(ids.runDeterministic, a1.artifactAugustJson, a1.assetAugustProfile, "deterministic", "fixture-json-addressable", monday),
    enrichRun(ids.runSemantic, a1.artifactPublicDocument, a1.assetPublicDocument, "ai", "generic-semantic-extractor", monday),
    enrichRun(ids.runDerived, a1.artifactPublicDocument, a1.assetPublicDocument, "deterministic", "uk-sic-fixture-classifier", monday),
    enrichRun(ids.runUncertain, a1.artifactAugustScreenshot, a1.assetAugustProfile, "ai", "generic-semantic-extractor", monday, { sourcePolicyContext: { suppliedTrust: "authoritative" } }),
    enrichRun(ids.runAgreement, a1.artifactPublicDocument, a1.assetPublicDocument, "ai", "independent-semantic-verifier", friday),
    enrichRun(ids.runDisagreement, a1.artifactAugustScreenshot, a1.assetAugustProfile, "ai", "independent-semantic-verifier", friday),
    enrichRun(ids.runFailed, a1.artifactPublicDocument, a1.assetPublicDocument, "ai", "generic-semantic-extractor", friday, { status: "failed", errorCode: "UNREADABLE", errorMessage: "Fixture evidence could not be read", supportAssessment: { state: "not_supported", signals: { readability: "unreadable", grounded: false } } }),
  ];
  graph.extractionRuns.push(...runs);
  const needName = graph.informationNeeds.find((n) => n.requirementId === a1.requirementAugust && n.schemaFieldId === "business_name");
  const needAddress = graph.informationNeeds.find((n) => n.requirementId === a1.requirementAugust && n.schemaFieldId === "registered_address_line1");
  const generated = await runSemanticExtraction(new FixtureSemanticProvider(), { content: semanticContent, requestedConcepts: [{ concept: "business_name", schemaFieldId: "business_name", informationNeedId: needName.id }], extractionContext: { jurisdiction: "GB" }, runId: ids.runSemantic, artifactId: a1.artifactPublicDocument, createdAt: monday, sourcePolicyContext: { suppliedTrust: "company_assertion" }, idFor: (item) => item.requested ? ids.factSemanticName : ids.factPreviousName });
  const agreement = await runIndependentVerification(new FixtureSemanticProvider(), { content: semanticContent, requestedConcepts: [{ concept: "business_name", schemaFieldId: "business_name", informationNeedId: needName.id }], extractionContext: { jurisdiction: "GB", purpose: "independent_verification" }, proposedValue: "not forwarded", runId: ids.runAgreement, artifactId: a1.artifactPublicDocument, createdAt: friday, idFor: () => ids.factAgreement });
  const disagreement = await runIndependentVerification(new FixtureSemanticProvider({ variant: "independent" }), { content: ambiguousContent, requestedConcepts: [{ concept: "registered_address", schemaFieldId: "registered_address_line1", informationNeedId: needAddress.id }], extractionContext: { jurisdiction: "GB", purpose: "independent_verification" }, proposedValue: "not forwarded", runId: ids.runDisagreement, artifactId: a1.artifactAugustScreenshot, createdAt: friday, idFor: () => ids.factDisagreement });
  const facts = [
    directFact(ids.factCompanyName, ids.runDeterministic, a1.artifactAugustJson, "business_name", "ABC Limited", { schemaFieldId: "business_name", informationNeedId: needName.id, raw: '"company_name":"ABC Limited"' }),
    ...generated.facts,
    directFact(ids.factSic, ids.runSemantic, a1.artifactPublicDocument, "uk_sic_code", "62020", { requestStatus: "discovered", raw: "SIC: 62020", sourcePolicyContext: { suppliedTrust: "company_assertion" } }),
    { id: ids.factDerivedActivity, extractionRunId: ids.runDerived, artifactId: a1.artifactPublicDocument, informationNeedId: null, schemaFieldId: null, semanticConceptId: "uk_sic_activity_description", requestStatus: "discovered", groundingType: "derived", factValue: "Information technology consultancy activities", rawRepresentation: null, supportState: "supported_with_qualification", supportSignals: { readability: "clear", grounding: "derived", extractionMethod: "deterministic_classification", semanticMappingAmbiguity: false, multiplePlausibleValues: false }, sourcePolicyContext: {}, createdAt: monday },
    directFact(ids.factUncertainAddress, ids.runUncertain, a1.artifactAugustScreenshot, "registered_address", "28 King Street", { schemaFieldId: "registered_address_line1", informationNeedId: needAddress.id, supportState: "needs_verification", supportSignals: { readability: "degraded", grounding: "direct", extractionMethod: "ai_semantic", semanticMappingAmbiguity: false, multiplePlausibleValues: true }, sourcePolicyContext: { suppliedTrust: "authoritative" } }),
    agreement.facts.find((fact) => fact.requestStatus === "requested"),
    disagreement.facts.find((fact) => fact.requestStatus === "requested"),
  ];
  const bundle = { baseGraph: graph, runArtifacts: runs.map((run) => ({ extractionRunId: run.id, artifactId: run.artifactId, inputRole: "primary", createdAt: run.startedAt })), facts, derivations: [{ derivedFactId: ids.factDerivedActivity, inputFactId: ids.factSic, transformationId: "uk-sic-2007-fixture", transformationVersion: "2026-08-fixture", transformationReference: "fixture://uk-sic/62020", derivedAt: monday, createdAt: monday }], verifications: [
    { id: ids.verificationAgreement, targetExtractionRunId: ids.runSemantic, targetFactId: ids.factSemanticName, verificationExtractionRunId: ids.runAgreement, outcome: "agreement", performedAt: friday, verificationMetadata: { anchoredOnPriorAnswer: false }, createdAt: friday },
    { id: ids.verificationDisagreement, targetExtractionRunId: ids.runUncertain, targetFactId: ids.factUncertainAddress, verificationExtractionRunId: ids.runDisagreement, outcome: "disagreement", performedAt: friday, verificationMetadata: { anchoredOnPriorAnswer: false, winnerSelected: false }, createdAt: friday },
  ] };
  return validateA3Bundle(bundle);
}

function summarizeA3(bundle) {
  const artifacts = new Map(bundle.baseGraph.artifacts.map((a) => [a.id, a]));
  const runs = new Map(bundle.baseGraph.extractionRuns.map((r) => [r.id, r]));
  const acquisitions = new Map(bundle.baseGraph.acquisitions.map((a) => [a.id, a]));
  const assets = new Map(bundle.baseGraph.assets.map((a) => [a.id, a]));
  return { stage: "A3", fixture: true, facts: bundle.facts.map((fact) => { const run = runs.get(fact.extractionRunId); const artifact = artifacts.get(fact.artifactId); const asset = assets.get(artifact.assetId); const acquisition = acquisitions.get(asset.acquisitionId); return { ...fact, source: acquisition.sourceProvider, producer: acquisition.sourceType, evidenceReference: asset.id, artifactReference: artifact.id, evidenceCapturedAt: artifact.capturedAt, extractionStartedAt: run.startedAt, extractionCompletedAt: run.completedAt, extractionMethod: run.executionMode, extractor: { name: run.extractorName, version: run.extractorVersion, provider: run.provider, model: run.modelIdentifier, instructionReference: run.instructionReference } }; }), derivations: bundle.derivations, verifications: bundle.verifications, runs: bundle.baseGraph.extractionRuns.filter((r) => r.id.startsWith("a300")), timeline: { evidenceCapturedAt: captured, firstExtractionAt: monday, laterReExtractionAt: friday }, schemaInformationNeedsUnchanged: bundle.baseGraph.informationNeeds.length, qualifiedOutput: bundle.facts.find((f) => f.supportState === "needs_verification") };
}

module.exports = { buildA3FixtureBundle, ids, summarizeA3 };
