"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CUSTOMER_PROVIDER_TIMEOUT_MS, analyseCustomerOwnershipChart, selectSemanticProvider, statusForEvidenceFailure, validateRequest } = require("../customerOwnershipChartDemo.js");
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
  assert.equal(result.comparison, "NOT_PERFORMED");
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
