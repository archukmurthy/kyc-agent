"use strict";

const {
  CONSUMER_CONTRACT_VERSION,
  CONTRACT_VERSIONS,
  OPERATION_NAMES,
  normalizeHistoryRequest,
  normalizeInterpretationRequest,
  normalizePackageRequest,
  normalizeReconstructionRequest,
  normalizeResolveRequest,
  normalizeTrustedAuthorization,
  projectArtifactReference,
  projectInterpretationHistory,
  projectInterpretationResult,
  projectOperationRecord,
  projectPackageList,
  projectPackageResult,
  projectReconstruction,
} = require("./contracts");
const { publicError } = require("./errors");

function success(operation, result) { return { contractVersion: CONSUMER_CONTRACT_VERSION, operation, ok: true, result }; }
function failure(operation, error) { return { contractVersion: CONSUMER_CONTRACT_VERSION, operation, ok: false, error: publicError(error) }; }
function operationNotFound() { return Object.assign(new Error("Interpretation operation not found"), { code: "interpretation_operation_not_found", statusCode: 404 }); }
function subjectMismatch() { return Object.assign(new Error("Subject does not match trusted Evidence context"), { code: "subject_context_mismatch", statusCode: 403 }); }

class EvidenceConsumerV1 {
  constructor({ interpretationService, reconstructionService, packageService }) {
    if (!interpretationService?.resolve || !interpretationService?.interpret || !interpretationService?.history) throw new Error("EvidenceConsumerV1 requires the accepted targeted-interpretation service");
    if (!reconstructionService?.reconstructEvidence) throw new Error("EvidenceConsumerV1 requires the accepted reconstruction service");
    if (!packageService?.listAuthorizedPackages || !packageService?.reopenPackage || !packageService?.verifyPackageManifest) throw new Error("EvidenceConsumerV1 requires the accepted Evidence Package service");
    this.interpretationService = interpretationService;
    this.reconstructionService = reconstructionService;
    this.packageService = packageService;
  }

  async execute(operation, work) { try { return success(operation, await work()); } catch (error) { return failure(operation, error); } }
  ensureSubject(authorization, artifacts) {
    if (authorization.subjectReferenceId && artifacts.some((artifact) => artifact.accessClass !== "public" && artifact.subjectReferenceId && artifact.subjectReferenceId !== authorization.subjectReferenceId)) throw subjectMismatch();
  }

  async resolveArtifactReference(trustedAuthorizationContext, consumerRequest) {
    return this.execute("resolveArtifactReference", async () => {
      const authorization = normalizeTrustedAuthorization(trustedAuthorizationContext), request = normalizeResolveRequest(consumerRequest);
      const artifacts = await this.interpretationService.resolve({ artifactIds: [request.artifactId] }, authorization);
      this.ensureSubject(authorization, artifacts);
      return projectArtifactReference(artifacts[0]);
    });
  }

  async interpretArtifacts(trustedAuthorizationContext, consumerRequest) {
    return this.execute("interpretArtifacts", async () => {
      const authorization = normalizeTrustedAuthorization(trustedAuthorizationContext), request = normalizeInterpretationRequest(consumerRequest);
      if (authorization.subjectReferenceId) {
        const artifacts = await this.interpretationService.resolve({ artifactIds: request.artifactIds }, authorization);
        this.ensureSubject(authorization, artifacts);
      }
      return projectInterpretationResult(await this.interpretationService.interpret(request, authorization), publicError);
    });
  }

  async getInterpretationOperation(trustedAuthorizationContext, consumerRequest) {
    return this.execute("getInterpretationOperation", async () => {
      const authorization = normalizeTrustedAuthorization(trustedAuthorizationContext), request = normalizeHistoryRequest(consumerRequest, { operation: true });
      const history = await this.interpretationService.history({ artifactIds: request.artifactIds }, authorization);
      const operation = (history.operations || []).find((item) => item.id === request.operationId);
      if (!operation) throw operationNotFound();
      return projectOperationRecord(operation, publicError);
    });
  }

  async getInterpretationHistory(trustedAuthorizationContext, consumerRequest) {
    return this.execute("getInterpretationHistory", async () => {
      const authorization = normalizeTrustedAuthorization(trustedAuthorizationContext), request = normalizeHistoryRequest(consumerRequest);
      return projectInterpretationHistory(await this.interpretationService.history({ artifactIds: request.artifactIds }, authorization), publicError);
    });
  }

  async reconstructEvidence(trustedAuthorizationContext, consumerRequest) {
    return this.execute("reconstructEvidence", async () => {
      const authorization = normalizeTrustedAuthorization(trustedAuthorizationContext), request = normalizeReconstructionRequest(consumerRequest);
      if (authorization.subjectReferenceId && request.subjectReferenceId && authorization.subjectReferenceId !== request.subjectReferenceId) throw subjectMismatch();
      return projectReconstruction(await this.reconstructionService.reconstructEvidence({ authorizedTenant: authorization.tenantId, authorizedContext: authorization.contextId, subject: request.subjectReferenceId || authorization.subjectReferenceId || null, asOf: request.asOf }));
    });
  }

  async listEvidencePackages(trustedAuthorizationContext, consumerRequest) {
    return this.execute("listEvidencePackages", async () => {
      const authorization = normalizeTrustedAuthorization(trustedAuthorizationContext), request = normalizePackageRequest(consumerRequest, "list");
      if (authorization.subjectReferenceId && authorization.subjectReferenceId !== request.subjectReferenceId) throw subjectMismatch();
      return projectPackageList(await this.packageService.listAuthorizedPackages({ tenantId: authorization.tenantId, contextId: authorization.contextId, subjectReferenceId: request.subjectReferenceId }));
    });
  }

  async reopenEvidencePackage(trustedAuthorizationContext, consumerRequest) {
    return this.execute("reopenEvidencePackage", async () => {
      const authorization = normalizeTrustedAuthorization(trustedAuthorizationContext), request = normalizePackageRequest(consumerRequest, "reopen");
      const result = await this.packageService.reopenPackage({ tenantId: authorization.tenantId, contextId: authorization.contextId, packageId: request.packageId });
      if (authorization.subjectReferenceId && result?.package?.subjectReferenceId !== authorization.subjectReferenceId) throw subjectMismatch();
      return projectPackageResult(result);
    });
  }

  async verifyEvidencePackage(trustedAuthorizationContext, consumerRequest) {
    return this.execute("verifyEvidencePackage", async () => {
      const authorization = normalizeTrustedAuthorization(trustedAuthorizationContext), request = normalizePackageRequest(consumerRequest, "verify");
      const result = await this.packageService.verifyPackageManifest({ tenantId: authorization.tenantId, contextId: authorization.contextId, packageId: request.packageId });
      if (authorization.subjectReferenceId && result?.package?.subjectReferenceId !== authorization.subjectReferenceId) throw subjectMismatch();
      return projectPackageResult(result);
    });
  }
}

function createEvidenceConsumer(dependencies) { return new EvidenceConsumerV1(dependencies); }

module.exports = { CONTRACT_VERSIONS, EvidenceConsumerV1, OPERATION_NAMES, createEvidenceConsumer };
