"use strict";

// UBO-33: the case's append-only audit ledger (docs/ubo/AUDIT-LEDGER-PLAN.md).
// What each case step records, worked out from the case before and after it;
// written in the same transaction as the step (pocCaseState.js).

const { retainUntil } = require("../../lib/uboRetention");

// Mirrored from the calculation's own history as they appear. Its answer and
// verification events are left out: the case steps record those, with the
// times the calculation does not know.
const ASSESSMENT_EVENTS = Object.freeze([
  "OWNERSHIP_CONTROL_ASSESSMENT_RECALCULATED",
  "IDV_REQUIREMENT_CREATED",
  "IDV_REQUIREMENT_NO_LONGER_CURRENT",
  "AGGREGATE_OWNERSHIP_CHANGED",
  "UBO_DETERMINATION_CHANGED",
  "SENIOR_MANAGEMENT_FALLBACK_ACTIVATED",
  "FINAL_VERIFICATION_ASSESSMENT_CREATED",
]);

const EVENT_TYPES = Object.freeze([
  "CASE_CREATED",
  "CASE_COMPANY_CHANGED",
  "RESEARCH_RECORDED",
  "OWNERSHIP_CHART_ATTACHED",
  "QUESTION_ASKED",
  "CUSTOMER_ANSWER_RECEIVED",
  "CUSTOMER_ANSWERS_RESET",
  "EVIDENCE_RECEIVED",
  "EVIDENCE_DECIDED",
  "UBO_ASSESSMENT_COMPLETED",
  "IDV_COMPLETED",
  "APPLICATION_SUBMITTED",
  "ANALYST_OVERRIDE",
  "DOCUMENT_UPLOADED",
  "DOCUMENT_EXTRACTED",
  "DOCUMENT_EXTRACTION_FAILED",
  "CUSTOMER_LINK_ISSUED",
  "CUSTOMER_LINK_REVOKED",
  ...ASSESSMENT_EVENTS,
]);

const ACTOR_TYPES = new Set(["CUSTOMER", "ANALYST", "SYSTEM"]);

function companyOf(projection) {
  return projection?.demoCase?.company || projection?.company || null;
}

function traceIds(projection) {
  const traces = [projection?.assessment?.trace, projection?.resolution?.trace, projection?.resolution?.priorTrace];
  return new Set(traces.flatMap((trace) => (trace?.auditEvents || []).map(({ eventId }) => eventId)));
}

/** The ledger events one case step produced. Pure: the case before and after
 *  the step, and who, when and under which ids. */
function eventsForCommand({ caseId, operation, before, after, payload = {}, operationId, actor = {}, correlationId, receivedAt, researchChanged = false }) {
  const base = {
    caseId,
    actorType: ACTOR_TYPES.has(actor.type) ? actor.type : "SYSTEM",
    actorId: actor.id || null,
    operationId,
    correlationId: correlationId || operationId,
    receivedAt,
  };
  const out = [];
  const add = (eventType, fields = {}) => out.push({
    ...base,
    eventType,
    occurredAt: fields.occurredAt || receivedAt,
    effectiveAt: fields.effectiveAt || null,
    relatedAssertionId: fields.relatedAssertionId || null,
    relatedArtifactId: fields.relatedArtifactId || null,
    relatedAssessmentId: fields.relatedAssessmentId || null,
    relatedQuestionId: fields.relatedQuestionId || null,
    reasonCode: fields.reasonCode || null,
    detail: fields.detail || {},
    subject: fields.subject || "",
  });

  const was = companyOf(before);
  const now = companyOf(after);
  if (operation === "UPSERT_CASE") {
    if (!was && now) add("CASE_CREATED", { detail: { legalName: now.legalName || null, registrationNumber: now.registrationNumber || null } });
    else if (was && now && JSON.stringify([was.legalName, was.registrationNumber]) !== JSON.stringify([now.legalName, now.registrationNumber])) {
      add("CASE_COMPANY_CHANGED", { reasonCode: "COMPANY_RENAMED", detail: { from: was.legalName || null, to: now.legalName || null } });
    }
  }
  if (operation === "SAVE_RESEARCH" && researchChanged) add("RESEARCH_RECORDED", { detail: { status: after?.researchResult?.status || null, jobId: after?.researchResult?.jobId || null } });
  if (operation === "ASSOCIATE_CHART") {
    const chart = after?.chartReference || {};
    add("OWNERSHIP_CHART_ATTACHED", { relatedArtifactId: chart.artifactId, subject: chart.jobId, detail: { jobId: chart.jobId || null, calculationMethod: chart.calculationMethod || null } });
  }
  if (operation === "RESET_ANSWERS") add("CUSTOMER_ANSWERS_RESET");
  if (operation === "REOPEN_CASE") add("ANALYST_OVERRIDE", { reasonCode: "CASE_REOPENED", relatedAssessmentId: before?.assessment?.assessmentId });

  const asked = new Set((before?.resolution?.questions || []).map(({ id }) => id));
  for (const question of after?.resolution?.questions || []) {
    if (!asked.has(question.id)) add("QUESTION_ASKED", { relatedQuestionId: question.id, subject: question.id, detail: { type: question.type || null, prompt: question.prompt || null } });
  }

  const submitted = operation === "SUBMIT_ANSWER" ? after?.resolution?.submittedAnswer : null;
  if (submitted?.question?.id) {
    const { question, answer } = submitted;
    const dated = question.type === "DATE" && typeof answer?.value === "string" && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(answer.value) && Number.isFinite(Date.parse(answer.value));
    add("CUSTOMER_ANSWER_RECEIVED", {
      relatedQuestionId: question.id,
      subject: question.id,
      occurredAt: answer?.answeredAt,
      // A dated answer - a transfer on 12 September - takes effect then.
      effectiveAt: dated ? new Date(answer.value).toISOString() : null,
      detail: { value: answer?.value ?? null },
    });
  }

  const previous = before?.resolution?.evidence || {};
  for (const [requirementId, evidence] of Object.entries(after?.resolution?.evidence || {})) {
    if (!evidence?.artifactId) continue;
    const prior = previous[requirementId];
    const fields = { relatedArtifactId: evidence.artifactId, reasonCode: evidence.status || null, subject: `${requirementId}:${evidence.artifactId}:${evidence.status || ""}`, detail: { requirementId } };
    if (prior?.artifactId !== evidence.artifactId) add("EVIDENCE_RECEIVED", fields);
    else if (prior?.status !== evidence.status) add("EVIDENCE_DECIDED", fields);
  }

  const seen = traceIds(before);
  for (const item of after?.assessment?.trace?.auditEvents || []) {
    if (seen.has(item.eventId) || !ASSESSMENT_EVENTS.includes(item.type)) continue;
    const { eventId, type, assessmentVersionId, occurredAt, ...detail } = item;
    add(type, { relatedAssessmentId: assessmentVersionId, occurredAt, subject: eventId, detail });
  }

  if (operation === "FINALIZE_ASSESSMENT" && after?.assessment?.assessmentId) add("UBO_ASSESSMENT_COMPLETED", { relatedAssessmentId: after.assessment.assessmentId });
  if (operation === "COMPLETE_IDV") {
    add("IDV_COMPLETED", {
      relatedAssessmentId: after?.assessment?.trace?.verificationAssessment?.assessmentVersionId || after?.assessment?.assessmentId,
      subject: String(payload.personId || ""),
      reasonCode: payload.mode || null,
      detail: { personId: payload.personId || null },
    });
  }
  if (operation === "SUBMIT_APPLICATION") {
    add("APPLICATION_SUBMITTED", {
      relatedAssessmentId: payload.assessmentVersionId || after?.assessment?.assessmentId,
      occurredAt: payload.submittedAt,
    });
  }
  return out;
}

/** An event about an uploaded document, from the document route. */
function documentEvent({ tenantJob, eventType, actor = {}, receivedAt }) {
  return {
    caseId: tenantJob.demoCaseId,
    actorType: ACTOR_TYPES.has(actor.type) ? actor.type : "SYSTEM",
    actorId: actor.id || null,
    operationId: tenantJob.correlationId,
    correlationId: tenantJob.correlationId,
    receivedAt,
    eventType,
    occurredAt: receivedAt,
    effectiveAt: null,
    relatedAssertionId: null,
    relatedArtifactId: tenantJob.artifactId || null,
    relatedAssessmentId: null,
    relatedQuestionId: null,
    reasonCode: eventType === "DOCUMENT_EXTRACTION_FAILED" ? "EXTRACTION_FAILED" : null,
    detail: { jobId: tenantJob.jobId, state: tenantJob.state },
    subject: `${tenantJob.jobId}:${tenantJob.correlationId}`,
  };
}

/** A customer link made or withdrawn for a case. Who it was sent to is not
 *  kept here: the link carries that, and the ledger does not need it. */
function linkEvent({ caseId, eventType, actor = {}, receivedAt, operationId, expiresAt = null }) {
  return {
    caseId,
    actorType: ACTOR_TYPES.has(actor.type) ? actor.type : "SYSTEM",
    actorId: actor.id || null,
    operationId,
    correlationId: operationId,
    receivedAt,
    eventType,
    occurredAt: receivedAt,
    effectiveAt: null,
    relatedAssertionId: null,
    relatedArtifactId: null,
    relatedAssessmentId: null,
    relatedQuestionId: null,
    reasonCode: null,
    detail: expiresAt ? { expiresAt } : {},
    subject: operationId,
  };
}

/** Writes events; a replayed step records nothing twice. All of a step's
 *  events go in one statement: one round trip each made a step with ten events
 *  take ten (review, 2026-10-09). Every event is checked before any is written. */
async function record(executor, tenantId, events) {
  const COLUMNS = 18;
  const rows = [];
  for (const raw of events) {
    const event = { ...raw, receivedAt: raw.receivedAt || new Date().toISOString() };
    event.occurredAt = event.occurredAt || event.receivedAt;
    if (!EVENT_TYPES.includes(event.eventType)) throw new Error(`Unknown audit event type: ${event.eventType}`);
    if (!event.caseId) continue;
    rows.push([
      tenantId, event.caseId, event.actorType, event.actorId, event.eventType, event.occurredAt, event.receivedAt, event.effectiveAt,
      event.correlationId, event.operationId, event.relatedAssertionId, event.relatedArtifactId, event.relatedAssessmentId,
      event.relatedQuestionId, event.reasonCode, JSON.stringify(event.detail || {}), retainUntil(event.receivedAt),
      `${event.caseId}:${event.operationId}:${event.eventType}:${event.subject}`,
    ]);
  }
  if (!rows.length) return;
  const values = rows.map((_, row) => `(${Array.from({ length: COLUMNS }, (__, column) => `$${row * COLUMNS + column + 1}${column === 15 ? "::jsonb" : ""}`).join(",")})`);
  await executor.query(`INSERT INTO ubo_audit_events
      (tenant_id, case_id, actor_type, actor_id, event_type, occurred_at, received_at, effective_at, correlation_id, operation_id,
       related_assertion_id, related_artifact_id, related_assessment_id, related_question_id, reason_code, detail, retain_until, dedupe_key)
      VALUES ${values.join(", ")}
      ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`, rows.flat());
}

/** A case's ledger, oldest first - the most recent `limit` events of a long one. */
async function list(executor, tenantId, caseId, limit = 1000) {
  const result = await executor.query(`SELECT event_id, actor_type, actor_id, event_type, occurred_at, received_at, recorded_at, effective_at,
      correlation_id, operation_id, related_assertion_id, related_artifact_id, related_assessment_id, related_question_id, reason_code, detail
    FROM ubo_audit_events WHERE tenant_id = $1 AND case_id = $2 ORDER BY recorded_at DESC, occurred_at DESC, event_id DESC LIMIT $3`, [tenantId, caseId, limit]);
  const iso = (value) => (value instanceof Date ? value.toISOString() : value);
  return (result?.rows || result || []).slice().reverse().map((row) => ({
    eventId: row.event_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    eventType: row.event_type,
    occurredAt: iso(row.occurred_at),
    receivedAt: iso(row.received_at),
    recordedAt: iso(row.recorded_at),
    effectiveAt: iso(row.effective_at),
    correlationId: row.correlation_id,
    operationId: row.operation_id,
    relatedAssertionId: row.related_assertion_id,
    relatedArtifactId: row.related_artifact_id,
    relatedAssessmentId: row.related_assessment_id,
    relatedQuestionId: row.related_question_id,
    reasonCode: row.reason_code,
    detail: row.detail || {},
  }));
}

module.exports = { EVENT_TYPES, ASSESSMENT_EVENTS, eventsForCommand, documentEvent, linkEvent, record, list };
