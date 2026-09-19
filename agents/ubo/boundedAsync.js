"use strict";

class UboTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "UboTimeoutError";
    this.code = "UBO_TIMEOUT";
    this.timeoutMs = timeoutMs;
  }
}

function classifyProviderError(error) {
  const directCode = String(error?.code || "").toUpperCase();
  const causeCode = String(error?.cause?.code || "").toUpperCase();
  const code = directCode || causeCode;
  if (directCode === "UBO_TIMEOUT" || code === "ETIMEDOUT") {
    return { reasonCode: "TIMEOUT", reasonText: "The provider did not respond within the configured time limit." };
  }
  if (["EACCES", "EPERM"].includes(code)) {
    return { reasonCode: "NETWORK_ACCESS_DENIED", reasonText: "The runtime was not permitted to open the provider network connection." };
  }
  if (["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) {
    return { reasonCode: "NETWORK_UNAVAILABLE", reasonText: "The provider network connection could not be established." };
  }
  if (error?.name === "AbortError" || directCode === "ABORT_ERR" || directCode === "20") {
    return { reasonCode: "REQUEST_ABORTED", reasonText: "The provider request was cancelled before it completed." };
  }
  return { reasonCode: "PROVIDER_UNAVAILABLE", reasonText: "The provider request could not be completed." };
}

function providerOutcome({ provider, stage, outcome, correlationId, reasonCode, reasonText, attempts = 1, httpStatus = null, factCount = 0 }) {
  return {
    provider,
    stage,
    outcome,
    reasonCode,
    reasonText,
    correlationId: correlationId || null,
    attempts,
    httpStatus,
    factCount,
  };
}

function withTimeout(operation, { label, timeoutMs, onTimeout } = {}) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { onTimeout?.(); } catch (_) { /* Timeout remains authoritative. */ }
        reject(new UboTimeoutError(label || "UBO operation", timeoutMs));
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function fetchWithTimeout(fetchImpl, url, options = {}, { label, timeoutMs } = {}) {
  const controller = new AbortController();
  const upstreamSignal = options.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener?.("abort", abortFromUpstream, { once: true });
  try {
    return await withTimeout(
      () => fetchImpl(url, { ...options, signal: controller.signal }),
      { label, timeoutMs, onTimeout: () => controller.abort() },
    );
  } finally {
    upstreamSignal?.removeEventListener?.("abort", abortFromUpstream);
  }
}

module.exports = { UboTimeoutError, classifyProviderError, fetchWithTimeout, providerOutcome, withTimeout };
