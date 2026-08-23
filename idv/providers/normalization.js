"use strict";

const { CANONICAL_STATUSES, OBSERVATION_STATUSES } = require("../domain/constants");

function normalizedToken(value) {
  return String(value || "").trim().replace(/[\s-]+/g, "_").toUpperCase();
}

function mapProviderStatus(value) {
  switch (normalizedToken(value)) {
    case "NOT_STARTED": case "CREATED": return CANONICAL_STATUSES.READY;
    case "IN_PROGRESS": case "STARTED": return CANONICAL_STATUSES.STARTED;
    case "SUBMITTED": case "IN_REVIEW": case "REVIEW": case "PROCESSING": return CANONICAL_STATUSES.PROCESSING;
    case "RESUBMITTED": case "AWAITING_USER": case "RESUBMISSION_REQUESTED": return CANONICAL_STATUSES.REQUIRES_RETRY;
    case "APPROVED": case "SUCCESS": return CANONICAL_STATUSES.VERIFIED;
    case "DECLINED": case "FAIL": case "FAILED": return CANONICAL_STATUSES.FAILED;
    case "ABANDONED": return CANONICAL_STATUSES.ABANDONED;
    case "EXPIRED": case "KYC_EXPIRED": return CANONICAL_STATUSES.EXPIRED;
    case "ERROR": return CANONICAL_STATUSES.ERROR;
    default: return CANONICAL_STATUSES.PROCESSING;
  }
}

function mapObservationStatus(value) {
  if (typeof value === "boolean") return value ? OBSERVATION_STATUSES.PASSED : OBSERVATION_STATUSES.FAILED;
  const token = normalizedToken(typeof value === "object" && value ? (value.status || value.result) : value);
  switch (token) {
    case "APPROVED": case "PASSED": case "PASS": case "SUCCESS": case "STRONG_MATCH": case "MATCH": return OBSERVATION_STATUSES.PASSED;
    case "DECLINED": case "FAILED": case "FAILURE": case "NO_MATCH": case "WEAK_MATCH": return OBSERVATION_STATUSES.FAILED;
    case "IN_REVIEW": case "REVIEW": return OBSERVATION_STATUSES.REVIEW;
    case "RESUBMITTED": case "RETRY": case "RESUBMISSION_REQUESTED": return OBSERVATION_STATUSES.RETRY;
    case "NOT_PERFORMED": case "DISABLED": case "SKIPPED": return OBSERVATION_STATUSES.NOT_PERFORMED;
    default: return OBSERVATION_STATUSES.UNKNOWN;
  }
}

function presentEntries(object, mapping) {
  return Object.entries(mapping)
    .filter(([source]) => object?.[source] !== undefined && object[source] !== null && object[source] !== "")
    .map(([source, concept]) => ({ concept, value: object[source] }));
}

module.exports = { normalizedToken, mapProviderStatus, mapObservationStatus, presentEntries };
