"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateMetrics, providerScorecard } = require("../services/metrics");
const { METRIC_DEFINITIONS, REQUIRED_DEFINITION_FIELDS } = require("../services/metricDefinitions");

function event(session, type, at, metadata = {}, dimensions = {}) {
  return { event_id: `${session}-${type}-${at}`, internal_idv_session_id: session, event_type: type, occurred_at: at, metadata, dimensions: { tenant_id: "tenant-a", provider: "THIRD_PROVIDER", workflow: "STANDARD", ...dimensions } };
}

test("every frozen metric definition documents complete provider-neutral semantics", () => {
  assert.ok(Object.keys(METRIC_DEFINITIONS).length >= 20);
  for (const [name, definition] of Object.entries(METRIC_DEFINITIONS)) {
    for (const field of REQUIRED_DEFINITION_FIELDS) assert.ok(definition[field], `${name}.${field}`);
  }
});

test("terminal completion and successful verification remain distinct unique-session metrics", () => {
  const events = [
    event("verified", "IDV_SESSION_CREATED", "2030-01-01T00:00:00Z"), event("verified", "HOSTED_FLOW_OPENED", "2030-01-01T00:00:01Z"), event("verified", "IDV_TERMINAL", "2030-01-01T00:00:05Z", { canonical_status: "VERIFIED" }),
    event("declined", "IDV_SESSION_CREATED", "2030-01-01T00:00:00Z"), event("declined", "HOSTED_FLOW_OPENED", "2030-01-01T00:00:01Z"), event("declined", "IDV_TERMINAL", "2030-01-01T00:00:06Z", { canonical_status: "FAILED" }),
    event("abandoned", "IDV_SESSION_CREATED", "2030-01-01T00:00:00Z"), event("abandoned", "HOSTED_FLOW_OPENED", "2030-01-01T00:00:01Z"), event("abandoned", "IDV_ABANDONED", "2030-01-01T00:00:07Z"), event("abandoned", "IDV_TERMINAL", "2030-01-01T00:00:07Z", { canonical_status: "ABANDONED" }),
  ];
  const metrics = calculateMetrics(events);
  assert.equal(metrics.customer_business.journey_terminal_completion_rate.value, 1);
  assert.equal(metrics.customer_business.successful_verification_rate.value, 1 / 3);
  assert.equal(metrics.customer_business.abandonment_rate.value, 1 / 3);
});

test("genuine-user first-time rate is unavailable without independent labels and excludes retries", () => {
  const events = [
    event("a", "IDV_SESSION_CREATED", "2030-01-01T00:00:00Z"), event("a", "HOSTED_FLOW_OPENED", "2030-01-01T00:00:01Z"), event("a", "IDV_TERMINAL", "2030-01-01T00:00:05Z", { canonical_status: "VERIFIED" }),
    event("b", "IDV_SESSION_CREATED", "2030-01-01T00:00:00Z"), event("b", "HOSTED_FLOW_OPENED", "2030-01-01T00:00:01Z"), event("b", "RESUBMISSION_REQUESTED", "2030-01-01T00:00:03Z"), event("b", "IDV_TERMINAL", "2030-01-01T00:00:06Z", { canonical_status: "VERIFIED" }),
  ];
  assert.equal(calculateMetrics(events).customer_business.genuine_user_first_time_verification_rate.status, "UNAVAILABLE");
  const labels = [
    { internal_idv_session_id: "a", genuine_user_label: true, valid_technical_opportunity: true },
    { internal_idv_session_id: "b", genuine_user_label: true, valid_technical_opportunity: true },
  ];
  const metric = calculateMetrics(events, { labels }).customer_business.genuine_user_first_time_verification_rate;
  assert.equal(metric.value, 0.5);
  assert.equal(metric.numerator, 1);
  assert.equal(metric.denominator, 2);
});

test("provider scorecard is dynamic, tenant-bounded, and marks low samples", () => {
  const events = [event("a", "IDV_SESSION_CREATED", "2030-01-01T00:00:00Z"), event("a", "HOSTED_FLOW_OPENED", "2030-01-01T00:00:01Z")];
  const report = providerScorecard(events, { filter: { tenantId: "tenant-a" } });
  assert.deepEqual(Object.keys(report.providers), ["THIRD_PROVIDER"]);
  assert.match(report.providers.THIRD_PROVIDER.customer_business.hosted_flow_launch_rate.warning, /LOW_SAMPLE/);
  assert.equal(report.measurement_source, "OUR_MEASURED_METRIC");
});

test("provider result delivery latency uses provider decision and platform receipt timestamps", () => {
  const events = [
    event("a", "IDV_SESSION_CREATED", "2030-01-01T00:00:00Z"),
    event("a", "PROVIDER_DECISION_RECEIVED", "2030-01-01T00:00:05Z", { timestamp_source: "PROVIDER_EXACT" }),
    event("a", "PROVIDER_RESULT_RECEIVED", "2030-01-01T00:00:07Z", { provider_decided_at: "2030-01-01T00:00:05Z", timestamp_source: "PLATFORM_OBSERVED" }),
  ];
  const metric = calculateMetrics(events).speed_ms.provider_result_delivery_latency;
  assert.equal(metric.value.p50, 2000);
  assert.equal(metric.sample_size, 1);
});

test("field confirmations are deduplicated by attribute and corrections are not confirmations", () => {
  const events = [
    event("a", "IDENTITY_ATTRIBUTE_PRESENTED", "2030-01-01T00:00:01Z", { attribute_id: "f1", attribute_concept: "first_name" }),
    event("a", "IDENTITY_ATTRIBUTE_PRESENTED", "2030-01-01T00:00:02Z", { attribute_id: "f1", attribute_concept: "first_name" }),
    event("a", "IDENTITY_ATTRIBUTE_CORRECTED", "2030-01-01T00:00:03Z", { attribute_id: "f1", attribute_concept: "first_name" }),
    event("a", "IDENTITY_ATTRIBUTE_PRESENTED", "2030-01-01T00:00:04Z", { attribute_id: "f2", attribute_concept: "date_of_birth" }),
    event("a", "IDENTITY_ATTRIBUTE_CONFIRMED", "2030-01-01T00:00:05Z", { attribute_id: "f2", attribute_concept: "date_of_birth" }),
  ];
  const quality = calculateMetrics(events).extraction_quality;
  assert.equal(quality.identity_data_confirmation_rate.value, 0.5);
  assert.equal(quality.field_correction_rate.value, 0.5);
  assert.equal(quality.per_field.first_name.correction_rate.value, 1);
});

test("cost metrics prefer confirmed actuals, include failed journeys, and reject partial coverage", () => {
  const events = [
    event("ok", "IDV_SESSION_CREATED", "2030-01-01T00:00:00Z"), event("ok", "HOSTED_FLOW_OPENED", "2030-01-01T00:00:01Z"), event("ok", "IDV_TERMINAL", "2030-01-01T00:00:05Z", { canonical_status: "VERIFIED" }),
    event("fail", "IDV_SESSION_CREATED", "2030-01-01T00:00:00Z"), event("fail", "HOSTED_FLOW_OPENED", "2030-01-01T00:00:01Z"), event("fail", "IDV_TERMINAL", "2030-01-01T00:00:05Z", { canonical_status: "FAILED" }),
  ];
  const costs = [
    { internal_idv_session_id: "ok", provider: "THIRD_PROVIDER", cost_basis: "ESTIMATED", amount: 1, currency: "USD" },
    { internal_idv_session_id: "ok", provider: "THIRD_PROVIDER", cost_basis: "ACTUAL_CONFIRMED", amount: 2, currency: "USD" },
    { internal_idv_session_id: "fail", provider: "THIRD_PROVIDER", cost_basis: "ESTIMATED", amount: 3, currency: "USD" },
  ];
  const economics = calculateMetrics(events, { costs }).economics;
  assert.equal(economics.cost_per_started_verification.value, 2.5);
  assert.equal(economics.cost_per_successfully_verified_user.value, 5);
  assert.equal(economics.cost_per_successfully_verified_user.cost_basis, "MIXED_ESTIMATE_AND_ACTUAL_CONFIRMED");
  const partial = calculateMetrics(events, { costs: costs.filter((entry) => entry.internal_idv_session_id === "ok") }).economics.cost_per_started_verification;
  assert.equal(partial.status, "UNAVAILABLE");
  assert.equal(partial.unavailable_reason, "PARTIAL_PRICING_COVERAGE");
});
