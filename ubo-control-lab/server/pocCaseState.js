"use strict";

const { shareRepeatedAnalyses } = require("../../src/uboDemo/customer/recalculationStorage");
const { computeCaseAssessment } = require("./caseAssessment");
const auditLedger = require("./auditLedger");
const { completeIdentityVerification, isReadyForIdentityVerification } = require("../../src/uboDemo/customer/verificationAssessment");
const { createHash } = require("node:crypto");

const CASE_CONTRACT = "ubo-poc-case-v1";
const RELEASE_STATE = Object.freeze({
  COMPLETE: "COMPLETE",
  PARTIAL_NON_MATERIAL: "PARTIAL_NON_MATERIAL",
  PARTIAL_MATERIAL: "PARTIAL_MATERIAL",
  FAILED: "FAILED",
});

function json(value) { return JSON.stringify(value == null ? null : value); }
function rows(result) { return result?.rows || result || []; }
function first(result) { return rows(result)[0] || null; }
function normalized(value) { return String(value || "").trim().toUpperCase(); }
function stableHash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function withoutKeys(value, keys) {
  const omitted = new Set(keys);
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => !omitted.has(key)));
}
function compactPath(path = {}) {
  return {
    pathId: path.pathId,
    state: path.state,
    relationshipIds: path.relationshipIds || [],
    contribution: path.contribution || null,
    majoritySteps: (path.majoritySteps || []).map((step) => ({
      relationshipId: step.relationshipId,
      relationshipType: step.relationshipType,
      measurement: step.measurement || null,
      fromEntityId: step.fromEntityId,
      toEntityId: step.toEntityId,
    })),
  };
}
function compactQualificationBasis(basis = {}) {
  return {
    basisId: basis.basisId,
    personEntityId: basis.personEntityId,
    route: basis.route,
    condition: basis.condition || null,
    dimension: basis.dimension,
    assessmentState: basis.assessmentState,
    method: basis.method,
    policyId: basis.policyId,
    policyVersion: basis.policyVersion,
    threshold: basis.threshold || null,
    recordedCalculation: basis.recordedCalculation ? {
      value: basis.recordedCalculation.value || null,
      cycles: (basis.recordedCalculation.cycles || []).map(({ cycleId }) => ({ cycleId })),
    } : null,
    aggregatedTargetRightValue: basis.aggregatedTargetRightValue || null,
    orderedPathReferences: (basis.orderedPathReferences || []).map(compactPath),
    attributionChains: (basis.attributionChains || []).map(compactPath),
    reviewDependencies: basis.reviewDependencies || [],
    governance: basis.governance ? { requiredSignoffIds: basis.governance.requiredSignoffIds || [] } : null,
  };
}
function compactQualification(assessment = {}) {
  return {
    personEntityId: assessment.personEntityId,
    routeStatus: assessment.routeStatus,
    assessedRoutes: assessment.assessedRoutes || [],
    unassessedRoutes: assessment.unassessedRoutes || [],
  };
}
function compactAnalysis(analysis) {
  if (!analysis?.view) return analysis;
  const view = analysis.view;
  const graph = view.graph;
  if (!graph) return { ...analysis, view: withoutKeys(view, ["snapshot"]) };
  const qualificationBases = (view.qualificationBases || graph.qualificationBasisRecords || []).map(compactQualificationBasis);
  const qualifications = (view.qualifications || graph.personQualificationAssessments || []).map(compactQualification);
  return {
    ...analysis,
    view: {
      ...withoutKeys(view, ["snapshot", "qualificationBases", "qualifications", "graph"]),
      graph: {
        ...withoutKeys(graph, [
          "qualificationBasisRecords", "personQualificationAssessments", "companyAttributionAssessments",
          "llpAttributionAssessments", "layerClosureAssessments", "percentageEvidenceAssessments", "nodes",
        ]),
        nodes: (graph.nodes || []).map((node) => withoutKeys(node, ["qualificationAssessment"])),
        qualificationBasisRecords: qualificationBases,
        personQualificationAssessments: qualifications,
      },
      qualificationBases,
      qualifications,
    },
  };
}
function compactChartResult(result) {
  return result?.chartAnalysis ? { ...result, chartAnalysis: compactAnalysis(result.chartAnalysis) } : result;
}
function compactRecalculations(recalculations = {}) {
  return shareRepeatedAnalyses(Object.fromEntries(Object.entries(recalculations || {}).map(([key, record]) => [key, record?.chartAnalysis
    ? { ...record, chartAnalysis: compactAnalysis(record.chartAnalysis) }
    : record])));
}
function compactCasePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  return {
    ...payload,
    ...(payload.researchResult ? { researchResult: compactAnalysis(payload.researchResult) } : {}),
    ...(payload.chartProjection ? { chartProjection: compactChartResult(payload.chartProjection) } : {}),
    ...(payload.resolution ? { resolution: { ...payload.resolution, recalculations: compactRecalculations(payload.resolution.recalculations) } } : {}),
  };
}
function compactCaseProjection(projection) {
  return compactCasePayload(projection);
}
function compactCaseRecordForTransport(record) {
  if (!record) return record;
  const projection = compactCaseProjection(record.projection);
  const extraction = record.extraction
    ? projection?.chartProjection
      ? withoutKeys(record.extraction, ["result"])
      : { ...record.extraction, result: compactChartResult(record.extraction.result) }
    : record.extraction;
  return { ...record, projection, extraction };
}
function candidateFactCount(result) {
  return (result?.candidateSources || []).reduce((total, source) => total + (source?.candidateFacts || []).length, 0);
}

function researchLimitations(result) {
  const providerLimitations = (result?.providerOutcomes || []).filter(({ outcome }) => outcome !== "COMPLETE").map((item) => ({
    provider: item.provider,
    outcome: item.outcome,
    reasonCode: item.reasonCode || "UNSPECIFIED_PROVIDER_LIMITATION",
    reasonText: item.reasonText || "The provider did not return complete coverage.",
  }));
  const sourceLimitations = (result?.candidateSources || []).flatMap((source) => (source?.issues || [])
    .filter((issue) => issue?.code !== "LEGACY_PROVIDER_OUTCOME")
    .filter((issue) => /LIMITATION|SOURCE_UNAVAILABLE|PROVIDER_(TIMEOUT|FAILURE|UNAVAILABLE)/.test(normalized(issue?.code || issue?.issueType)))
    .map((issue) => ({
      provider: issue?.details?.provider || source?.provider || source?.sourceType || "RESEARCH_SOURCE",
      outcome: "PARTIAL",
      reasonCode: issue.code || issue.issueType || "UNSPECIFIED_SOURCE_LIMITATION",
      reasonText: issue.message || issue.detail || "The source did not establish exhaustive coverage.",
    })));
  return [...new Map([...providerLimitations, ...sourceLimitations]
    .map((item) => [`${item.provider}:${item.reasonCode}:${item.reasonText}`, item])).values()];
}

function researchFrontier(result) {
  const snapshot = result?.view?.snapshot || {};
  const explicitlyMaterialNeed = (item) => item?.couldChangeVerificationPopulation === true
    || item?.materiality?.material === true
    || item?.blocking === true
    || ![undefined, null, "", "NONE"].includes(item?.verificationPopulationImpact);
  const candidates = [
    ...(result?.view?.informationNeeds || []).filter(explicitlyMaterialNeed),
    ...(snapshot.informationNeeds || []).filter(explicitlyMaterialNeed),
    ...(snapshot.openInformationNeeds || []).filter(explicitlyMaterialNeed),
    ...(result?.missingInformation || []),
    ...(result?.unresolvedPaths || []),
  ];
  return candidates.filter((item) => !["RESOLVED", "CLOSED", "SATISFIED", "NOT_MATERIAL"].includes(normalized(item.status || item.state)))
    .filter((item, index, all) => {
    const key = item.needId || item.id || item.pathId || JSON.stringify(item);
    return all.findIndex((other) => (other.needId || other.id || other.pathId || JSON.stringify(other)) === key) === index;
  });
}

function frontierCanChangeVerificationPopulation(item) {
  if (item?.materiality?.material === false || item?.status === "not_material" || item?.blocking === false) return false;
  if (item?.couldChangeVerificationPopulation === false || item?.verificationPopulationImpact === "NONE") return false;
  if (item?.couldChangeVerificationPopulation === true || item?.materiality?.material === true || item?.blocking === true) return true;
  const concept = normalized(item?.concept || item?.type || item?.reasonCode || item?.reason);
  if (/INDEPENDENT_CORROBORATION|SOURCE_UNAVAILABLE|ADVISORY|FRESHNESS/.test(concept)) return false;
  return /OWNERSHIP|CONTROL|PSC|UBO|VOTING|BOARD|TRUST|NOMINEE|FALLBACK|MANAGING|PERCENT|HOLDER|PATH|FRONTIER/.test(concept);
}

function evaluateResearchRelease(result) {
  if (result?.status === "COMPLETE") return {
    state: RELEASE_STATE.COMPLETE,
    mayProceed: true,
    usableFactCount: candidateFactCount(result),
    limitations: [],
    materialFrontier: [],
  };
  if (result?.status !== "PARTIAL") return {
    state: RELEASE_STATE.FAILED,
    mayProceed: false,
    usableFactCount: candidateFactCount(result),
    limitations: researchLimitations(result),
    materialFrontier: [],
    reason: "Research did not produce a complete or usable partial result.",
  };
  const usableFactCount = candidateFactCount(result);
  const limitations = researchLimitations(result);
  const frontier = researchFrontier(result);
  const materialFrontier = frontier.filter(frontierCanChangeVerificationPopulation);
  const explicitLimitations = limitations.length > 0 || Boolean(result?.fallback);
  const mayProceed = usableFactCount > 0 && explicitLimitations && materialFrontier.length === 0;
  return {
    state: mayProceed ? RELEASE_STATE.PARTIAL_NON_MATERIAL : RELEASE_STATE.PARTIAL_MATERIAL,
    mayProceed,
    usableFactCount,
    limitations,
    materialFrontier,
    reason: mayProceed
      ? "Usable supported facts remain and the explicit limitations cannot change the current verification population."
      : !usableFactCount ? "No usable supported facts are available."
        : !explicitLimitations ? "The partial result does not state its remaining provider or source limitations."
          : "An unresolved research frontier could change who is a UBO or requires identity verification.",
  };
}

function stageFromTrace(trace, fallback = "QUESTIONS") {
  const state = trace?.discoveryState;
  if (state === "READY_FOR_IDV") return "READY_FOR_IDV";
  if (state === "IDV_IN_PROGRESS") return "IDENTITY_VERIFICATION";
  if (state === "IDV_COMPLETE") return "COMPLETE";
  return fallback;
}

/** The case's own assessment trace: written by the server, held in the
 *  assessment or resolution. A copy inside the research result, or a trace a
 *  browser wrote before UBO-13, is not it - one travelled back in the
 *  analyst's research save, froze a case and let verification complete
 *  against a stale assessment (review). */
function serverTraceOf(projection) {
  const trace = projection?.assessment?.trace || projection?.resolution?.trace || null;
  return trace?.computedBy === "server" ? trace : null;
}

function traceTime(trace) {
  const value = Date.parse(trace?.updatedAt || "");
  return Number.isFinite(value) ? value : null;
}

function mergeResolution(current, incoming) {
  if (!incoming) return current;
  const submitted = incoming.submittedAnswer;
  const submittedAnswer = submitted?.question?.id && submitted?.answer
    ? { [submitted.question.id]: submitted.answer }
    : {};
  return {
    ...incoming,
    answers: { ...(current?.answers || {}), ...(incoming.answers || {}), ...submittedAnswer },
    evidence: { ...(current?.evidence || {}), ...(incoming.evidence || {}) },
    recalculations: { ...(current?.recalculations || {}), ...(incoming.recalculations || {}) },
  };
}

/** The case with everything computed from its inputs dropped - the
 *  customer's answers and uploads kept as their input. Nothing, identity
 *  verification included, acts on it until the server computes again. */
function uncomputed(base) {
  // The last server trace stays as history only (not read as the case's
  // assessment): completed verifications and the audit trail carry into the
  // next one, so an unchanged recomputation does not reset them.
  const priorTrace = serverTraceOf(base) || base.resolution?.priorTrace;
  return {
    resolution: base.resolution ? { createdAt: base.resolution.createdAt, answers: base.resolution.answers, evidence: base.resolution.evidence, ...(priorTrace ? { priorTrace } : {}) } : base.resolution,
    assessment: null,
  };
}

/** What makes research different research - the same fields the analyst
 *  screen's save signature uses. Re-saving the same research changes nothing. */
function researchIdentity(research) {
  return research ? stableHash(canonical([research.jobId, research.status, research.completedAt, research.investigationTopicActivations, research.analystCustomerRequests, research.candidateSources])) : null;
}

/** Key order made irrelevant: stored research comes back from jsonb reordered. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function projectCommand(current, operation, payload, release) {
  const previousCompany = current?.demoCase?.company || current?.company || null;
  const base = { contractVersion: CASE_CONTRACT, ...compactCaseProjection(current || {}) };
  payload = compactCasePayload(payload);
  const durableResearchResult = payload?.researchResult
    ? Object.fromEntries(Object.entries(payload.researchResult).filter(([key]) => key !== "displayState"))
    : null;
  if (payload?.draft) base.draft = payload.draft;
  if (payload?.demoCase) base.demoCase = payload.demoCase;
  if (payload?.company) base.company = payload.company;
  if (operation === "UPSERT_CASE") {
    // Research and chart facts are matched to the company: renaming it (the
    // analyst's to do) makes what was computed for the old name meaningless.
    const renamed = previousCompany && (payload?.demoCase?.company || payload?.company) && !sameCompany(previousCompany, base.demoCase?.company || base.company);
    if (!renamed) return { ...base, currentStage: base.currentStage || "COMPANY_DETAILS" };
    // The chart was read for the old company too.
    // So were its identity checks: nothing of the old company's history carries over.
    const { chartReference: _reference, chartProjection: _chart, ...rest } = base;
    const { priorTrace: _history, ...resolution } = uncomputed(base).resolution || {};
    return { ...rest, resolution: base.resolution ? resolution : base.resolution, assessment: null, currentStage: "COMPANY_DETAILS" };
  }
  if (operation === "REOPEN_CASE") return { ...base, ...uncomputed(base), currentStage: "QUESTIONS" };
  if (operation === "SAVE_RESEARCH") {
    // The same research saved again (the analyst screen does, on load) changes nothing.
    if (current?.researchResult && researchIdentity(current.researchResult) === researchIdentity(durableResearchResult)) return { ...base, researchRelease: release };
    // Questions come from the research: new research drops what was computed from the old.
    return {
      ...base,
      ...uncomputed(base),
      researchResult: durableResearchResult,
      researchRelease: release,
      currentStage: release.mayProceed ? "RESEARCH_COMPLETE" : "DISCOVERY_IN_PROGRESS",
    };
  }
  if (operation === "ASSOCIATE_CHART") return {
    ...base,
    chartReference: payload.chartReference,
    chartProjection: payload.chartProjection,
    // Computed from the previous chart: dropped, so nothing - identity
    // verification included - acts on it until the server recomputes. The
    // customer's answers and uploads are kept as their input.
    ...uncomputed(base),
    currentStage: "OWNERSHIP_COMPLETE",
  };
  if (["SYNC_RESOLUTION", "SUBMIT_ANSWER", "FINALIZE_ASSESSMENT", "RESET_ANSWERS"].includes(operation)) {
    // Computed by the server from what it holds (caseAssessment.js), so it
    // replaces what was stored rather than being merged with it: merging let
    // answers the customer had withdrawn reappear, and there is no browser
    // version to be "stale" against any more.
    return {
      ...base,
      resolution: payload.resolution,
      assessment: payload.assessment,
      currentStage: stageFromTrace(payload.assessment?.trace, "QUESTIONS"),
    };
  }
  if (operation === "COMPLETE_IDV") return {
    ...base,
    resolution: payload.resolution || base.resolution,
    assessment: payload.assessment || base.assessment,
    researchResult: durableResearchResult || base.researchResult,
    currentStage: stageFromTrace(payload.trace, "IDENTITY_VERIFICATION"),
  };
  if (operation === "SAVE_ANALYST_STATE") return { ...base, researchResult: durableResearchResult || base.researchResult };
  throw Object.assign(new Error(`Unsupported POC case operation: ${operation}`), { statusCode: 400, code: "unsupported_case_operation" });
}

class PostgresPocCaseRepository {
  // Every query below filters on this tenant. It comes from the signed-in
  // caller (api/ubo-poc-case.js); there is no default, because a default is
  // how every case ended up filed under one hard-coded company.
  constructor(db, tenantId) {
    if (!tenantId) throw new Error("PostgresPocCaseRepository needs the caller's tenant");
    this.db = db;
    this.tenantId = tenantId;
  }

  async get(caseId, executor = this.db, { forUpdate = false } = {}) {
    const row = first(await executor.query(`SELECT case_id, tenant_id, company, current_stage,
      research_release_state, latest_extraction_job_id, latest_artifact_id, current_assessment_id,
      current_projection, created_at, updated_at, updated_at::text AS version
      FROM ubo_poc_cases WHERE case_id = $1 AND tenant_id = $2${forUpdate ? " FOR UPDATE" : ""}`, [caseId, this.tenantId]));
    if (!row) return null;
    return {
      caseId: row.case_id,
      tenantId: row.tenant_id,
      company: row.company,
      currentStage: row.current_stage,
      researchReleaseState: row.research_release_state,
      latestExtractionJobId: row.latest_extraction_job_id,
      latestArtifactId: row.latest_artifact_id,
      currentAssessmentId: row.current_assessment_id,
      projection: row.current_projection,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
  }

  /** The case's audit ledger (UBO-33), oldest first. */
  async ledger(caseId) {
    return auditLedger.list(this.db, this.tenantId, caseId);
  }

  /** This workspace's research runs, newest first: what an analyst can start
   *  a new case from without a provider call. One entry per run - a case
   *  started from saved research carries a copy (sourceMode SAVED) and is not
   *  listed again, and each entry is dated when its research finished, not
   *  when its case last changed (live end-to-end check, 2026-10-08: one run
   *  was listed three times, at three different times). */
  async savedResearch(limit = 20) {
    return rows(await this.db.query(`SELECT case_id, company, current_projection->'researchResult'->>'status' AS status,
        current_projection->'researchResult'->>'completedAt' AS completed_at, created_at
      FROM ubo_poc_cases
      WHERE tenant_id = $1 AND current_projection ? 'researchResult'
        AND COALESCE(current_projection->'researchResult'->>'status', '') NOT IN ('FAILED', 'LOADING')
        AND COALESCE(current_projection->'researchResult'->>'sourceMode', '') <> 'SAVED'
      ORDER BY created_at DESC LIMIT $2`, [this.tenantId, limit])).map((row) => {
      const valid = (value) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null; };
      return {
        caseId: row.case_id,
        company: { legalName: row.company?.legalName || "", registrationNumber: row.company?.registrationNumber || "", countryCode: row.company?.countryCode || "" },
        status: row.status || null,
        researchedAt: valid(row.completed_at) || valid(row.created_at),
      };
    });
  }

  async history(caseId) {
    return rows(await this.db.query(`SELECT event_id, event_type, actor_type, occurred_at
      FROM ubo_poc_case_events WHERE case_id = $1 ORDER BY occurred_at, event_id`, [caseId])).map((row) => ({
      eventId: row.event_id, eventType: row.event_type, actorType: row.actor_type, occurredAt: row.occurred_at,
    }));
  }

  async extraction(jobId) {
    if (!jobId) return null;
    const row = first(await this.db.query(`SELECT id, artifact_id, state, result, completed_at, demo_case_id, company, evidence_handoff
      FROM evidence_customer_extraction_jobs WHERE id = $1 AND tenant_id = $2`, [jobId, this.tenantId]));
    return row ? { jobId: row.id, artifactId: row.artifact_id, state: row.state, result: row.result, completedAt: row.completed_at, demoCaseId: row.demo_case_id, company: row.company, evidenceHandoff: row.evidence_handoff } : null;
  }

  /** The server's extraction of an evidence file uploaded for this case. */
  async evidenceResult(caseId, artifactId) {
    if (!artifactId) return null;
    const row = first(await this.db.query(`SELECT result, evidence_handoff FROM evidence_customer_extraction_jobs
      WHERE tenant_id = $1 AND demo_case_id = $2 AND artifact_id = $3 AND state IN ('COMPLETE', 'PARTIAL') AND result IS NOT NULL
      ORDER BY (evidence_handoff IS NOT NULL) DESC, completed_at DESC NULLS LAST LIMIT 1`, [this.tenantId, caseId, artifactId]));
    // Which request the upload answered travels with it: an upload that was
    // not made as evidence (the ownership chart itself, say) has none.
    return row ? { result: row.result, evidenceHandoff: row.evidence_handoff } : null;
  }

  async apply({ caseId, operation, idempotencyKey, actorType, actorId = null, correlationId = null, receivedAt = null, payload, release, expectedVersion = null }) {
    return this.db.transaction(async (client) => {
      const company = payload.demoCase?.company || payload.company;
      // Read and locked once: the case does not change under the lock, so it is
      // not read again - each read moved the whole case over the wire, and a
      // save read it four times (end-to-end check, 2026-10-04).
      let existing = await this.get(caseId, client, { forUpdate: true });
      if (!existing) {
        if (!company) throw Object.assign(new Error("A company is required when creating a POC case"), { statusCode: 400, code: "company_required" });
        await client.query(`INSERT INTO ubo_poc_cases (case_id, tenant_id, company, current_projection)
          VALUES ($1, $2, $3::jsonb, '{}'::jsonb)`, [caseId, this.tenantId, json(company)]);
        existing = await this.get(caseId, client, { forUpdate: true });
      }
      const locked = existing;
      // A result computed from an older read of the case would overwrite what
      // changed since - the questions screen's sync erased answers saved in
      // between (found in the browser test). The service recomputes instead.
      if (expectedVersion && locked && locked.version !== expectedVersion) {
        throw Object.assign(new Error("The case changed while this step was being worked out."), { statusCode: 409, code: "case_changed", retryable: true });
      }
      const inserted = first(await client.query(`INSERT INTO ubo_poc_case_events
        (case_id, event_type, idempotency_key, actor_type, payload)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (case_id, event_type, idempotency_key) DO NOTHING
        RETURNING event_id`, [caseId, operation, idempotencyKey, actorType, json(payload)]));
      if (!inserted && operation !== "SUBMIT_ANSWER") return { record: existing, duplicate: true };
      const projection = projectCommand(existing?.projection, operation, payload, release);
      const chart = projection.chartReference || {};
      const assessmentId = projection.assessment?.assessmentId || projection.assessment?.trace?.verificationAssessment?.assessmentVersionId || null;
      const updated = first(await client.query(`UPDATE ubo_poc_cases SET company = $2::jsonb, current_stage = $3,
        research_release_state = $4, latest_extraction_job_id = $5, latest_artifact_id = $6,
        current_assessment_id = $7, current_projection = $8::jsonb, updated_at = NOW()
        WHERE case_id = $1 RETURNING updated_at, updated_at::text AS version`, [caseId, json(projection.demoCase?.company || projection.company || company), projection.currentStage,
        projection.researchRelease?.state || existing?.researchReleaseState || null,
        chart.jobId || existing?.latestExtractionJobId || null, chart.artifactId || existing?.latestArtifactId || null,
        assessmentId, json(projection)]));
      await this.persistResolution(client, caseId, payload.resolution, operation, idempotencyKey);
      await this.persistAssessment(client, caseId, payload.assessment, projection.chartReference);
      // The audit ledger, in the same transaction: the step and its record
      // stand or fall together (UBO-33).
      await auditLedger.record(client, this.tenantId, auditLedger.eventsForCommand({
        caseId, operation, before: existing?.projection, after: projection, payload, operationId: idempotencyKey,
        actor: { type: actorType, id: actorId }, correlationId, receivedAt,
        researchChanged: operation === "SAVE_RESEARCH" && researchIdentity(existing?.projection?.researchResult) !== researchIdentity(projection.researchResult),
      }));
      if (operation === "COMPLETE_IDV") await this.persistVerificationEvent(client, caseId, payload, idempotencyKey);
      console.info("[ubo-poc-case] projection-applied", {
        caseRef: stableHash(caseId).slice(0, 12),
        operation,
        duplicate: !inserted,
        submittedAnswer: Boolean(payload.resolution?.submittedAnswer?.question?.id),
        answerCount: Object.keys(projection.resolution?.answers || {}).length,
        stage: projection.currentStage,
      });
      // What was just written, rather than reading the case back.
      return {
        record: {
          ...existing,
          company: projection.demoCase?.company || projection.company || company || existing?.company,
          currentStage: projection.currentStage,
          projection,
          updatedAt: updated?.updated_at || existing?.updatedAt,
          version: updated?.version || existing?.version,
        },
        duplicate: !inserted,
      };
    });
  }

  async persistResolution(client, caseId, resolution, operation, idempotencyKey) {
    if (!resolution) return;
    // One statement per table rather than one per row: a save wrote a dozen
    // rows one round trip at a time. Within a batch the last row for a key
    // wins, as it did when they were written in turn.
    const lastByKey = (rows) => [...new Map(rows.map((row) => [row[0], row])).values()];
    const requirements = lastByKey((resolution.requirements || []).map((item) => [String(item.id || item.factRequirementId || item.comparisonItemId), json(item), item.status || "CURRENT"]));
    const known = new Set(requirements.map(([key]) => key));
    const placeholders = [];
    const questions = lastByKey((resolution.questions || []).map((question) => {
      const requirementKey = String(question.factRequirementId || question.comparisonItemId || `question:${question.id}`);
      if (!known.has(requirementKey)) { known.add(requirementKey); placeholders.push([requirementKey, json({ id: requirementKey, inferredFromQuestion: question.id })]); }
      return [String(question.id), requirementKey, json(question), question.status || "OPEN"];
    }));
    const evidence = lastByKey((resolution.evidenceRequirements || []).map((requirement) => {
      const requirementKey = String(requirement.factRequirementId || requirement.comparisonItemId || `evidence:${requirement.id}`);
      if (!known.has(requirementKey)) { known.add(requirementKey); placeholders.push([requirementKey, json({ id: requirementKey, inferredFromEvidenceRequirement: requirement.id })]); }
      const evidenceState = resolution.evidence?.[requirement.id] || {};
      return [String(requirement.id), requirementKey, json({ ...requirement, submitted: evidenceState }), evidenceState.status || requirement.status || "OPEN", evidenceState.artifactId || null];
    }));
    const column = (rows, index) => rows.map((row) => row[index]);
    if (requirements.length) {
      await client.query(`INSERT INTO ubo_poc_fact_requirements (case_id, requirement_key, snapshot, current_status)
        SELECT $1, r.key, r.snapshot::jsonb, r.status FROM unnest($2::text[], $3::text[], $4::text[]) AS r(key, snapshot, status)
        ON CONFLICT (case_id, requirement_key) DO UPDATE SET snapshot=EXCLUDED.snapshot,
        current_status=EXCLUDED.current_status, updated_at=NOW()`, [caseId, column(requirements, 0), column(requirements, 1), column(requirements, 2)]);
    }
    if (placeholders.length) {
      await client.query(`INSERT INTO ubo_poc_fact_requirements (case_id, requirement_key, snapshot, current_status)
        SELECT $1, r.key, r.snapshot::jsonb, 'CURRENT' FROM unnest($2::text[], $3::text[]) AS r(key, snapshot)
        ON CONFLICT (case_id, requirement_key) DO NOTHING`, [caseId, column(placeholders, 0), column(placeholders, 1)]);
    }
    if (questions.length) {
      await client.query(`INSERT INTO ubo_poc_questions (case_id, question_key, fact_requirement_key, snapshot, current_status)
        SELECT $1, q.key, q.requirement, q.snapshot::jsonb, q.status FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS q(key, requirement, snapshot, status)
        ON CONFLICT (case_id, question_key) DO UPDATE SET snapshot=EXCLUDED.snapshot,
        current_status=EXCLUDED.current_status, updated_at=NOW()`, [caseId, column(questions, 0), column(questions, 1), column(questions, 2), column(questions, 3)]);
    }
    if (evidence.length) {
      await client.query(`INSERT INTO ubo_poc_evidence_requirements (case_id, evidence_requirement_key, fact_requirement_key, snapshot, current_status, artifact_id)
        SELECT $1, e.key, e.requirement, e.snapshot::jsonb, e.status, e.artifact::uuid FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) AS e(key, requirement, snapshot, status, artifact)
        ON CONFLICT (case_id, evidence_requirement_key) DO UPDATE SET snapshot=EXCLUDED.snapshot,
        current_status=EXCLUDED.current_status, artifact_id=COALESCE(EXCLUDED.artifact_id, ubo_poc_evidence_requirements.artifact_id), updated_at=NOW()`,
      [caseId, column(evidence, 0), column(evidence, 1), column(evidence, 2), column(evidence, 3), column(evidence, 4)]);
    }
    if (operation === "SUBMIT_ANSWER" && resolution.submittedAnswer) {
      const { question, answer } = resolution.submittedAnswer;
      await client.query(`INSERT INTO ubo_poc_question_answers
        (case_id, question_key, idempotency_key, answer, actor_type, answered_at)
        VALUES ($1,$2,$3,$4::jsonb,'CUSTOMER',$5)
        ON CONFLICT (case_id, question_key, idempotency_key) DO NOTHING`,
      [caseId, String(question.id), idempotencyKey, json(answer), answer.answeredAt]);
    }
  }

  async persistAssessment(client, caseId, assessment, chartReference) {
    const trace = assessment?.trace;
    const current = trace?.verificationAssessment;
    if (!current?.assessmentVersionId || !current?.inputStateVersion) return;
    const evidenceReferences = [
      ...(chartReference?.artifactId ? [{ artifactId: chartReference.artifactId, extractionJobId: chartReference.jobId || null }] : []),
      ...Object.values(assessment?.evidence || {}).filter(({ artifactId }) => artifactId).map(({ artifactId }) => ({ artifactId })),
    ];
    await client.query(`INSERT INTO ubo_poc_assessment_versions
      (assessment_id, case_id, policy_id, policy_version, input_state_version, evidence_references, assessment, calculated_at, finalized_at)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)
      ON CONFLICT (case_id, assessment_id) DO UPDATE SET finalized_at = EXCLUDED.finalized_at`, [current.assessmentVersionId, caseId,
      trace.policy?.policyId || "UK_CORPORATE_UBO", current.policyVersion || trace.policy?.policyVersion || "1.0",
      current.inputStateVersion, json(evidenceReferences), json(trace), current.calculatedAt,
      current.finalized ? (current.calculatedAt || new Date().toISOString()) : null]);
    for (const person of current.verificationPopulation || []) {
      await client.query(`INSERT INTO ubo_poc_verification_requirements
        (case_id, assessment_id, person_key, snapshot, current_status)
        VALUES ($1,$2,$3,$4::jsonb,$5)
        ON CONFLICT (case_id, assessment_id, person_key) DO UPDATE SET snapshot=EXCLUDED.snapshot,
        current_status=EXCLUDED.current_status, updated_at=NOW()`, [caseId, current.assessmentVersionId,
      String(person.personId || person.personName), json(person), person.currentRequirementStatus || "REQUIRED"]);
    }
  }

  async persistVerificationEvent(client, caseId, payload, idempotencyKey) {
    const trace = payload.trace;
    const assessmentId = trace?.verificationAssessment?.assessmentVersionId;
    const person = (trace?.idvCompletionHistory || []).find((item) => String(item.personId) === String(payload.personId));
    if (!assessmentId || !person) return;
    await client.query(`INSERT INTO ubo_poc_verification_events
      (case_id, assessment_id, person_key, event_type, verification_mode, idempotency_key, payload, occurred_at)
      VALUES ($1,$2,$3,'IDV_COMPLETED','DEMO',$4,$5::jsonb,$6)
      ON CONFLICT (case_id, event_type, idempotency_key) DO NOTHING`, [caseId, assessmentId,
      String(person.personId || person.personName), idempotencyKey, json({ ...person, verificationMode: "DEMO" }), person.completedAt]);
  }
}

// The demo's identity verification is a button: no document is checked. That
// stays honest only while the SERVER decides it - the deployment is in demo
// mode, the person is one its own stored assessment requires, and the record
// says plainly that nothing was verified. Anything the browser sends as a
// trace, assessment or research result for this operation is discarded.
async function demoIdentityVerificationPayload(repository, caseId, payload) {
  if (String(process.env.UBO_POC_IDV_MODE || "").trim().toUpperCase() !== "DEMO") {
    throw Object.assign(new Error("Identity verification is not available on this deployment."), { statusCode: 403, code: "idv_demo_mode_off" });
  }
  const record = await repository.get(caseId);
  const stored = serverTraceOf(record?.projection);
  // Only from the server's own assessment, finalised and ready - not from a
  // trace a browser wrote before UBO-13, and not while questions are open.
  if (!stored || stored.computedBy !== "server" || !stored.verificationAssessment?.finalized || !isReadyForIdentityVerification(stored)) {
    throw Object.assign(new Error("Identity verification starts once the ownership review has been finalised."), { statusCode: 409, code: "not_finalized" });
  }
  const now = new Date().toISOString();
  const next = stored ? completeIdentityVerification(stored, payload?.personId, now) : null;
  // completeIdentityVerification hands back the same trace when the person is
  // not a natural person the stored assessment currently requires.
  if (!next || next === stored) {
    throw Object.assign(new Error("This person does not need identity verification in the current assessment."), { statusCode: 400, code: "idv_person_not_required" });
  }
  // Same comparison the engine uses to find the subject (verificationAssessment.js#normalized).
  const key = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const samePerson = (item) => key(item?.personId) === key(payload?.personId);
  const completed = next.idvCompletionHistory.find(samePerson);
  const trace = {
    ...next,
    idvCompletionHistory: next.idvCompletionHistory.map((item) => item === completed && !item.verificationMode
      ? { ...item, verificationMode: "DEMO", verificationLabel: "DEMO - not verified" }
      : item),
  };
  return { personId: completed.personId, trace, assessment: { ...(record.projection?.assessment || {}), trace } };
}

/** The chart a case records: the extraction job's own result, re-evaluated
 *  on the server with the company stored on the job so it carries the current
 *  calculation semantics - what the browser used to do and send back. */
function serverChartProjection(job, caseId) {
  if (!job.result || !["COMPLETE", "PARTIAL"].includes(job.state)) {
    throw Object.assign(new Error("The ownership chart has not finished being read yet."), { statusCode: 409, code: "extraction_not_ready" });
  }
  try {
    const { reevaluateSavedCustomerOwnershipChart } = require("./customerOwnershipChartDemo");
    return reevaluateSavedCustomerOwnershipChart({ demoContext: { demoCaseId: caseId, referenceCaseId: "", company: job.company || job.result.company }, savedResult: job.result });
  } catch (_) {
    return job.result; // an older result the re-evaluation cannot read is kept as extracted
  }
}

// The operations whose resolution and assessment the server computes itself
// (UBO-13): the browser's copy is only ever a source of the customer's answers.
const SERVER_COMPUTED = new Set(["SYNC_RESOLUTION", "SUBMIT_ANSWER", "FINALIZE_ASSESSMENT", "RESET_ANSWERS"]);
// The methods the screens offer (src/uboDemo/calculationPresentation.js).
const CALCULATION_METHODS = new Set(["POLICY_ALL_ROUTES", "EFFECTIVE_INTEREST", "PSC_CONDITION_ATTRIBUTION"]);

function companyKey(company) {
  const text = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${text(company?.registrationNumber)}|${text(company?.legalName)}`;
}

/** A chart is only for the company the case is about. */
function sameCompany(a, b) {
  return Boolean(a && b) && companyKey(a) === companyKey(b);
}

class PocCaseService {
  constructor(repository) { this.repository = repository; }

  /** The case's audit ledger - for staff; the route decides who asks. */
  async ledger(caseId) {
    return this.repository.ledger ? this.repository.ledger(caseId) : [];
  }

  async savedResearch() {
    return this.repository.savedResearch ? this.repository.savedResearch() : [];
  }

  async load(caseId) {
    const record = await this.repository.get(caseId);
    if (!record) return null;
    const extraction = await this.repository.extraction(record.latestExtractionJobId);
    const history = await this.repository.history(caseId);
    return compactCaseRecordForTransport({ ...record, extraction, history });
  }

  async apply(command) {
    const caseId = String(command.caseId || command.payload?.demoCase?.demoCaseId || "").trim();
    if (!caseId) throw Object.assign(new Error("caseId is required"), { statusCode: 400, code: "case_id_required" });
    if (!command.idempotencyKey) throw Object.assign(new Error("idempotencyKey is required"), { statusCode: 400, code: "idempotency_key_required" });
    const operation = command.operation;
    const customer = command.actorType === "CUSTOMER";
    let incoming = { ...(command.payload || {}) };

    // What each step may carry (UBO-13, and its adversarial review):
    // - research is the analyst's, recorded by SAVE_RESEARCH alone;
    // - the company the case is about is the analyst's - a customer renaming it
    //   emptied the questions, since research and chart facts are matched to it;
    // - a resolution or assessment is only ever the server's own; carried by any
    //   other step it wrote audit rows (and could pre-empt the server's ids).
    if (operation !== "SAVE_RESEARCH") delete incoming.researchResult;
    if (incoming.researchResult?.ownershipResolutionTrace !== undefined) {
      const { ownershipResolutionTrace: _trace, ...research } = incoming.researchResult;
      incoming.researchResult = research;
    }
    // Reopening a finalised case is the analyst's decision.
    if (operation === "REOPEN_CASE" && customer) throw Object.assign(new Error("Only the analyst can reopen a review."), { statusCode: 403, code: "not_a_customer_operation" });
    if (customer || operation === "ASSOCIATE_CHART") { delete incoming.company; delete incoming.demoCase; delete incoming.draft; }
    if (!SERVER_COMPUTED.has(operation)) { delete incoming.resolution; delete incoming.assessment; }

    if (operation === "ASSOCIATE_CHART") {
      // The chart is a job started for THIS case, for THIS company - and the
      // server's own reading of it. Nothing about it is taken from the request
      // but the job id and the calculation method.
      const jobId = incoming.chartReference?.jobId;
      if (!jobId) throw Object.assign(new Error("A chart is attached from its extraction job."), { statusCode: 400, code: "job_required" });
      const job = await this.repository.extraction(jobId);
      if (!job || job.demoCaseId !== caseId) throw Object.assign(new Error("Extraction job was not found."), { statusCode: 404, code: "job_not_found" });
      if (job.evidenceHandoff) throw Object.assign(new Error("That file was uploaded as evidence, not as the ownership chart."), { statusCode: 409, code: "not_a_chart" });
      const record = await this.repository.get(caseId);
      if (serverTraceOf(record?.projection)?.verificationAssessment?.finalized) {
        throw Object.assign(new Error("This review has been finalised; the analyst can reopen it."), { statusCode: 409, code: "case_finalized" });
      }
      const caseCompany = record?.projection?.demoCase?.company || record?.company;
      if (!sameCompany(job.company, caseCompany)) throw Object.assign(new Error("This chart was read for a different company."), { statusCode: 409, code: "chart_company_mismatch" });
      const method = CALCULATION_METHODS.has(incoming.chartReference?.calculationMethod) ? incoming.chartReference.calculationMethod : "EFFECTIVE_INTEREST";
      incoming = {
        chartReference: { jobId: job.jobId, artifactId: job.artifactId, state: job.state, calculationMethod: method },
        chartProjection: serverChartProjection(job, caseId),
      };
    }

    const requested = incoming;
    for (let attempt = 1; ; attempt += 1) {
    incoming = requested;
    let expectedVersion = null;
    if (SERVER_COMPUTED.has(operation)) {
      const record = await this.repository.get(caseId);
      expectedVersion = record?.version || null;
      // A finalised assessment is what identity verification was started
      // from; answers after that would change it with no new finalisation.
      const stored = serverTraceOf(record?.projection);
      if (stored?.verificationAssessment?.finalized) {
        throw Object.assign(new Error("This review has been finalised and can no longer be changed."), { statusCode: 409, code: "case_finalized" });
      }
      const computed = await computeCaseAssessment({
        projection: record?.projection,
        caseId,
        operation,
        incoming,
        findEvidenceResult: (artifactId) => (this.repository.evidenceResult ? this.repository.evidenceResult(caseId, artifactId) : null),
      });
      incoming = { resolution: computed.resolution, assessment: computed.assessment };
    }
    const payload = command.operation === "COMPLETE_IDV"
      ? await demoIdentityVerificationPayload(this.repository, caseId, incoming)
      : compactCasePayload(incoming);
    const release = command.operation === "SAVE_RESEARCH" ? evaluateResearchRelease(payload?.researchResult) : null;
    if (operation === "SAVE_RESEARCH" || operation === "UPSERT_CASE") {
      // New research or a renamed company would drop a finalised assessment
      // that identity verification started from: the analyst reopens first.
      const record = await this.repository.get(caseId);
      if (serverTraceOf(record?.projection)?.verificationAssessment?.finalized && !projectCommand(record.projection, operation, payload, release).assessment) {
        throw Object.assign(new Error("This review has been finalised; reopen it before changing its research or company."), { statusCode: 409, code: "case_finalized" });
      }
    }
    let result;
    try {
      result = await this.repository.apply({ ...command, payload, caseId, actorType: command.actorType || "SYSTEM", release, ...(expectedVersion ? { expectedVersion } : {}) });
    } catch (error) {
      // Worked out from a case that changed meanwhile: read it again and
      // recompute (a few times - two steps rarely collide more than once).
      if (error.code === "case_changed" && attempt < 3) continue;
      throw error;
    }
    // What was written, not a fresh read of the case, its chart reading and
    // its history - a save's answer is small (reading a case is load()).
    const written = result.record || {};
    return {
      caseId,
      updatedAt: written.updatedAt || null,
      projection: written.projection || {},
      duplicate: result.duplicate,
      researchRelease: release || written.projection?.researchRelease || null,
    };
    }
  }
}

module.exports = {
  CASE_CONTRACT,
  RELEASE_STATE,
  PocCaseService,
  PostgresPocCaseRepository,
  evaluateResearchRelease,
  frontierCanChangeVerificationPopulation,
  compactCasePayload,
  compactCaseRecordForTransport,
  stableHash,
  projectCommand,
};
