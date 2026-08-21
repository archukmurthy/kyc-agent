"use strict";

const { ProviderError } = require("../domain/errors");

class ProviderHttpClient {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request({ provider, url, method = "GET", headers = {}, body }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { method, headers, body, signal: controller.signal });
      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }
      if (!response.ok) {
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
