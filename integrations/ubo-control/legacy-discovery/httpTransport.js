"use strict";

const DEFAULT_TIMEOUT_MS = 30_000;

function configuredBaseUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("HTTP Legacy Discovery transport requires a configured baseUrl");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new TypeError("HTTP Legacy Discovery transport baseUrl must be an absolute URL", { cause: error });
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError("HTTP Legacy Discovery transport baseUrl must use HTTP(S) without embedded credentials");
  }
  return parsed.toString().replace(/\/$/, "");
}

function configuredTimeout(value) {
  const timeoutMs = value === undefined ? DEFAULT_TIMEOUT_MS : value;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("HTTP Legacy Discovery transport timeoutMs must be a positive safe integer");
  }
  return timeoutMs;
}

function createHttpLegacyDiscoveryTransport({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs } = {}) {
  const configuredUrl = configuredBaseUrl(baseUrl);
  const configuredTimeoutMs = configuredTimeout(timeoutMs);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("HTTP Legacy Discovery transport requires a fetch implementation");
  }

  return Object.freeze({
    async invoke({ method, path, body }) {
      if (method !== "POST" || typeof path !== "string" || !path.startsWith("/")) {
        throw new TypeError("HTTP Legacy Discovery transport accepts an absolute-path POST invocation");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), configuredTimeoutMs);
      let response;
      let responseText;
      try {
        response = await fetchImpl(`${configuredUrl}${path}`, {
          method,
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        responseText = await response.text();
      } catch (error) {
        if (controller.signal.aborted || error?.name === "AbortError") {
          const timeoutError = new Error("Legacy Discovery HTTP request timed out", { cause: error });
          timeoutError.code = "ETIMEDOUT";
          throw timeoutError;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }

      let responseBody = null;
      if (responseText !== "") {
        try {
          responseBody = JSON.parse(responseText);
        } catch {
          responseBody = responseText;
        }
      }
      return { status: response.status, body: responseBody };
    },
  });
}

module.exports = { createHttpLegacyDiscoveryTransport };
