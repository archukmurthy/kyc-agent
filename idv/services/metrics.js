"use strict";

const { randomUUID } = require("crypto");
const { LIFECYCLE_EVENTS, CANONICAL_STATUSES } = require("../domain/constants");

function createLifecycleEvent({ type, session, occurredAt = new Date(), dimensions = {}, metadata = {} }) {
  if (!Object.values(LIFECYCLE_EVENTS).includes(type)) throw new TypeError(`Unknown IDV lifecycle event: ${type}`);
  return {
    event_id: randomUUID(),
    event_type: type,
    internal_idv_session_id: session.internal_idv_session_id,
    occurred_at: new Date(occurredAt).toISOString(),
    dimensions: {
      provider: session.provider,
      workflow: session.provider_workflow,
      workflow_version: session.provider_workflow_version,
      country: null,
      document_issuing_country: null,
      document_type: null,
      device_platform: null,
      liveness_method: null,
      database_verification_enabled: false,
      nfc_enabled: false,
      ...(session.dimensions || {}),
      ...dimensions,
    },
    metadata: { ...metadata },
  };
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
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

function durationBetween(events, startType, endType) {
  const bySession = new Map();
  for (const event of events) {
    const list = bySession.get(event.internal_idv_session_id) || [];
    list.push(event);
    bySession.set(event.internal_idv_session_id, list);
  }
  const durations = [];
  for (const sessionEvents of bySession.values()) {
    const start = sessionEvents.find((event) => event.event_type === startType);
    const end = sessionEvents.find((event) => event.event_type === endType);
    if (start && end) {
      const duration = new Date(end.occurred_at) - new Date(start.occurred_at);
      if (duration >= 0) durations.push(duration);
    }
  }
  return distributions(durations);
}

function filterByDimensions(events, dimensions) {
  return events.filter((event) => Object.entries(dimensions || {}).every(([key, value]) => event.dimensions?.[key] === value));
}

function finiteNumbers(values) {
  return values.filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number).filter(Number.isFinite);
}

function groupedCost(events, dimension) {
  return events.reduce((groups, event) => {
    const key = event.dimensions?.[dimension] || "UNKNOWN";
    const value = event.metadata?.cost?.actual_cost ?? event.metadata?.cost?.estimated_cost;
    if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return groups;
    const current = groups[key] || { total_cost: 0, completed_verifications: 0 };
    current.total_cost += Number(value);
    current.completed_verifications += 1;
    current.cost_per_completed_verification = current.total_cost / current.completed_verifications;
    groups[key] = current;
    return groups;
  }, {});
}

function calculateMetrics(allEvents, dimensions = {}) {
  const events = filterByDimensions(allEvents, dimensions);
  const count = (type) => events.filter((event) => event.event_type === type).length;
  const created = count(LIFECYCLE_EVENTS.IDV_SESSION_CREATED);
  const opened = count(LIFECYCLE_EVENTS.HOSTED_FLOW_OPENED);
  const completedEvents = events.filter((event) => event.event_type === LIFECYCLE_EVENTS.IDV_COMPLETED);
  const verified = completedEvents.filter((event) => event.metadata?.canonical_status === CANONICAL_STATUSES.VERIFIED);
  const abandoned = count(LIFECYCLE_EVENTS.IDV_ABANDONED);
  const technicalFailures = count(LIFECYCLE_EVENTS.IDV_TECHNICAL_FAILURE);
  const documentSubmitted = count(LIFECYCLE_EVENTS.DOCUMENT_SUBMITTED);
  const documentRetries = count(LIFECYCLE_EVENTS.DOCUMENT_RETRY_REQUESTED);
  const confirmations = count(LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_CONFIRMED);
  const corrections = count(LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_CORRECTED);
  const presented = count(LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_PRESENTED);
  const costs = finiteNumbers(completedEvents.map((event) => event.metadata?.cost?.actual_cost ?? event.metadata?.cost?.estimated_cost));
  const startedCosts = finiteNumbers(events.filter((event) => event.event_type === LIFECYCLE_EVENTS.HOSTED_FLOW_OPENED)
    .map((event) => event.metadata?.estimated_cost));
  const moduleCost = (module) => completedEvents.reduce((sum, event) => {
    const entries = event.metadata?.cost?.module_costs || [];
    return sum + entries.filter((entry) => entry.module === module).reduce((subtotal, entry) => subtotal + Number(entry.amount || 0), 0);
  }, 0);
  const correctionRate = (concept) => {
    const relevant = events.filter((event) => event.metadata?.attribute_concept === concept);
    return ratio(relevant.filter((event) => event.event_type === LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_CORRECTED).length,
      relevant.filter((event) => event.event_type === LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_PRESENTED).length);
  };
  return {
    counts: { created, opened, completed: completedEvents.length, verified: verified.length, abandoned, technical_failures: technicalFailures },
    customer_business: {
      hosted_flow_launch_rate: ratio(opened, created),
      journey_completion_rate: ratio(completedEvents.length, opened),
      genuine_user_first_time_verification_rate: ratio(verified.filter((event) => (event.metadata?.attempt_count || 1) === 1).length, opened),
      first_attempt_document_acceptance_rate: ratio(documentSubmitted - documentRetries, documentSubmitted),
      first_attempt_liveness_success_rate: ratio(
        events.filter((event) => event.event_type === LIFECYCLE_EVENTS.LIVENESS_COMPLETED && event.metadata?.passed && (event.metadata?.attempt || 1) === 1).length,
        events.filter((event) => event.event_type === LIFECYCLE_EVENTS.LIVENESS_COMPLETED).length,
      ),
      first_attempt_face_match_success_rate: ratio(
        events.filter((event) => event.event_type === LIFECYCLE_EVENTS.FACE_MATCH_COMPLETED && event.metadata?.passed && (event.metadata?.attempt || 1) === 1).length,
        events.filter((event) => event.event_type === LIFECYCLE_EVENTS.FACE_MATCH_COMPLETED).length,
      ),
      abandonment_rate: ratio(abandoned, opened),
      average_attempts_per_successful_verification: verified.length
        ? verified.reduce((sum, event) => sum + (event.metadata?.attempt_count || 1), 0) / verified.length : null,
    },
    friction: {
      document_recapture_rate: ratio(documentRetries, documentSubmitted),
      selfie_retry_rate: ratio(events.filter((event) => event.event_type === LIFECYCLE_EVENTS.SELFIE_SUBMITTED && (event.metadata?.attempt || 1) > 1).length, count(LIFECYCLE_EVENTS.SELFIE_SUBMITTED)),
      liveness_retry_rate: ratio(events.filter((event) => event.event_type === LIFECYCLE_EVENTS.LIVENESS_COMPLETED && (event.metadata?.attempt || 1) > 1).length, count(LIFECYCLE_EVENTS.LIVENESS_COMPLETED)),
      resubmission_rate: ratio(documentRetries, opened),
      abandonment_by_stage: events.filter((event) => event.event_type === LIFECYCLE_EVENTS.IDV_ABANDONED)
        .reduce((acc, event) => ({ ...acc, [event.metadata?.stage || "UNKNOWN"]: (acc[event.metadata?.stage || "UNKNOWN"] || 0) + 1 }), {}),
      technical_failure_rate: ratio(technicalFailures, opened),
    },
    speed_ms: {
      time_to_document_submission: durationBetween(events, LIFECYCLE_EVENTS.HOSTED_FLOW_OPENED, LIFECYCLE_EVENTS.DOCUMENT_SUBMITTED),
      time_to_extracted_data: durationBetween(events, LIFECYCLE_EVENTS.HOSTED_FLOW_OPENED, LIFECYCLE_EVENTS.EXTRACTION_AVAILABLE),
      time_to_document_verification: durationBetween(events, LIFECYCLE_EVENTS.DOCUMENT_SUBMITTED, LIFECYCLE_EVENTS.DOCUMENT_VERIFICATION_COMPLETED),
      time_to_biometric_result: durationBetween(events, LIFECYCLE_EVENTS.SELFIE_SUBMITTED, LIFECYCLE_EVENTS.FACE_MATCH_COMPLETED),
      time_to_provider_decision: durationBetween(events, LIFECYCLE_EVENTS.HOSTED_FLOW_OPENED, LIFECYCLE_EVENTS.PROVIDER_DECISION_RECEIVED),
      total_customer_verification_time: durationBetween(events, LIFECYCLE_EVENTS.HOSTED_FLOW_OPENED, LIFECYCLE_EVENTS.IDV_COMPLETED),
    },
    extraction_quality: {
      field_confirmation_rate: ratio(confirmations, presented),
      field_correction_rate: ratio(corrections, presented),
      identity_data_confirmation_rate: ratio(confirmations, presented),
      name_correction_rate: correctionRate("first_name"),
      dob_correction_rate: correctionRate("date_of_birth"),
      nationality_correction_rate: correctionRate("nationality"),
      address_correction_rate: correctionRate("address"),
      document_number_discrepancy_rate: correctionRate("document_number"),
    },
    economics: {
      cost_per_started_verification: startedCosts.length ? startedCosts.reduce((a, b) => a + b, 0) / opened : null,
      cost_per_completed_verification: costs.length && completedEvents.length ? costs.reduce((a, b) => a + b, 0) / completedEvents.length : null,
      cost_per_successfully_verified_user: costs.length && verified.length ? costs.reduce((a, b) => a + b, 0) / verified.length : null,
      incremental_database_verification_cost: moduleCost("DATABASE_VERIFICATION"),
      incremental_nfc_cost: moduleCost("NFC_VERIFICATION"),
      provider_cost_by_country: groupedCost(completedEvents, "country"),
      provider_cost_by_document_type: groupedCost(completedEvents, "document_type"),
    },
  };
}

function providerScorecard(events) {
  return Object.fromEntries(["DIDIT", "VERIFF"].map((provider) => [provider, calculateMetrics(events, { provider })]));
}

module.exports = { createLifecycleEvent, calculateMetrics, providerScorecard, percentile, distributions };
