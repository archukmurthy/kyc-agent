"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { TargetedInterpretationService } = require("../../../r2/service");
const { CONTRACT_VERSIONS, createEvidenceConsumer } = require("..");

const IDs = { context: "60000000-0000-4000-8000-000000000001", otherContext: "60000000-0000-4000-8000-000000000002", subject: "60000000-0000-4000-8000-000000000003", otherSubject: "60000000-0000-4000-8000-000000000004", privateArtifact: "60000000-0000-4000-8000-000000000005", publicArtifact: "60000000-0000-4000-8000-000000000006", asset: "60000000-0000-4000-8000-000000000007" };
function auth(overrides = {}) { return { contractVersion: CONTRACT_VERSIONS.trustedAuthorization, tenantId: "tenant-a", contextId: IDs.context, callerScope: "consumer:test", actorType: "service", actorId: null, subjectReferenceId: IDs.subject, ...overrides }; }
function request(id) { return { contractVersion: CONTRACT_VERSIONS.artifactReference, artifactId: id }; }

function consumer() {
  const artifacts = {
    [IDs.privateArtifact]: { id: IDs.privateArtifact, assetId: IDs.asset, accessClass: "context_restricted", tenantId: "tenant-a", contextId: IDs.context, subjectReferenceId: IDs.subject, representationType: "original_document", mediaType: "application/pdf", sizeBytes: 10, fingerprintAlgorithm: "sha256", fingerprintValue: "a".repeat(64), storageKey: "private/path" },
    [IDs.publicArtifact]: { id: IDs.publicArtifact, assetId: IDs.asset, accessClass: "public", tenantId: "producer-tenant", contextId: IDs.otherContext, subjectReferenceId: IDs.otherSubject, representationType: "source_response", mediaType: "application/json", sizeBytes: 10, fingerprintAlgorithm: "sha256", fingerprintValue: "b".repeat(64), storageKey: "public/path" },
  };
  const artifactRepository = { async findArtifactForInterpretation({ artifactId, tenantId, contextId }) { const item = artifacts[artifactId]; return item ? { ...item, authorized: item.accessClass === "public" || (item.tenantId === tenantId && item.contextId === contextId) } : null; } };
  const operationRepository = { async claimOperation() { throw new Error("not called"); }, async completeOperation() {}, async failOperation() {}, async listOperations() { return []; } };
  const interpretationService = new TargetedInterpretationService({ repository: operationRepository, artifactRepository, interpreter: { async interpret() { throw new Error("not called"); } } });
  const reconstructionService = { async reconstructEvidence() { throw new Error("not called"); } };
  const packageService = { async listAuthorizedPackages() { throw new Error("not called"); }, async reopenPackage() { throw new Error("not called"); }, async verifyPackageManifest() { throw new Error("not called"); } };
  return createEvidenceConsumer({ interpretationService, reconstructionService, packageService });
}

test("private Artifact tenant/context and subject denial are preserved by the public façade", async () => {
  const facade = consumer();
  assert.equal((await facade.resolveArtifactReference(auth(), request(IDs.privateArtifact))).ok, true);
  const contextDenied = await facade.resolveArtifactReference(auth({ contextId: IDs.otherContext }), request(IDs.privateArtifact));
  assert.equal(contextDenied.ok, false); assert.equal(contextDenied.error.code, "access_denied");
  const subjectDenied = await facade.resolveArtifactReference(auth({ subjectReferenceId: IDs.otherSubject }), request(IDs.privateArtifact));
  assert.equal(subjectDenied.ok, false); assert.equal(subjectDenied.error.code, "access_denied");
});

test("authorized public Evidence remains reusable across consumer tenant/context references", async () => {
  const result = await consumer().resolveArtifactReference(auth(), request(IDs.publicArtifact));
  assert.equal(result.ok, true); assert.equal(result.result.accessClass, "public"); assert.equal(result.result.artifactId, IDs.publicArtifact);
  assert.equal(JSON.stringify(result).includes("storageKey"), false); assert.equal(JSON.stringify(result).includes("public/path"), false);
});
