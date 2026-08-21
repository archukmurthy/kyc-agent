"use strict";

class IdvError extends Error {
  constructor(message, { code = "IDV_ERROR", retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = this.constructor.name;
    this.code = code;
    this.retryable = retryable;
  }
}

class ConfigurationError extends IdvError {
  constructor(message) {
    super(message, { code: "IDV_CONFIGURATION_ERROR" });
  }
}

class ProviderError extends IdvError {
  constructor(message, { provider, statusCode, retryable = false, cause } = {}) {
    super(message, { code: "IDV_PROVIDER_ERROR", retryable, cause });
    this.provider = provider;
    this.statusCode = statusCode;
  }
}

class WebhookAuthenticationError extends IdvError {
  constructor(message) {
    super(message, { code: "IDV_WEBHOOK_AUTHENTICATION_FAILED" });
  }
}

class SessionNotFoundError extends IdvError {
  constructor(identifier) {
    super(`IDV session not found: ${identifier}`, { code: "IDV_SESSION_NOT_FOUND" });
  }
}

class SecureStoreRequiredError extends IdvError {
  constructor() {
    super(
      "A production SecureIdentityStore implementation is required before identity PII can be persisted",
      { code: "IDV_SECURE_STORE_REQUIRED" },
    );
  }
}

module.exports = {
  IdvError,
  ConfigurationError,
  ProviderError,
  WebhookAuthenticationError,
  SessionNotFoundError,
  SecureStoreRequiredError,
};
