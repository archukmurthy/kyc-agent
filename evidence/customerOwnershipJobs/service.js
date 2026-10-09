"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { PrivateArtifactIngestionService } = require("../r1/service.js");
const { sha256 } = require("../r1/domain.js");
const { OWNERSHIP_CHART_PROFILE, EXTRACTION_QUALITY_STATE } = require("../a3/ownershipChartProfile.js");
const { chartReadingModel } = require("../a3/providers.js");
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
  "database_persistence_rejected",
  "malformed_provider_result",
  "provider_malformed_output",
  "evidence_result_not_usable",
  "INVALID_EXPLICIT_DECISION",
  "EVALUATION_PRECONDITION_FAILED",
]);

// A copy of a finished reading for another case is never read: it carries this
// mark, and processing or retrying one never reaches the provider.
const REUSE_CORRELATION_PREFIX = "customer-chart-reuse:";
const registrationKey = (company) => String(company?.registrationNumber || "").replace(/\s+/g, "").toUpperCase();
const isReuseCopy =(job) => String(job?.correlationId || "").startsWith(REUSE_CORRELATION_PREFIX);

// ponytail: a fixed bound on fresh readings of one file in one case; each is paid.
const MAX_FRESH_READINGS = 5;

// A key made from another key (a fresh reading, a reading reused for another
// case). The table accepts only a 64-hex key (migration 020): a readable
// suffix was refused by the database, so re-uploading a file whose reading was
// partial answered 500 on the live site (2026-10-08).
function derivedKey(key, ...parts) {
  return createHash("sha256").update(JSON.stringify([key, ...parts])).digest("hex");
}

// What an upload is for: the ownership chart (null), or evidence for a request
// of this kind (the concepts it was asked to establish, in a stable order).
function purposeOf(evidenceHandoff) {
  return evidenceHandoff ? [...(evidenceHandoff.requestedConcepts || [])].sort() : null;
}

function cacheKey({ digest, profile, provider, modelVersion, evidenceHandoff = null }) {
  const parts = [
    digest,
    profile.profileVersion,
    profile.schemaVersion,
    profile.instructionVersion,
    profile.verificationStrategyVersion,
    provider,
    modelVersion,
  ];
  // Each purpose is its own reading: the key once named only the file, so a
  // file sent as evidence and then as the chart came back as the evidence job
  // (refused as not_a_chart, forever), and one register sent for two requests
  // came back as the first request's job (2026-10-09). A chart keeps the key it
  // always had, so the charts already read are still reused free.
  if (evidenceHandoff) parts.push(["evidence", purposeOf(evidenceHandoff)]);
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
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
  // A failure its source says cannot go differently is never retried: each
  // attempt is another paid reading.
  const retryable = !DETERMINISTIC_CODES.has(code) && error?.retryable !== false && (error?.retryable === true
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
    provider = null, tenantId, modelVersion = chartReadingModel(),
    profile = OWNERSHIP_CHART_PROFILE,
    maxAttempts = DEFAULT_MAX_ATTEMPTS, leaseSeconds = DEFAULT_LEASE_SECONDS,
    now = () => new Date(), analyse = analyseIngestedCustomerOwnershipChart, progressStore = null } = {}) {
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
    // Where a running reading's draft is kept ({ get, set, del }, shared across
    // server instances - the page asking for it is rarely the one reading).
    this.progressStore = progressStore;
  }

  forgetProgress(jobId) { if (this.progressStore) Promise.resolve(this.progressStore.del(this.progressKey(jobId))).catch(() => {}); }

  progressKey(jobId) { return `ubo-chart-progress:${this.tenantId}:${jobId}`; }

  /** Saves what the reading has found so far, at most every two seconds (and
   *  at once when the verification pass starts). Never fails the reading. */
  progressRecorder(jobId) {
    if (!this.progressStore) return null;
    let lastAt = 0, lastStage = null, lastCount = -1;
    return ({ pass, parties = [], connections = [] }) => {
      const stage = pass > 1 ? "CHECKING" : "READING";
      // Anything newly found is saved at once (the provider reports at most
      // once a second); otherwise at most every two seconds. The last report
      // of a pass was being dropped.
      const count = parties.length + connections.length;
      if (stage === lastStage && count === lastCount && Date.now() - lastAt < 2000) return;
      lastAt = Date.now(); lastStage = stage; lastCount = count;
      Promise.resolve(this.progressStore.set(this.progressKey(jobId), { stage, parties, connections, updatedAt: new Date(lastAt).toISOString() }, { ttlSeconds: 900 })).catch(() => {});
    };
  }

  async progressFor(job) {
    if (!this.progressStore || job?.state !== "RUNNING") return null;
    try { return (await this.progressStore.get(this.progressKey(job.id))) || null; } catch (_) { return null; }
  }

  async start(rawInput) {
    const input = validateRequest(rawInput);
    const digest = sha256(input.file.bytes);
    const caseId = input.demoContext.demoCaseId;
    const providerConfiguration = selectSemanticProvider(digest, this.provider).configuration?.() || {};
    const provider = providerConfiguration.provider || (this.provider ? "injected" : "anthropic");
    const modelVersion = providerConfiguration.model || this.modelVersion;
    if (input.evidenceHandoff) {
      // Compared by the file itself: a case reusing another's reading holds
      // its chart under that case's artifact, so the same file sent again had a
      // new artifact id and passed as evidence for itself.
      if ((await this.repository.caseChartDigest({ tenantId: this.tenantId, demoCaseId: caseId })) === digest) {
        throw Object.assign(new Error("This is the ownership chart itself, so it cannot be evidence for it. Upload a different document."), { code: "chart_not_evidence", statusCode: 409 });
      }
    } else {
      // The same chart already read completely in this workspace - for this
      // case, or for another case about the same company (a case started from
      // saved research) - is reused, free. It used to be stored and paid for
      // again whenever the case's own upload was not the one first read.
      const earlier = await this.repository.findFinishedChartReading({ tenantId: this.tenantId, artifactSha256: digest, demoCaseId: caseId, ...this.profile, provider, modelVersion });
      if (earlier?.demoCaseId === caseId) return publicJob({ ...earlier, reused: true });
      if (earlier && registrationKey(earlier.company) && registrationKey(earlier.company) === registrationKey(input.demoContext.company)) {
        return this.reuseReading({ sourceJobId: earlier.id, demoContext: input.demoContext });
      }
    }
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
    const key = cacheKey({ digest, profile: this.profile, provider, modelVersion, evidenceHandoff: input.evidenceHandoff });
    const correlationId = `customer-chart:${randomUUID()}`;
    const claim = (cacheKey) => this.repository.createOrGetJob({
      tenantId: this.tenantId, contextId: context.id, artifactId: stored.artifactId, artifactSha256: digest,
      cacheKey, demoCaseId: input.demoContext.demoCaseId, company: input.demoContext.company,
      evidenceHandoff: input.evidenceHandoff, ...this.profile, provider, modelVersion,
      maxAttempts: this.maxAttempts, correlationId,
    });
    // Evidence read before purposes had keys of their own sits under the key
    // that named only the file. The same file for the same request is that
    // reading again, free - it used to be read and paid for a second time
    // (review, 2026-10-09).
    if (input.evidenceHandoff && this.repository.findJobByKey) {
      const before = await this.repository.findJobByKey({ tenantId: this.tenantId, contextId: context.id, cacheKey: cacheKey({ digest, profile: this.profile, provider, modelVersion }) });
      if (before?.state === "COMPLETE" && before.demoCaseId === caseId && JSON.stringify(purposeOf(before.evidenceHandoff)) === JSON.stringify(purposeOf(input.evidenceHandoff))) {
        return publicJob({ ...before, reused: true, artifactReused });
      }
    }
    let claimed = await claim(key);
    // A job made before purposes had keys of their own may hold this key for
    // another purpose; this upload gets a job of its own beside it.
    if (!claimed.created && JSON.stringify(purposeOf(claimed.job?.evidenceHandoff)) !== JSON.stringify(purposeOf(input.evidenceHandoff))) {
      claimed = await claim(derivedKey(key, "purpose", purposeOf(input.evidenceHandoff)));
    }
    // A complete reading of the same file is reused, free. A partial one is
    // read afresh when the file is uploaded again - otherwise a poor reading,
    // or one made before a reading fix, came back every time (end-to-end check,
    // 2026-10-04). Bounded: at most a few fresh readings of one file per case.
    for (let attempt = 1; !claimed.created && claimed.job?.state === "PARTIAL" && attempt <= MAX_FRESH_READINGS; attempt += 1) {
      claimed = await claim(derivedKey(key, "fresh", attempt));
    }
    // Reused means the READING was reused (nothing new is read or paid for) -
    // not merely that the file's bytes were already stored.
    const job = { ...claimed.job, reused: !claimed.created, artifactReused };
    console.info("[ubo-customer-extraction] job-start", { jobId: job.id, correlationId: job.correlationId, state: job.state, reused: job.reused });
    return publicJob(job);
  }

  /** The reading of a chart already read for this company on another case,
   *  for a new case started from saved research (owner decision 2026-10-08,
   *  option b). A copy of the job for the new case, pointing at the same
   *  stored file and carrying the same result - nothing is read again and
   *  nothing is paid. Reached by staff asking for it (the route keeps
   *  customers out of that), and by start() when anyone - a customer included
   *  - uploads the very file already read for the same company in this
   *  workspace: the reading is of their own bytes, rewritten to their case. */
  async reuseReading({ sourceJobId, demoContext }) {
    const source = await this.repository.getJob({ id: sourceJobId, tenantId: this.tenantId });
    const usable = source && (source.state === "COMPLETE" || source.state === "PARTIAL") && !source.evidenceHandoff && source.result;
    if (!usable) throw Object.assign(new Error("There is no finished chart reading to reuse."), { code: "job_not_found", statusCode: 404 });
    const caseId = String(demoContext?.demoCaseId || "");
    if (!caseId || caseId === source.demoCaseId) throw Object.assign(new Error("Choose the new case to reuse the reading for."), { code: "case_required", statusCode: 400 });
    if (!registrationKey(source.company) || registrationKey(source.company) !== registrationKey(demoContext.company)) {
      throw Object.assign(new Error("That chart was read for a different company."), { code: "chart_company_mismatch", statusCode: 409 });
    }
    // Written finished, in one statement - never a queued copy a later step
    // must finish (a failure in between left one that blocked the case).
    const job = await this.repository.createCompletedCopy({
      tenantId: this.tenantId, contextId: source.contextId, artifactId: source.artifactId, artifactSha256: source.artifactSha256,
      cacheKey: derivedKey(source.cacheKey, "reused-for", caseId), demoCaseId: caseId, company: demoContext.company,
      profileVersion: source.profileVersion, schemaVersion: source.schemaVersion, instructionVersion: source.instructionVersion,
      verificationStrategyVersion: source.verificationStrategyVersion, provider: source.provider, modelVersion: source.modelVersion,
      maxAttempts: this.maxAttempts, correlationId: `${REUSE_CORRELATION_PREFIX}${randomUUID()}`, state: source.state,
      // The new case's customer sees this result: it names their case, not
      // the one it was first read for.
      result: { ...source.result, demoCaseId: caseId, referenceCaseId: String(demoContext.referenceCaseId || ""), company: demoContext.company },
    });
    console.info("[ubo-customer-extraction] job-reused", { jobId: job.id, sourceJobId: source.id });
    return publicJob({ ...job, reused: true });
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
    const progress = await this.progressFor(job);
    return progress ? { ...publicJob(job), progress } : publicJob(job);
  }

  /** Retries a failed job. `retried` says whether it was queued again - the
   *  reading, and its cost, happen again only then. */
  async retry(jobId) {
    // An unfinished copy is mended by reusing the reading again, not read.
    if (isReuseCopy(await this.repository.getJob({ id: jobId, tenantId: this.tenantId }))) return { ...(await this.status(jobId)), retried: false };
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
    // An unfinished copy (left by the old three-step reuse) would start a
    // real, uncounted reading here. It fails instead; reusing again mends it.
    if (isReuseCopy(job)) {
      const failed = await this.repository.failJob({ id: job.id, code: "reuse_copy_incomplete", message: "This copy of an earlier reading was never finished; reuse the reading again.", upstreamStatus: null });
      return publicJob(failed || job);
    }
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
        onProgress: this.progressRecorder(job.id),
        requestId: `${job.correlationId}:attempt-${job.attemptCount}`,
        persistence: "EVIDENCE_DURABLE",
      });
      const quality = result?.extractionQuality?.state;
      const usable = result?.extractionQuality?.canContinueToQuestions === true;
      const state = quality === EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_COMPLETE ? "COMPLETE"
        : quality === EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_PARTIAL && usable ? "PARTIAL" : null;
      if (!state) throw Object.assign(new Error("Evidence did not produce a validated usable ownership result."), { code: "evidence_result_not_usable", statusCode: 422 });
      const completed = await this.repository.completeJob({ id: job.id, state, result });
      this.forgetProgress(job.id);
      console.info("[ubo-customer-extraction] job-complete", { jobId: job.id, correlationId: job.correlationId, state, attempt: job.attemptCount });
      // Another instance that took the job over after its lease ran out may
      // have finished it first: the write then changes nothing, and the job is
      // answered as it now stands - it used to answer null, which the page read
      // as a failure.
      return completed ? publicJob(completed) : this.status(job.id);
    } catch (error) {
      const failure = reason(error);
      if (failure.retryable && job.attemptCount < job.maxAttempts) {
        const nextAttemptAt = new Date(this.now().getTime() + retryDelayMs(job)).toISOString();
        const retrying = await this.repository.markRetry({ id: job.id, code: failure.code, message: failure.safeMessage, upstreamStatus: failure.upstreamStatus, nextAttemptAt });
        console.warn("[ubo-customer-extraction] attempt-retrying", { jobId: job.id, correlationId: job.correlationId, attempt: job.attemptCount, code: failure.code, upstreamStatus: failure.upstreamStatus, nextAttemptAt });
        return retrying ? publicJob(retrying) : this.status(job.id);
      }
      this.forgetProgress(job.id);
      const failed = await this.repository.failJob({ id: job.id, code: failure.code, message: failure.safeMessage, upstreamStatus: failure.upstreamStatus });
      console.error("[ubo-customer-extraction] job-failed", { jobId: job.id, correlationId: job.correlationId, attempt: job.attemptCount, code: failure.code, upstreamStatus: failure.upstreamStatus });
      return failed ? publicJob(failed) : this.status(job.id);
    }
  }
}

module.exports = {
  CustomerOwnershipExtractionJobService,
  DEFAULT_LEASE_SECONDS,
  DEFAULT_MAX_ATTEMPTS,
  TERMINAL_STATES,
  cacheKey,
  derivedKey,
  publicJob,
  reason,
  retryDelayMs,
};
