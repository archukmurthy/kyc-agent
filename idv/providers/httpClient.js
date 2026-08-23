"use strict";

const { ProviderError } = require("../domain/errors");

const MAX_DIAGNOSTIC_TEXT = 240;

function firstScalar(values) {
  return values.find((value) => typeof value === "string" || typeof value === "number") ?? null;
}

function errorDetails(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { code: null, message: null };
  const nested = data.error && typeof data.error === "object" && !Array.isArray(data.error) ? data.error : {};
  return {
    code: firstScalar([data.error_code, data.code, nested.code]),
    message: firstScalar([data.detail, data.message, typeof data.error === "string" ? data.error : null, nested.message]),
  };
}

function sanitizedCode(value) {
  if (value == null) return null;
  const text = String(value).slice(0, 80);
  return /^[A-Za-z0-9_.:-]+$/.test(text) ? text : "[redacted-untrusted-code]";
}

function sanitizedMessage(value, sensitiveValues = []) {
  if (value == null) return null;
  let text = String(value).replace(/[\r\n\t]+/g, " ").slice(0, MAX_DIAGNOSTIC_TEXT);
  for (const sensitive of sensitiveValues) {
    if (typeof sensitive === "string" && sensitive.length >= 6) text = text.split(sensitive).join("[redacted-secret]");
  }
  text = text
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-identifier]")
    .replace(/\b(?:\d[ .()-]?){8,}\b/g, "[redacted-number]");
  return text || null;
}

function sanitizedUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch (_) {
    return "[redacted-invalid-url]";
  }
}

class ProviderHttpClient {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 15000, diagnosticLogger } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.diagnosticLogger = diagnosticLogger || ((entry) => process.stderr.write(`${JSON.stringify(entry)}\n`));
  }

  logFailure({ provider, url, headers, response, data, diagnostic }) {
    if (!diagnostic?.enabled || diagnostic.runtimeMode === "production") return;
    const details = errorDetails(data);
    this.diagnosticLogger({
      event: "idv_provider_http_error",
      provider,
      http_status: response.status,
      response_error_code: sanitizedCode(details.code),
      response_error_message: sanitizedMessage(details.message, Object.values(headers)),
      request_url: sanitizedUrl(url),
      workflow_id: String(diagnostic.workflowId || "").slice(0, 128) || null,
      callback_supplied: diagnostic.callbackSupplied === true,
      environment: diagnostic.environment === "sandbox" ? "sandbox" : "live",
    });
  }

  async request({ provider, url, method = "GET", headers = {}, body, diagnostic }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { method, headers, body, signal: controller.signal });
      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }
      if (!response.ok) {
        this.logFailure({ provider, url, headers, response, data, diagnostic });
        throw new ProviderError(`${provider} request failed with status ${response.status}`, {
          provider,
          statusCode: response.status,
          retryable: response.status === 429 || response.status >= 500,
        });
      }
      return { data, rawBody: raw, headers: response.headers, statusCode: response.status };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(`${provider} request could not be completed`, {
        provider,
        retryable: error?.name === "AbortError" || error?.code === "ECONNRESET",
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { ProviderHttpClient };
