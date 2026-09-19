"use strict";

class UboTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "UboTimeoutError";
    this.code = "UBO_TIMEOUT";
    this.timeoutMs = timeoutMs;
  }
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

module.exports = { UboTimeoutError, withTimeout, fetchWithTimeout };
