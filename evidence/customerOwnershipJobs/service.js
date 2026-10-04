"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { PrivateArtifactIngestionService } = require("../r1/service.js");
const { sha256 } = require("../r1/domain.js");
const { OWNERSHIP_CHART_PROFILE, EXTRACTION_QUALITY_STATE } = require("../a3/ownershipChartProfile.js");
const {
  analyseIngestedCustomerOwnershipChart,
  selectSemanticProvider,
  validateRequest,
} = require("../../ubo-control-lab/server/customerOwnershipChartDemo.js");

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_SECONDS = 360;
const TERMINAL_STATES = new Set(["COMPLETE", "PARTIAL", "FAILED"]);
const TRANSIENT_CODES = new Set([
  "provider_failure", "provider_failed", "provider_unavailable", "provider_timeout",
  "artifact_unavailable", "artifact_storage_unavailable", "persistence_failure",
  "database_persistence_failed", "evidence_persistence_failed", "operation_failed",
]);
const DETERMINISTIC_CODES = new Set([
  "provider_request_rejected",
  "malformed_provider_result",
  "provider_malformed_output",
  "evidence_result_not_usable",
  "INVALID_EXPLICIT_DECISION",
  "EVALUATION_PRECONDITION_FAILED",
]);

// ponytail: a fixed bound on fresh readings of one file in one case; each is paid.
const MAX_FRESH_READINGS = 5;

function cacheKey({ digest, profile, provider, modelVersion }) {
  return createHash("sha256").update(JSON.stringify([
    digest,
    profile.profileVersion,
    profile.schemaVersion,
    profile.instructionVersion,
    profile.verificationStrategyVersion,
    provider,
    modelVersion,
  ])).digest("hex");
}

function publicJob(job) {
  if (!job) return null;
  return {
    contractVersion: "evidence-customer-extraction-job-v1",
    jobId: job.id,
    artifactId: job.artifactId,
    demoCaseId: job.demoCaseId || null,
    state: job.state,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    nextAttemptAt: job.nextAttemptAt || null,
    correlationId: job.correlationId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt || null,
    reused: job.reused === true,
    result: TERMINAL_STATES.has(job.state) && job.state !== "FAILED" ? job.result : undefined,
    failure: job.state === "FAILED" ? {
      code: "analysis_temporarily_unavailable",
      message: "We couldn't complete the analysis right now. Your document has been saved safely. Please try again.",
    } : undefined,
  };
}

function retryDelayMs(job) {
  const base = Math.min(8000, 500 * (2 ** Math.max(0, job.attemptCount - 1)));
  const jitter = parseInt(createHash("sha256").update(`${job.id}:${job.attemptCount}`).digest("hex").slice(0, 4), 16) % 251;
  return base + jitter;
}

function reason(error) {
  const code = String(error?.code || "operation_failed");
  const upstreamStatus = Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus
    : Number.isInteger(error?.statusCode) && [408, 429, 500, 502, 503, 504].includes(error.statusCode) ? error.statusCode : null;
  const retryable = !DETERMINISTIC_CODES.has(code) && (error?.retryable === true
    || TRANSIENT_CODES.has(code)
    || upstreamStatus === 408 || upstreamStatus === 429 || (upstreamStatus != null && upstreamStatus >= 500));
  const safeMessage = String(error?.safeReason || error?.message || code).slice(0, 500);
  return { code, upstreamStatus, retryable, safeMessage };
}

const VIEWABLE_MEDIA_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

function artifactFrom(stored, company) {
  return {
    id: stored.artifactId,
    assetId: stored.assetId,
    acquisitionId: stored.acquisitionId,
    collectionId: stored.collectionId,
    collectionProducer: "private_artifact_ingestion",
    representationType: "original_upload",
    mediaType: stored.mediaType,
    storageProvider: stored.storageProvider,
    storageKey: stored.storageKey,
    storageReference: stored.storageReference,
    sizeBytes: stored.sizeBytes,
    fingerprintAlgorithm: "sha256",
    fingerprintValue: stored.fingerprintValue,
    capturedAt: stored.capturedAt,
    artifactMetadata: {}, acquisitionMetadata: {},
    assetTitle: stored.originalFilename,
    evidenceType: "ownership_chart",
    accessClass: stored.accessClass || "context_restricted",
    sourceType: "private_upload",
    sourceProvider: null,
    acquisitionMethod: "authorized_host_upload",
    tenantId: stored.tenantId,
    contextId: stored.contextId,
    subjectReferenceId: stored.subjectReferenceId,
    subjectDisplayName: company.legalName,
    subjectIdentifier: company.registrationNumber,
  };
}

class CustomerOwnershipExtractionJobService {
  constructor({ repository, ingestionRepository, artifactStore, artifactRepository = null, operationRepository = null,
    provider = null, tenantId, modelVersion = process.env.EVIDENCE_A3_ANTHROPIC_MODEL || "claude-sonnet-4-5",
    profile = OWNERSHIP_CHART_PROFILE,
    maxAttempts = DEFAULT_MAX_ATTEMPTS, leaseSeconds = DEFAULT_LEASE_SECONDS,
    now = () => new Date(), analyse = analyseIngestedCustomerOwnershipChart } = {}) {
    // Every job and artifact lookup below is scoped to this workspace. It comes
    // from the signed-in caller; there is no default (it used to be "nium").
    if (!tenantId) throw new Error("CustomerOwnershipExtractionJobService needs the caller's tenant");
    this.repository = repository;
    this.ingestionRepository = ingestionRepository;
    this.artifactStore = artifactStore;
    this.artifactRepository = artifactRepository;
    this.operationRepository = operationRepository;
    this.provider = provider;
    this.tenantId = tenantId;
    this.modelVersion = modelVersion;
    this.profile = profile;
    this.maxAttempts = maxAttempts;
    this.leaseSeconds = leaseSeconds;
    this.now = now;
    this.analyse = analyse;
  }

  async start(rawInput) {
    const input = validateRequest(rawInput);
    const digest = sha256(input.file.bytes);
    const context = await this.repository.ensureContext({ tenantId: this.tenantId, demoCaseId: input.demoContext.demoCaseId, company: input.demoContext.company });
    let stored = await this.repository.findArtifact({ tenantId: this.tenantId, contextId: context.id, sha256: digest });
    let artifactReused = true;
    if (!stored) {
      artifactReused = false;
      const ingestion = await new PrivateArtifactIngestionService({ repository: this.ingestionRepository, artifactStore: this.artifactStore }).ingest({
        idempotencyKey: `ubo-customer:${context.id}:${digest}`,
        authorizedTenantId: this.tenantId,
        authorizedContextId: context.id,
        subjectReferenceId: context.subject_reference_id,
        actorType: "human",
        actorId: "ubo-demo-customer",
        sourceChannel: "customer_ownership_chart_demo",
        bytes: input.file.bytes,
        declaredMediaType: input.file.declaredMediaType,
        originalFilename: input.file.originalFilename,
      });
      stored = await this.repository.findArtifact({ tenantId: this.tenantId, contextId: context.id, sha256: ingestion.fingerprintValue });
    }
    if (!stored) throw Object.assign(new Error("The saved Evidence Artifact could not be reopened."), { code: "artifact_unavailable", statusCode: 503 });
    const providerConfiguration = selectSemanticProvider(digest, this.provider).configuration?.() || {};
    const provider = providerConfiguration.provider || (this.provider ? "injected" : "anthropic");
    const modelVersion = providerConfiguration.model || this.modelVersion;
    const key = cacheKey({ digest, profile: this.profile, provider, modelVersion });
    const correlationId = `customer-chart:${randomUUID()}`;
    const claim = (cacheKey) => this.repository.createOrGetJob({
      tenantId: this.tenantId, contextId: context.id, artifactId: stored.artifactId, artifactSha256: digest,
      cacheKey, demoCaseId: input.demoContext.demoCaseId, company: input.demoContext.company,
      evidenceHandoff: input.evidenceHandoff, ...this.profile, provider, modelVersion,
      maxAttempts: this.maxAttempts, correlationId,
    });
    let claimed = await claim(key);
    // A complete reading of the same file is reused, free. A partial one is
    // read afresh when the file is uploaded again - otherwise a poor reading,
    // or one made before a reading fix, came back every time (end-to-end check,
    // 2026-10-04). Bounded: at most a few fresh readings of one file per case.
    for (let attempt = 1; !claimed.created && claimed.job?.state === "PARTIAL" && attempt <= MAX_FRESH_READINGS; attempt += 1) {
      claimed = await claim(`${key}:fresh:${attempt}`);
    }
    // Reused means the READING was reused (nothing new is read or paid for) -
    // not merely that the file's bytes were already stored.
    const job = { ...claimed.job, reused: !claimed.created, artifactReused };
    console.info("[ubo-customer-extraction] job-start", { jobId: job.id, correlationId: job.correlationId, state: job.state, reused: job.reused });
    return publicJob(job);
  }

  /** Whether a job belongs to this UBO case - asked before a customer, whose
   *  session names one case, may see or touch it. */
  async ownedByCase(jobId, caseId) {
    const job = await this.repository.getJob({ id: jobId, tenantId: this.tenantId });
    return Boolean(job && caseId && job.demoCaseId === caseId);
  }

  /** The uploaded file itself, for viewing it again. Only the formats an
   *  upload may be (so nothing stored is ever served as a page), and only a
   *  job of this workspace. */
  async chartFile(jobId) {
    const job = await this.repository.getJob({ id: jobId, tenantId: this.tenantId });
    if (!job) throw Object.assign(new Error("Extraction job was not found."), { code: "job_not_found", statusCode: 404 });
    const stored = await this.repository.findArtifact({ tenantId: job.tenantId, contextId: job.contextId, sha256: job.artifactSha256 });
    if (!stored || stored.artifactId !== job.artifactId) throw Object.assign(new Error("The uploaded file is no longer available."), { code: "artifact_unavailable", statusCode: 404 });
    if (!VIEWABLE_MEDIA_TYPES.has(stored.mediaType)) throw Object.assign(new Error("This file cannot be shown."), { code: "media_type_not_viewable", statusCode: 415 });
    const { bytes } = await this.artifactStore.read(stored.storageKey);
    return { bytes, mediaType: stored.mediaType, originalFilename: stored.originalFilename };
  }

  async status(jobId) {
    const job = await this.repository.getJob({ id: jobId, tenantId: this.tenantId });
    if (!job) throw Object.assign(new Error("Extraction job was not found."), { code: "job_not_found", statusCode: 404 });
    return publicJob(job);
  }

  /** Retries a failed job. `retried` says whether it was queued again - the
   *  reading, and its cost, happen again only then. */
  async retry(jobId) {
    const job = await this.repository.retryFailed({ id: jobId, tenantId: this.tenantId, correlationId: `customer-chart:${randomUUID()}` });
    if (!job) return { ...(await this.status(jobId)), retried: false };
    console.info("[ubo-customer-extraction] job-retry", { jobId: job.id, correlationId: job.correlationId });
    return { ...publicJob(job), retried: true };
  }

  /** What support needs to see about failed and stuck jobs (UBO-35) - never
   *  the document, nor what was read from it. */
  async needingAttention() {
    const jobs = await this.repository.needingAttention({ tenantId: this.tenantId });
    return jobs.map((job) => ({
      jobId: job.id,
      state: job.state,
      stuck: job.state !== "FAILED",
      kind: job.evidenceHandoff ? "SUPPORTING_EVIDENCE" : "OWNERSHIP_CHART",
      caseId: job.demoCaseId,
      company: job.company?.legalName || null,
      attempts: job.attemptCount,
      maxAttempts: job.maxAttempts,
      reasonCode: job.lastReasonCode || null,
      reason: job.lastReasonMessage || null,
      upstreamStatus: job.upstreamStatus,
      correlationId: job.correlationId,
      updatedAt: job.updatedAt,
    }));
  }

  async process(jobId) {
    let job = await this.repository.getJob({ id: jobId, tenantId: this.tenantId });
    if (!job) throw Object.assign(new Error("Extraction job was not found."), { code: "job_not_found", statusCode: 404 });
    if (TERMINAL_STATES.has(job.state)) return publicJob({ ...job, reused: true });
    const claimed = await this.repository.claimJob({ id: jobId, tenantId: this.tenantId, leaseSeconds: this.leaseSeconds });
    if (!claimed) return this.status(jobId);
    job = claimed;
    console.info("[ubo-customer-extraction] attempt-start", { jobId: job.id, correlationId: job.correlationId, attempt: job.attemptCount });
    try {
      const stored = await this.repository.findArtifact({ tenantId: job.tenantId, contextId: job.contextId, sha256: job.artifactSha256 });
      if (!stored || stored.artifactId !== job.artifactId) throw Object.assign(new Error("The saved Evidence Artifact is unavailable."), { code: "artifact_unavailable", statusCode: 503 });
      const result = await this.analyse({
        input: {
          demoContext: { demoCaseId: job.demoCaseId, referenceCaseId: "", company: job.company },
          evidenceHandoff: job.evidenceHandoff,
        },
        ingestion: stored,
        artifact: artifactFrom(stored, job.company),
        artifactStore: this.artifactStore,
      }, {
        provider: this.provider,
        artifactRepository: this.artifactRepository,
        operationRepository: this.operationRepository,
        requestId: `${job.correlationId}:attempt-${job.attemptCount}`,
        persistence: "EVIDENCE_DURABLE",
      });
      const quality = result?.extractionQuality?.state;
      const usable = result?.extractionQuality?.canContinueToQuestions === true;
      const state = quality === EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_COMPLETE ? "COMPLETE"
        : quality === EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_PARTIAL && usable ? "PARTIAL" : null;
      if (!state) throw Object.assign(new Error("Evidence did not produce a validated usable ownership result."), { code: "evidence_result_not_usable", statusCode: 422 });
      const completed = await this.repository.completeJob({ id: job.id, state, result });
      console.info("[ubo-customer-extraction] job-complete", { jobId: job.id, correlationId: job.correlationId, state, attempt: job.attemptCount });
      return publicJob(completed);
    } catch (error) {
      const failure = reason(error);
      if (failure.retryable && job.attemptCount < job.maxAttempts) {
        const nextAttemptAt = new Date(this.now().getTime() + retryDelayMs(job)).toISOString();
        const retrying = await this.repository.markRetry({ id: job.id, code: failure.code, message: failure.safeMessage, upstreamStatus: failure.upstreamStatus, nextAttemptAt });
        console.warn("[ubo-customer-extraction] attempt-retrying", { jobId: job.id, correlationId: job.correlationId, attempt: job.attemptCount, code: failure.code, upstreamStatus: failure.upstreamStatus, nextAttemptAt });
        return publicJob(retrying);
      }
      const failed = await this.repository.failJob({ id: job.id, code: failure.code, message: failure.safeMessage, upstreamStatus: failure.upstreamStatus });
      console.error("[ubo-customer-extraction] job-failed", { jobId: job.id, correlationId: job.correlationId, attempt: job.attemptCount, code: failure.code, upstreamStatus: failure.upstreamStatus });
      return publicJob(failed);
    }
  }
}

module.exports = {
  CustomerOwnershipExtractionJobService,
  DEFAULT_LEASE_SECONDS,
  DEFAULT_MAX_ATTEMPTS,
  TERMINAL_STATES,
  cacheKey,
  publicJob,
  reason,
  retryDelayMs,
};
