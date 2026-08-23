"use strict";

const ALLOWED_LOG_FIELDS = Object.freeze(new Set([
  "internal_idv_session_id", "provider", "provider_session_reference", "canonical_status",
  "event_type", "duration_ms", "error_code", "retryable", "correlation_id", "tenant_id",
]));

function sanitizeLogFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) => ALLOWED_LOG_FIELDS.has(key) && value != null));
}

function createSafeLogger(sink = console) {
  const write = (level, message, fields) => {
    const method = typeof sink[level] === "function" ? sink[level].bind(sink) : sink.log.bind(sink);
    method(message, sanitizeLogFields(fields));
  };
  return Object.freeze({
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  });
}

module.exports = { createSafeLogger, sanitizeLogFields, ALLOWED_LOG_FIELDS };
