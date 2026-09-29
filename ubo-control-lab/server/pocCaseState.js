"use strict";

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
  return Object.fromEntries(Object.entries(recalculations).map(([key, record]) => [key, record?.chartAnalysis
    ? { ...record, chartAnalysis: compactAnalysis(record.chartAnalysis) }
    : record]));
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

function traceFrom(value) {
  return value?.assessment?.trace || value?.resolution?.trace || value?.researchResult?.ownershipResolutionTrace || null;
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

function projectCommand(current, operation, payload, release) {
  const base = { contractVersion: CASE_CONTRACT, ...compactCaseProjection(current || {}) };
  payload = compactCasePayload(payload);
  const durableResearchResult = payload?.researchResult
    ? Object.fromEntries(Object.entries(payload.researchResult).filter(([key]) => key !== "displayState"))
    : null;
  if (payload?.draft) base.draft = payload.draft;
  if (payload?.demoCase) base.demoCase = payload.demoCase;
  if (payload?.company) base.company = payload.company;
  if (operation === "UPSERT_CASE") return { ...base, currentStage: base.currentStage || "COMPANY_DETAILS" };
  if (operation === "SAVE_RESEARCH") return {
    ...base,
    researchResult: durableResearchResult,
    researchRelease: release,
    currentStage: release.mayProceed ? "RESEARCH_COMPLETE" : "DISCOVERY_IN_PROGRESS",
  };
  if (operation === "ASSOCIATE_CHART") return {
    ...base,
    chartReference: payload.chartReference,
    chartProjection: payload.chartProjection || base.chartProjection,
    currentStage: "OWNERSHIP_COMPLETE",
  };
  if (["SYNC_RESOLUTION", "SUBMIT_ANSWER", "FINALIZE_ASSESSMENT"].includes(operation)) {
    const incomingTrace = traceFrom({ assessment: payload.assessment, resolution: payload.resolution, researchResult: durableResearchResult });
    const currentTrace = traceFrom(base);
    const incomingTime = traceTime(incomingTrace);
    const currentTime = traceTime(currentTrace);
    const stale = incomingTime != null && currentTime != null && incomingTime < currentTime;
    const incomingResolution = mergeResolution(base.resolution, payload.resolution);
    const resolution = stale ? mergeResolution(incomingResolution, base.resolution) : incomingResolution;
    const assessment = stale ? base.assessment : (payload.assessment || base.assessment);
    const researchResult = stale ? base.researchResult : (durableResearchResult || base.researchResult);
    const selectedTrace = traceFrom({ assessment, resolution, researchResult }) || currentTrace;
    return {
      ...base,
      resolution,
      assessment,
      researchResult,
      currentStage: stageFromTrace(selectedTrace, "QUESTIONS"),
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

  async get(caseId, executor = this.db) {
    const row = first(await executor.query(`SELECT case_id, tenant_id, company, current_stage,
      research_release_state, latest_extraction_job_id, latest_artifact_id, current_assessment_id,
      current_projection, created_at, updated_at
      FROM ubo_poc_cases WHERE case_id = $1 AND tenant_id = $2`, [caseId, this.tenantId]));
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
    };
  }

  async history(caseId) {
    return rows(await this.db.query(`SELECT event_id, event_type, actor_type, occurred_at
      FROM ubo_poc_case_events WHERE case_id = $1 ORDER BY occurred_at, event_id`, [caseId])).map((row) => ({
      eventId: row.event_id, eventType: row.event_type, actorType: row.actor_type, occurredAt: row.occurred_at,
    }));
  }

  async extraction(jobId) {
    if (!jobId) return null;
    const row = first(await this.db.query(`SELECT id, artifact_id, state, result, completed_at
      FROM evidence_customer_extraction_jobs WHERE id = $1 AND tenant_id = $2`, [jobId, this.tenantId]));
    return row ? { jobId: row.id, artifactId: row.artifact_id, state: row.state, result: row.result, completedAt: row.completed_at } : null;
  }

  async apply({ caseId, operation, idempotencyKey, actorType, payload, release }) {
    return this.db.transaction(async (client) => {
      const company = payload.demoCase?.company || payload.company;
      const existingCase = await this.get(caseId, client);
      if (!existingCase) {
        if (!company) throw Object.assign(new Error("A company is required when creating a POC case"), { statusCode: 400, code: "company_required" });
        await client.query(`INSERT INTO ubo_poc_cases (case_id, tenant_id, company, current_projection)
          VALUES ($1, $2, $3::jsonb, '{}'::jsonb)`, [caseId, this.tenantId, json(company)]);
      }
      await client.query("SELECT case_id FROM ubo_poc_cases WHERE case_id = $1 AND tenant_id = $2 FOR UPDATE", [caseId, this.tenantId]);
      const inserted = first(await client.query(`INSERT INTO ubo_poc_case_events
        (case_id, event_type, idempotency_key, actor_type, payload)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (case_id, event_type, idempotency_key) DO NOTHING
        RETURNING event_id`, [caseId, operation, idempotencyKey, actorType, json(payload)]));
      const existing = await this.get(caseId, client);
      if (!inserted && operation !== "SUBMIT_ANSWER") return { record: existing, duplicate: true };
      const projection = projectCommand(existing?.projection, operation, payload, release);
      const chart = projection.chartReference || {};
      const assessmentId = projection.assessment?.assessmentId || projection.assessment?.trace?.verificationAssessment?.assessmentVersionId || null;
      await client.query(`UPDATE ubo_poc_cases SET company = $2::jsonb, current_stage = $3,
        research_release_state = $4, latest_extraction_job_id = $5, latest_artifact_id = $6,
        current_assessment_id = $7, current_projection = $8::jsonb, updated_at = NOW()
        WHERE case_id = $1`, [caseId, json(projection.demoCase?.company || projection.company || company), projection.currentStage,
        projection.researchRelease?.state || existing?.researchReleaseState || null,
        chart.jobId || existing?.latestExtractionJobId || null, chart.artifactId || existing?.latestArtifactId || null,
        assessmentId, json(projection)]);
      await this.persistResolution(client, caseId, payload.resolution, operation, idempotencyKey);
      await this.persistAssessment(client, caseId, payload.assessment, projection.chartReference);
      if (operation === "COMPLETE_IDV") await this.persistVerificationEvent(client, caseId, payload, idempotencyKey);
      console.info("[ubo-poc-case] projection-applied", {
        caseRef: stableHash(caseId).slice(0, 12),
        operation,
        duplicate: !inserted,
        submittedAnswer: Boolean(payload.resolution?.submittedAnswer?.question?.id),
        answerCount: Object.keys(projection.resolution?.answers || {}).length,
        stage: projection.currentStage,
      });
      return { record: await this.get(caseId, client), duplicate: !inserted };
    });
  }

  async persistResolution(client, caseId, resolution, operation, idempotencyKey) {
    if (!resolution) return;
    const requirements = resolution.requirements || [];
    const known = new Set();
    for (const item of requirements) {
      const key = String(item.id || item.factRequirementId || item.comparisonItemId);
      known.add(key);
      await client.query(`INSERT INTO ubo_poc_fact_requirements
        (case_id, requirement_key, snapshot, current_status) VALUES ($1,$2,$3::jsonb,$4)
        ON CONFLICT (case_id, requirement_key) DO UPDATE SET snapshot=EXCLUDED.snapshot,
        current_status=EXCLUDED.current_status, updated_at=NOW()`, [caseId, key, json(item), item.status || "CURRENT"]);
    }
    for (const question of resolution.questions || []) {
      const requirementKey = String(question.factRequirementId || question.comparisonItemId || `question:${question.id}`);
      if (!known.has(requirementKey)) {
        await client.query(`INSERT INTO ubo_poc_fact_requirements
          (case_id, requirement_key, snapshot, current_status) VALUES ($1,$2,$3::jsonb,'CURRENT')
          ON CONFLICT (case_id, requirement_key) DO NOTHING`, [caseId, requirementKey, json({ id: requirementKey, inferredFromQuestion: question.id })]);
        known.add(requirementKey);
      }
      await client.query(`INSERT INTO ubo_poc_questions
        (case_id, question_key, fact_requirement_key, snapshot, current_status) VALUES ($1,$2,$3,$4::jsonb,$5)
        ON CONFLICT (case_id, question_key) DO UPDATE SET snapshot=EXCLUDED.snapshot,
        current_status=EXCLUDED.current_status, updated_at=NOW()`, [caseId, String(question.id), requirementKey, json(question), question.status || "OPEN"]);
    }
    for (const requirement of resolution.evidenceRequirements || []) {
      const requirementKey = String(requirement.factRequirementId || requirement.comparisonItemId || `evidence:${requirement.id}`);
      if (!known.has(requirementKey)) {
        await client.query(`INSERT INTO ubo_poc_fact_requirements
          (case_id, requirement_key, snapshot, current_status) VALUES ($1,$2,$3::jsonb,'CURRENT')
          ON CONFLICT (case_id, requirement_key) DO NOTHING`, [caseId, requirementKey, json({ id: requirementKey, inferredFromEvidenceRequirement: requirement.id })]);
        known.add(requirementKey);
      }
      const evidenceState = resolution.evidence?.[requirement.id] || {};
      await client.query(`INSERT INTO ubo_poc_evidence_requirements
        (case_id, evidence_requirement_key, fact_requirement_key, snapshot, current_status, artifact_id)
        VALUES ($1,$2,$3,$4::jsonb,$5,$6)
        ON CONFLICT (case_id, evidence_requirement_key) DO UPDATE SET snapshot=EXCLUDED.snapshot,
        current_status=EXCLUDED.current_status, artifact_id=COALESCE(EXCLUDED.artifact_id, ubo_poc_evidence_requirements.artifact_id), updated_at=NOW()`,
      [caseId, String(requirement.id), requirementKey, json({ ...requirement, submitted: evidenceState }), evidenceState.status || requirement.status || "OPEN", evidenceState.artifactId || null]);
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
      ON CONFLICT (case_id, assessment_id) DO NOTHING`, [current.assessmentVersionId, caseId,
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

class PocCaseService {
  constructor(repository) { this.repository = repository; }

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
    const payload = compactCasePayload(command.payload);
    const release = command.operation === "SAVE_RESEARCH" ? evaluateResearchRelease(payload?.researchResult) : null;
    const result = await this.repository.apply({ ...command, payload, caseId, actorType: command.actorType || "SYSTEM", release });
    return { ...(await this.load(caseId)), duplicate: result.duplicate, researchRelease: release || result.record?.projection?.researchRelease || null };
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
