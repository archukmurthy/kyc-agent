"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const PUBLIC_PATH = require("..");
const { CONTRACT_VERSIONS, OPERATION_NAMES, createEvidenceConsumer } = PUBLIC_PATH;
const { buildBettercommsServiceResult, DIGEST, IDS } = require("../__fixtures__/bettercomms");

function authorization(overrides = {}) {
  return { contractVersion: CONTRACT_VERSIONS.trustedAuthorization, tenantId: "consumer-tenant", contextId: IDS.context, callerScope: "consumer:test", actorType: "service", actorId: "contract-test", subjectReferenceId: IDS.subject, ...overrides };
}
function interpretationRequest(overrides = {}) {
  return { contractVersion: CONTRACT_VERSIONS.interpretationRequest, operationKey: "fixture-bettercomms-v1", artifactIds: [IDS.artifact], requestedConcepts: [{ concept: "economic_ownership", description: "Economic ownership" }, { concept: "officer_relationship", description: "Officer relationship" }], extractionContext: { jurisdiction: "GB", language: "en", purpose: "contract verification" }, correlation: { requestId: "fixture-request" }, ...overrides };
}
function serviceHarness(overrides = {}) {
  const calls = { resolve: 0, interpret: 0, history: 0, reconstruct: 0, list: 0, reopen: 0, verify: 0 };
  const interpretationService = {
    async resolve() { calls.resolve += 1; return [{ id: IDS.artifact, assetId: IDS.asset, collectionId: "collection-fixture", representationType: "original_image", mediaType: "image/png", sizeBytes: 4096, capturedAt: "2026-09-08T10:00:00.000Z", assetTitle: "Sanitized ownership chart", evidenceType: "ownership_chart", accessClass: "context_restricted", sourceType: "private_upload", sourceProvider: "authorized_host", sourceLocator: "customer-upload", subjectReferenceId: IDS.subject, subjectDisplayName: "Better Comms VOIP Ltd", fingerprintAlgorithm: "sha256", fingerprintValue: DIGEST, storageProvider: "must-not-leak", storageKey: "secret/key", storageReference: "secret-reference", authorized: true, unstableInternalField: "must-not-leak" }]; },
    async interpret() { calls.interpret += 1; return buildBettercommsServiceResult(); },
    async history() { calls.history += 1; return { providerCalled: false, operations: [{ id: IDS.operation, operationKey: "fixture-bettercomms-v1", status: "completed", startedAt: "2026-09-08T10:00:00.000Z", completedAt: "2026-09-08T10:00:00.000Z", result: buildBettercommsServiceResult() }] }; },
    ...overrides.interpretationService,
  };
  const reconstructionService = { async reconstructEvidence() { calls.reconstruct += 1; return { projectionType: "transient_read_model", availabilityRulesVersion: "evidence-a5a-availability-v1", asOf: "2026-09-08T10:00:00.000Z", authorizedUsing: "current_access_state", context: { id: IDS.context, contextType: "case", externalReference: "fixture-case", subjectReferenceId: IDS.subject, tenantId: "must-not-leak" }, subject: { id: IDS.subject, displayName: "Better Comms VOIP Ltd", identifierScheme: "fixture", identifierValue: "BC-1", jurisdiction: "GB" }, summary: { entryCount: 1, byCategory: { artifact: 1 } }, entries: [{ category: "artifact", event: "artifact_preserved", occurredAt: "2026-09-08T10:00:00.000Z", availableAt: "2026-09-08T10:00:00.000Z", sourceRecordType: "evidence_artifact", evidenceReference: { type: "evidence_artifact", id: IDS.artifact }, summary: "Artifact preserved", status: "available", contextId: IDS.context, subjectReferenceId: IDS.subject, details: { assetId: IDS.asset, representationType: "original_image", mediaType: "image/png", sizeBytes: 4096, sha256: DIGEST, capturedAt: "2026-09-08T10:00:00.000Z", storageKey: "must-not-leak", newInternalProperty: "must-not-leak" }, limitations: [] }], limitations: [], downstreamDecision: { qualification: "Not reconstructed unless separately integrated" } }; }, ...overrides.reconstructionService };
  const packageRow = { id: "40000000-0000-4000-8000-000000000001", contextId: IDS.context, subjectReferenceId: IDS.subject, purposeCode: "regulatory_reconstruction", purposeLabel: null, asOf: "2026-09-08T10:00:00.000Z", frozenAt: "2026-09-08T10:01:00.000Z", manifestVersion: "evidence-package-manifest-v1", canonicalizationVersion: "evidence-package-canonical-json-v1", manifestFingerprintAlgorithm: "sha256", manifestFingerprintValue: DIGEST, limitations: [], storageKey: "must-not-leak" };
  const packageResult = { package: packageRow, manifest: { manifestVersion: "evidence-package-manifest-v1", canonicalizationVersion: "evidence-package-canonical-json-v1", package: { id: packageRow.id, contextId: IDS.context, subjectReferenceId: IDS.subject, purpose: { code: packageRow.purposeCode }, asOf: packageRow.asOf, frozenAt: packageRow.frozenAt, availabilityRulesVersion: "evidence-a5a-availability-v1" }, context: { id: IDS.context, contextType: "case", externalReference: "fixture-case" }, subject: { id: IDS.subject, displayName: "Better Comms VOIP Ltd", identifierScheme: "fixture", identifierValue: "BC-1", jurisdiction: "GB" }, entries: [], limitations: [], integritySemantics: { manifestSha256: "Manifest bytes only", artifactSha256: "Artifact bytes separately" }, downstreamDecision: {} }, integrity: { verified: true, manifestSha256: DIGEST, evidenceTruthVerified: false }, replayed: false, sideEffects: { sourceCall: false, providerCall: false, a4aRecalculation: false, a4bRecalculation: false, a5aReconstruction: false, writes: false } };
  const packageService = {
    async listAuthorizedPackages() { calls.list += 1; return { packages: [packageRow], sideEffects: packageResult.sideEffects }; },
    async reopenPackage() { calls.reopen += 1; return packageResult; },
    async verifyPackageManifest() { calls.verify += 1; return { package: packageRow, integrity: packageResult.integrity, sideEffects: packageResult.sideEffects }; },
    ...overrides.packageService,
  };
  return { calls, consumer: createEvidenceConsumer({ interpretationService, reconstructionService, packageService }) };
}

test("the single public V1 path has exact frozen exports, operations and accepted vocabulary versions", () => {
  assert.deepEqual(Object.keys(PUBLIC_PATH).sort(), ["CONSUMER_CONTRACT_VERSION", "CONTRACT_VERSIONS", "ERROR_CODES", "OPERATION_NAMES", "createEvidenceConsumer"].sort());
  assert.deepEqual(OPERATION_NAMES, ["resolveArtifactReference", "interpretArtifacts", "getInterpretationOperation", "getInterpretationHistory", "reconstructEvidence", "listEvidencePackages", "reopenEvidencePackage", "verifyEvidencePackage"]);
  assert.equal(CONTRACT_VERSIONS.consumer, "evidence-consumer-v1"); assert.equal(CONTRACT_VERSIONS.relationship, "evidence-relationship-v1");
  assert.equal(CONTRACT_VERSIONS.packageManifest, "evidence-package-manifest-v1"); assert.equal(CONTRACT_VERSIONS.packageCanonicalization, "evidence-package-canonical-json-v1");
  const source = ["index.js", "facade.js", "contracts.js", "errors.js"].map((name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8")).join("\n");
  assert.doesNotMatch(source, /api[\\/]evidence/i); assert.doesNotMatch(source, /[\\/]ubo[\\/]|require\([^)]*ubo/i);
});

test("the deterministic Bettercomms fixture exposes six durable, serializable relationships without business conclusions", async () => {
  const { consumer, calls } = serviceHarness();
  const envelope = await consumer.interpretArtifacts(authorization(), interpretationRequest());
  assert.equal(envelope.ok, true); assert.equal(envelope.contractVersion, "evidence-consumer-v1"); assert.equal(calls.interpret, 1);
  const facts = envelope.result.responsiveFacts;
  assert.equal(facts.length, 6); assert.equal(envelope.result.typedRelationshipCount, 6);
  assert.deepEqual([...new Set(facts.flatMap((fact) => fact.supportingArtifactIds))], [IDS.artifact]);
  assert.equal(new Set(facts.map((fact) => fact.factId)).size, 6);
  assert.deepEqual(facts.slice(0, 4).map((fact) => fact.typedRelationship.value.exact), [75, 25, 100, 100]);
  assert.deepEqual(facts.slice(0, 4).map((fact) => fact.typedRelationship.value.unit), ["percentage_points", "percentage_points", "percentage_points", "percentage_points"]);
  assert.deepEqual(facts.slice(4).map((fact) => fact.typedRelationship.value.qualitative), ["Managing Director", "Commercial Director"]);
  assert.ok(facts.every((fact) => fact.typedRelationship.temporal.state === "unknown" && fact.supportLocators.length === 1));
  assert.equal(envelope.result.evidence.artifacts[0].integrity.value, DIGEST);
  const serialized = JSON.stringify(envelope); assert.equal(JSON.parse(serialized).result.responsiveFacts.length, 6);
  for (const forbidden of ["isUbo", "thresholdPassed", "qualifyingPerson", "operativeClaim", "policySatisfied", "customerAction", "storageKey", "storageReference", "credentials"]) assert.equal(serialized.includes(forbidden), false);
});

test("relationship DTOs preserve exact, range, qualitative and unknown value kinds", async () => {
  const result = buildBettercommsServiceResult();
  const facts = result.responsiveFacts.slice(0, 4);
  facts[0].typedRelationship.value = { kind: "EXACT", measurementType: "count_of_total", numerator: 2, denominator: 3, unit: "shares" };
  facts[1].typedRelationship.value = { kind: "RANGE", measurementType: "percentage", lower: 25, upper: 50, lowerInclusive: false, upperInclusive: true, unit: "percentage_points" };
  facts[2].typedRelationship.value = { kind: "QUALITATIVE", measurementType: "qualitative", qualitative: "Controlling member", unit: null };
  facts[3].typedRelationship.value = { kind: "UNKNOWN", measurementType: "none", unit: null };
  result.typedRelationshipCount = 4;
  const { consumer } = serviceHarness({ interpretationService: { async interpret() { return result; } } });
  const envelope = await consumer.interpretArtifacts(authorization(), interpretationRequest());
  const values = envelope.result.responsiveFacts.slice(0, 4).map((fact) => fact.typedRelationship.value);
  assert.deepEqual(values.map((value) => value.kind), ["EXACT", "RANGE", "QUALITATIVE", "UNKNOWN"]);
  assert.deepEqual([values[0].numerator, values[0].denominator], [2, 3]); assert.deepEqual([values[1].lower, values[1].upper, values[1].lowerInclusive, values[1].upperInclusive], [25, 50, false, true]);
  assert.equal(values[2].qualitative, "Controlling member"); assert.equal(values[3].exact, null);
});

test("request data cannot grant access and Artifact resolution strips storage and unknown internals", async () => {
  const { consumer } = serviceHarness();
  const resolved = await consumer.resolveArtifactReference(authorization(), { contractVersion: CONTRACT_VERSIONS.artifactReference, artifactId: IDS.artifact });
  assert.equal(resolved.ok, true); assert.equal(resolved.result.artifactId, IDS.artifact); assert.equal(resolved.result.integrity.verified, null);
  const serialized = JSON.stringify(resolved); assert.doesNotMatch(serialized, /secret|storageProvider|storageKey|storageReference|unstableInternalField/);
  const forged = await consumer.resolveArtifactReference(authorization(), { contractVersion: CONTRACT_VERSIONS.artifactReference, artifactId: IDS.artifact, tenantId: "forged" });
  assert.equal(forged.ok, false); assert.equal(forged.error.code, "invalid_request");
});

test("history and one-operation reopening are read-only and make no provider call", async () => {
  const { consumer, calls } = serviceHarness();
  const request = { contractVersion: CONTRACT_VERSIONS.interpretationHistory, artifactIds: [IDS.artifact] };
  const history = await consumer.getInterpretationHistory(authorization(), request);
  const operation = await consumer.getInterpretationOperation(authorization(), { ...request, operationId: IDS.operation });
  assert.equal(history.ok, true); assert.equal(history.result.operations.length, 1); assert.equal(history.result.providerCalled, false);
  assert.equal(operation.ok, true); assert.equal(operation.result.operation.id, IDS.operation);
  assert.deepEqual(calls, { resolve: 0, interpret: 0, history: 2, reconstruct: 0, list: 0, reopen: 0, verify: 0 });
});

test("A5a reconstruction and A5b list/reopen/verify remain bounded and do not recompute", async () => {
  const { consumer, calls } = serviceHarness();
  const reconstruction = await consumer.reconstructEvidence(authorization(), { contractVersion: CONTRACT_VERSIONS.reconstruction, subjectReferenceId: IDS.subject, asOf: "2026-09-08T10:00:00.000Z" });
  const list = await consumer.listEvidencePackages(authorization(), { contractVersion: CONTRACT_VERSIONS.package, subjectReferenceId: IDS.subject });
  const packageId = list.result.packages[0].packageId;
  const reopened = await consumer.reopenEvidencePackage(authorization(), { contractVersion: CONTRACT_VERSIONS.package, packageId });
  const verified = await consumer.verifyEvidencePackage(authorization(), { contractVersion: CONTRACT_VERSIONS.package, packageId });
  assert.equal(reconstruction.ok, true); assert.equal(reconstruction.result.sideEffects.writes, false); assert.equal(reconstruction.result.entries[0].details.storageKey, undefined);
  assert.equal(reopened.ok, true); assert.equal(reopened.result.sideEffects.a5aReconstruction, false); assert.equal(verified.result.manifest, null); assert.equal(verified.result.integrity.verified, true);
  assert.deepEqual(calls, { resolve: 0, interpret: 0, history: 0, reconstruct: 1, list: 1, reopen: 1, verify: 1 });
  assert.doesNotMatch(JSON.stringify([reconstruction, list, reopened, verified]), /must-not-leak|storageKey/);
});

test("internal failures become stable non-disclosing consumer error envelopes", async () => {
  for (const [internalCode, expected] of [["artifact_access_denied", "access_denied"], ["artifact_storage_unavailable", "artifact_unavailable"], ["artifact_integrity_mismatch", "artifact_integrity_mismatch"], ["unsupported_media_type", "unsupported_media"], ["provider_timeout", "provider_timeout"], ["provider_malformed_output", "malformed_provider_result"], ["cross_asset_interpretation_not_allowed", "cross_asset_selection"], ["idempotency_conflict", "idempotency_conflict"], ["database_persistence_failed", "persistence_failure"], ["package_integrity_failure", "package_integrity_failure"]]) {
    const { consumer } = serviceHarness({ interpretationService: { async resolve() { throw Object.assign(new Error("SELECT secret FROM private_table C:\\secret\\artifact"), { code: internalCode, stack: "credential=secret" }); } } });
    const result = await consumer.resolveArtifactReference(authorization(), { contractVersion: CONTRACT_VERSIONS.artifactReference, artifactId: IDS.artifact });
    assert.equal(result.ok, false); assert.equal(result.error.code, expected); assert.doesNotMatch(JSON.stringify(result), /SELECT|private_table|credential|C:\\\\secret/);
  }
});
