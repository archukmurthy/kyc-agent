"use strict";

const { randomUUID } = require("crypto");
const { LIFECYCLE_EVENTS, CANONICAL_STATUSES } = require("../domain/constants");
const { METRIC_DEFINITION_VERSION } = require("./metricDefinitions");

const LOW_SAMPLE_THRESHOLD = 30;
const MEASUREMENT_SOURCE = "OUR_MEASURED_METRIC";

function createLifecycleEvent({ type, session, occurredAt = new Date(), dimensions = {}, metadata = {} }) {
  if (!Object.values(LIFECYCLE_EVENTS).includes(type)) throw new TypeError(`Unknown IDV lifecycle event: ${type}`);
  return {
    event_id: randomUUID(),
    event_type: type,
    internal_idv_session_id: session.internal_idv_session_id,
    occurred_at: new Date(occurredAt).toISOString(),
    dimensions: {
      tenant_id: session.tenant_id,
      provider: session.provider,
      workflow: session.provider_workflow,
      workflow_version: session.provider_workflow_version,
      country: null,
      document_issuing_country: null,
      document_type: null,
      device_platform: null,
      liveness_method: null,
      database_verification_state: "UNKNOWN",
      nfc_state: "UNKNOWN",
      test_case_id: null,
      poc_cohort_id: null,
      ...(session.dimensions || {}),
      ...dimensions,
    },
    metadata: { ...metadata },
  };
}

function sampleWarning(n) { return n > 0 && n < LOW_SAMPLE_THRESHOLD ? `LOW_SAMPLE_SIZE_N_${n}` : null; }

function unavailable(reason, sampleSize = 0) {
  return {
    status: "UNAVAILABLE",
    value: null,
    numerator: null,
    denominator: null,
    sample_size: sampleSize,
    unavailable_reason: reason,
    measurement_source: MEASUREMENT_SOURCE,
    definition_version: METRIC_DEFINITION_VERSION,
    warning: sampleWarning(sampleSize),
  };
}

function ratioMetric(numerator, denominator, { limitation = null, metadata = {} } = {}) {
  if (!denominator) return unavailable("NO_ELIGIBLE_OBSERVATIONS", denominator || 0);
  const value = numerator / denominator;
  return {
    status: limitation ? "AVAILABLE_WITH_LIMITATION" : "AVAILABLE",
    value,
    display_percent: `${(value * 100).toFixed(denominator < LOW_SAMPLE_THRESHOLD ? 0 : 1)}%`,
    numerator,
    denominator,
    sample_size: denominator,
    unavailable_reason: null,
    limitation,
    measurement_source: MEASUREMENT_SOURCE,
    definition_version: METRIC_DEFINITION_VERSION,
    warning: sampleWarning(denominator),
    ...metadata,
  };
}

function valueMetric(value, sampleSize, metadata = {}) {
  if (value == null || !Number.isFinite(Number(value))) return unavailable(metadata.unavailable_reason || "NO_ELIGIBLE_OBSERVATIONS", sampleSize || 0);
  return {
    status: metadata.limitation ? "AVAILABLE_WITH_LIMITATION" : "AVAILABLE",
    value: Number(value),
    numerator: metadata.numerator ?? null,
    denominator: metadata.denominator ?? null,
    sample_size: sampleSize,
    unavailable_reason: null,
    measurement_source: MEASUREMENT_SOURCE,
    definition_version: METRIC_DEFINITION_VERSION,
    warning: sampleWarning(sampleSize),
    ...metadata,
  };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function distributions(values) {
  if (!values.length) return { average: null, p50: null, p90: null, p95: null, p99: null };
  return {
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
  };
}

function distributionMetric(values, { limitation = null, unavailableReason = "NO_VALID_TIMESTAMP_PAIRS" } = {}) {
  if (!values.length) return unavailable(unavailableReason);
  return {
    status: limitation ? "AVAILABLE_WITH_LIMITATION" : "AVAILABLE",
    value: distributions(values),
    numerator: null,
    denominator: values.length,
    sample_size: values.length,
    unavailable_reason: null,
    limitation,
    measurement_source: MEASUREMENT_SOURCE,
    definition_version: METRIC_DEFINITION_VERSION,
    warning: sampleWarning(values.length),
    percentile_method: "NEAREST_RANK",
  };
}

function filterEvents(events, filter = {}) {
  const dimensions = filter.dimensions || Object.fromEntries(Object.entries(filter).filter(([key]) => !["from", "to", "tenantId", "pocOnly"].includes(key)));
  return events.filter((event) => {
    const occurred = new Date(event.occurred_at).valueOf();
    if (filter.from && occurred < new Date(filter.from).valueOf()) return false;
    if (filter.to && occurred >= new Date(filter.to).valueOf()) return false;
    if (filter.tenantId && event.dimensions?.tenant_id !== filter.tenantId) return false;
    if (filter.pocOnly && !event.dimensions?.poc_cohort_id) return false;
    return Object.entries(dimensions).every(([key, value]) => value == null || event.dimensions?.[key] === value);
  });
}

function groupBySession(events) {
  const grouped = new Map();
  for (const event of [...events].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))) {
    const list = grouped.get(event.internal_idv_session_id) || [];
    list.push(event);
    grouped.set(event.internal_idv_session_id, list);
  }
  return grouped;
}

function sessionsWith(events, type) { return new Set(events.filter((event) => event.event_type === type).map((event) => event.internal_idv_session_id)); }

function terminalOutcomes(events) {
  const map = new Map();
  for (const event of events.filter((item) => [LIFECYCLE_EVENTS.IDV_TERMINAL, LIFECYCLE_EVENTS.IDV_COMPLETED].includes(item.event_type))) {
    const current = map.get(event.internal_idv_session_id);
    if (!current || event.event_type === LIFECYCLE_EVENTS.IDV_TERMINAL) map.set(event.internal_idv_session_id, event);
  }
  return map;
}

function durationValues(events, startType, endType, { endMetadataTimestamp, requireExactEnd = false } = {}) {
  const values = [];
  for (const sessionEvents of groupBySession(events).values()) {
    const starts = sessionEvents.filter((event) => event.event_type === startType);
    const ends = sessionEvents.filter((event) => event.event_type === endType);
    if (!starts.length || !ends.length) continue;
    const start = starts[0];
    const end = ends.find((candidate) => new Date(candidate.occurred_at) >= new Date(start.occurred_at));
    if (!end) continue;
    if (requireExactEnd && end.metadata?.timestamp_source !== "PROVIDER_EXACT") continue;
    const startTime = new Date(start.occurred_at).valueOf();
    const endTime = endMetadataTimestamp ? new Date(end.metadata?.[endMetadataTimestamp]).valueOf() : new Date(end.occurred_at).valueOf();
    const duration = endTime - startTime;
    if (Number.isFinite(duration) && duration >= 0) values.push(duration);
  }
  return values;
}

function providerDeliveryValues(events) {
  const values = [];
  for (const sessionEvents of groupBySession(events).values()) {
    const receipt = sessionEvents.find((event) => event.event_type === LIFECYCLE_EVENTS.PROVIDER_RESULT_RECEIVED && event.metadata?.provider_decided_at);
    if (!receipt) continue;
    const duration = new Date(receipt.occurred_at) - new Date(receipt.metadata.provider_decided_at);
    if (Number.isFinite(duration) && duration >= 0) values.push(duration);
  }
  return values;
}

function attemptMetric(events, type, predicate) {
  const relevant = events.filter((event) => event.event_type === type);
  if (!relevant.length) return unavailable("NO_PROVIDER_STAGE_OBSERVATIONS");
  if (relevant.some((event) => !Number.isInteger(event.metadata?.attempt))) return unavailable("PROVIDER_ATTEMPT_TELEMETRY_UNAVAILABLE", relevant.length);
  const bySession = groupBySession(relevant);
  const numerator = [...bySession.values()].filter((items) => predicate(items)).length;
  return ratioMetric(numerator, bySession.size);
}

function responseMetrics(events) {
  const presented = new Map();
  const responses = new Map();
  for (const event of events) {
    const id = event.metadata?.attribute_id;
    if (!id) continue;
    const key = `${event.internal_idv_session_id}:${id}`;
    if (event.event_type === LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_PRESENTED) presented.set(key, event);
    if ([LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_CONFIRMED, LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_CORRECTED, LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_REJECTED].includes(event.event_type)) responses.set(key, event);
  }
  const responded = [...responses.entries()].filter(([key]) => presented.has(key));
  const confirmed = responded.filter(([, event]) => event.event_type === LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_CONFIRMED).length;
  const corrected = responded.filter(([, event]) => event.event_type === LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_CORRECTED).length;
  const byField = {};
  for (const concept of new Set([...presented.values()].map((event) => event.metadata.attribute_concept))) {
    const fieldResponses = responded.filter(([, event]) => event.metadata.attribute_concept === concept);
    const fieldConfirmed = fieldResponses.filter(([, event]) => event.event_type === LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_CONFIRMED).length;
    const fieldCorrected = fieldResponses.filter(([, event]) => event.event_type === LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_CORRECTED).length;
    byField[concept] = {
      confirmation_rate: ratioMetric(fieldConfirmed, fieldResponses.length),
      correction_rate: ratioMetric(fieldCorrected, fieldResponses.length),
    };
  }
  return {
    identity_data_confirmation_rate: ratioMetric(confirmed, responded.length),
    field_correction_rate: ratioMetric(corrected, responded.length),
    per_field: byField,
  };
}

function selectedCosts(costs) {
  const bySession = new Map();
  for (const entry of costs || []) {
    const list = bySession.get(entry.internal_idv_session_id) || [];
    list.push(entry);
    bySession.set(entry.internal_idv_session_id, list);
  }
  const selected = new Map();
  for (const [sessionId, entries] of bySession) {
    const actual = entries.filter((entry) => entry.cost_basis === "ACTUAL_CONFIRMED");
    const used = actual.length ? actual : entries.filter((entry) => entry.cost_basis === "ESTIMATED");
    if (!used.length || used.some((entry) => entry.amount == null || !Number.isFinite(Number(entry.amount)))) continue;
    const currencies = new Set(used.map((entry) => entry.currency));
    if (currencies.size !== 1) { selected.set(sessionId, { mixedCurrency: true }); continue; }
    selected.set(sessionId, {
      amount: used.reduce((sum, entry) => sum + Number(entry.amount), 0),
      currency: used[0].currency,
      basis: actual.length ? "ACTUAL_CONFIRMED" : "ESTIMATED",
    });
  }
  return selected;
}

function costMetric(costMap, costCohort, outcomeCount) {
  const covered = [...costCohort].map((id) => costMap.get(id)).filter(Boolean);
  if (!outcomeCount) return unavailable("NO_ELIGIBLE_OUTCOMES", 0);
  if (!covered.length) return unavailable("COST_DATA_UNAVAILABLE", costCohort.size);
  if (covered.length !== costCohort.size) {
    return { ...unavailable("PARTIAL_PRICING_COVERAGE", covered.length), pricing_coverage: covered.length / Math.max(costCohort.size, 1) };
  }
  if (covered.some((item) => item.mixedCurrency) || new Set(covered.map((item) => item.currency)).size !== 1) return unavailable("MIXED_CURRENCY_WITHOUT_CONVERSION", covered.length);
  const total = covered.reduce((sum, item) => sum + item.amount, 0);
  const bases = [...new Set(covered.map((item) => item.basis))];
  return valueMetric(total / outcomeCount, covered.length, {
    numerator: total,
    denominator: outcomeCount,
    currency: covered[0].currency,
    cost_basis: bases.length === 1 ? bases[0] : "MIXED_ESTIMATE_AND_ACTUAL_CONFIRMED",
    pricing_coverage: 1,
  });
}

function calculateMetrics(allEvents, { labels = [], costs = [], filter = {} } = {}) {
  const events = filterEvents(allEvents, filter);
  const created = sessionsWith(events, LIFECYCLE_EVENTS.IDV_SESSION_CREATED);
  const opened = sessionsWith(events, LIFECYCLE_EVENTS.HOSTED_FLOW_OPENED);
  const terminals = terminalOutcomes(events);
  const verified = new Set([...terminals].filter(([, event]) => event.metadata?.canonical_status === CANONICAL_STATUSES.VERIFIED).map(([id]) => id));
  const abandoned = sessionsWith(events, LIFECYCLE_EVENTS.IDV_ABANDONED);
  const technical = sessionsWith(events, LIFECYCLE_EVENTS.IDV_TECHNICAL_FAILURE);
  const genericRetries = sessionsWith(events, LIFECYCLE_EVENTS.RESUBMISSION_REQUESTED);
  const documentSubmissions = sessionsWith(events, LIFECYCLE_EVENTS.DOCUMENT_SUBMITTED);
  const documentRetries = sessionsWith(events, LIFECYCLE_EVENTS.DOCUMENT_RETRY_REQUESTED);
  const retryCoverageComplete = events.some((event) => event.metadata?.retry_coverage_complete === true);
  const eligibleLabels = labels.filter((label) => created.has(label.internal_idv_session_id) && label.genuine_user_label === true && label.valid_technical_opportunity === true);
  const genuineNumerator = eligibleLabels.filter((label) => verified.has(label.internal_idv_session_id) && !genericRetries.has(label.internal_idv_session_id)).length;
  const costMap = selectedCosts(costs);
  const responses = responseMetrics(events);
  const faceResults = events.filter((event) => event.event_type === LIFECYCLE_EVENTS.FACE_MATCH_COMPLETED);
  const faceSessions = new Set(faceResults.map((event) => event.internal_idv_session_id));
  const faceFailed = new Set(faceResults.filter((event) => event.metadata?.observation_status === "FAILED").map((event) => event.internal_idv_session_id));
  return {
    metric_definition_version: METRIC_DEFINITION_VERSION,
    measurement_source: MEASUREMENT_SOURCE,
    counts: {
      test_journeys: created.size,
      launched: opened.size,
      terminal: terminals.size,
      verified: verified.size,
      abandoned: abandoned.size,
      technical_failures: technical.size,
    },
    customer_business: {
      hosted_flow_launch_rate: ratioMetric(opened.size, created.size, { limitation: "REDIRECT_ISSUANCE_PROXY_NOT_VENDOR_RENDER" }),
      journey_terminal_completion_rate: ratioMetric(terminals.size, opened.size),
      successful_verification_rate: ratioMetric(verified.size, opened.size),
      genuine_user_first_time_verification_rate: eligibleLabels.length
        ? ratioMetric(genuineNumerator, eligibleLabels.length, { metadata: { independent_label_source_required: true } })
        : unavailable("INDEPENDENT_GENUINE_LABELS_UNAVAILABLE"),
      first_attempt_document_acceptance_rate: retryCoverageComplete && documentSubmissions.size
        ? ratioMetric([...documentSubmissions].filter((id) => !documentRetries.has(id)).length, documentSubmissions.size)
        : unavailable("COMPLETE_DOCUMENT_ATTEMPT_TELEMETRY_UNAVAILABLE", documentSubmissions.size),
      first_attempt_liveness_success_rate: attemptMetric(events, LIFECYCLE_EVENTS.LIVENESS_COMPLETED, (items) => items.some((event) => event.metadata.attempt === 1 && event.metadata.passed === true)),
      first_attempt_face_match_success_rate: attemptMetric(events, LIFECYCLE_EVENTS.FACE_MATCH_COMPLETED, (items) => items.some((event) => event.metadata.attempt === 1 && event.metadata.passed === true)),
      abandonment_rate: ratioMetric(abandoned.size, opened.size),
      average_attempts_per_successful_verification: unavailable("COMPLETE_CROSS_STAGE_ATTEMPT_TELEMETRY_UNAVAILABLE", verified.size),
    },
    friction: {
      document_recapture_rate: retryCoverageComplete ? ratioMetric(documentRetries.size, documentSubmissions.size) : unavailable("COMPLETE_DOCUMENT_ATTEMPT_TELEMETRY_UNAVAILABLE", documentSubmissions.size),
      selfie_retry_rate: attemptMetric(events, LIFECYCLE_EVENTS.SELFIE_SUBMITTED, (items) => items.some((event) => event.metadata.attempt > 1)),
      liveness_retry_rate: attemptMetric(events, LIFECYCLE_EVENTS.LIVENESS_COMPLETED, (items) => items.some((event) => event.metadata.attempt > 1)),
      face_match_failure_rate: ratioMetric(faceFailed.size, faceSessions.size),
      resubmission_rate: retryCoverageComplete ? ratioMetric(genericRetries.size, opened.size) : unavailable("PROVIDER_RETRY_COVERAGE_UNAVAILABLE", opened.size),
      abandonment_by_stage: Object.fromEntries([...new Set(events.filter((event) => event.event_type === LIFECYCLE_EVENTS.IDV_ABANDONED).map((event) => event.metadata?.stage || "UNAVAILABLE"))].map((stage) => [stage, events.filter((event) => event.event_type === LIFECYCLE_EVENTS.IDV_ABANDONED && (event.metadata?.stage || "UNAVAILABLE") === stage).length])),
      technical_failure_rate: ratioMetric(technical.size, opened.size),
    },
    speed_ms: {
      time_to_document_submission: distributionMetric(durationValues(events, LIFECYCLE_EVENTS.HOSTED_FLOW_OPENED, LIFECYCLE_EVENTS.DOCUMENT_SUBMITTED), { limitation: "START_IS_REDIRECT_ISSUANCE_PROXY" }),
      time_to_extracted_data: distributionMetric(durationValues(events, LIFECYCLE_EVENTS.HOSTED_FLOW_OPENED, LIFECYCLE_EVENTS.EXTRACTION_AVAILABLE), { limitation: "START_IS_REDIRECT_ISSUANCE_PROXY" }),
      time_to_document_verification: distributionMetric(durationValues(events, LIFECYCLE_EVENTS.DOCUMENT_SUBMITTED, LIFECYCLE_EVENTS.DOCUMENT_VERIFICATION_COMPLETED, { requireExactEnd: true })),
      time_to_biometric_result: distributionMetric(durationValues(events, LIFECYCLE_EVENTS.SELFIE_SUBMITTED, LIFECYCLE_EVENTS.FACE_MATCH_COMPLETED, { requireExactEnd: true })),
      time_to_provider_decision: distributionMetric(durationValues(events, LIFECYCLE_EVENTS.HOSTED_FLOW_OPENED, LIFECYCLE_EVENTS.PROVIDER_DECISION_RECEIVED, { requireExactEnd: true }), { limitation: "START_IS_REDIRECT_ISSUANCE_PROXY" }),
      provider_result_delivery_latency: distributionMetric(providerDeliveryValues(events)),
      total_customer_verification_time: distributionMetric(durationValues(events, LIFECYCLE_EVENTS.HOSTED_FLOW_OPENED, LIFECYCLE_EVENTS.IDV_TERMINAL), { limitation: "START_IS_REDIRECT_ISSUANCE_PROXY" }),
    },
    extraction_quality: responses,
    economics: {
      cost_per_started_verification: costMetric(costMap, opened, opened.size),
      cost_per_completed_verification: costMetric(costMap, opened, terminals.size),
      cost_per_successfully_verified_user: costMetric(costMap, opened, verified.size),
    },
  };
}

function providerScorecard(events, { labels = [], costs = [], filter = {} } = {}) {
  const filtered = filterEvents(events, filter);
  const providers = [...new Set(filtered.map((event) => event.dimensions?.provider).filter(Boolean))].sort();
  return {
    metric_definition_version: METRIC_DEFINITION_VERSION,
    measurement_source: MEASUREMENT_SOURCE,
    cohort: { tenant_id: filter.tenantId || null, from: filter.from || null, to: filter.to || null, poc_only: filter.pocOnly === true },
    providers: Object.fromEntries(providers.map((provider) => [provider, calculateMetrics(events, {
      labels: labels.filter((label) => !filter.tenantId || label.tenant_id === filter.tenantId),
      costs: costs.filter((entry) => entry.provider === provider),
      filter: { ...filter, dimensions: { ...(filter.dimensions || {}), provider } },
    })])),
  };
}

module.exports = {
  createLifecycleEvent,
  calculateMetrics,
  providerScorecard,
  percentile,
  distributions,
  unavailable,
  ratioMetric,
  distributionMetric,
  LOW_SAMPLE_THRESHOLD,
};
