"use strict";

// ComplyCube screening configuration. The key environment (test_/live_) must
// match SCREENING_RUNTIME_MODE so a test context can never bill live screening
// (and a live context can't silently run against sandbox data).
function screeningConfig() {
  return {
    provider: (process.env.SCREENING_DEFAULT_PROVIDER || "complycube").toLowerCase(),
    mode: (process.env.SCREENING_RUNTIME_MODE || "test").toLowerCase(), // "test" | "live"
    apiKey: process.env.COMPLYCUBE_API_KEY || "",
    webhookSecret: process.env.COMPLYCUBE_WEBHOOK_SECRET || "",
  };
}

function assertKeyMatchesMode(cfg = screeningConfig()) {
  const { mode, apiKey } = cfg;
  if (!apiKey) throw new Error("COMPLYCUBE_API_KEY not set");
  const isTest = apiKey.startsWith("test_");
  const isLive = apiKey.startsWith("live_");
  if (mode === "test" && !isTest) throw new Error("SCREENING_RUNTIME_MODE=test requires a test_ ComplyCube API key");
  if (mode === "live" && !isLive) throw new Error("SCREENING_RUNTIME_MODE=live requires a live_ ComplyCube API key");
}

module.exports = { screeningConfig, assertKeyMatchesMode };
