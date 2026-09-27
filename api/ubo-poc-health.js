"use strict";

const { timingSafeEqual } = require("node:crypto");
const { createPostgresDb } = require("../evidence/a2/postgresDb.js");
const { PostgresCustomerExtractionJobRepository } = require("../evidence/customerOwnershipJobs/repository.js");
const storage = require("../lib/storage.js");

const CONNECTIVITY_TIMEOUT_MS = 5000;

function authorized(req) {
  const expected = process.env.UBO_POC_HEALTH_KEY || process.env.ADMIN_PASSWORD;
  const supplied = req.headers?.["x-internal-health-key"];
  if (!expected || !supplied) return false;
  const left = Buffer.from(String(expected));
  const right = Buffer.from(String(supplied));
  return left.length === right.length && timingSafeEqual(left, right);
}

async function boundedFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function aggregate(checks) {
  const states = Object.values(checks).map(({ status }) => status);
  if (states.includes("UNAVAILABLE")) return "UNAVAILABLE";
  if (states.includes("DEGRADED")) return "DEGRADED";
  return "HEALTHY";
}

function providerResult(response) {
  if (response.ok) return { status: "HEALTHY" };
  return { status: response.status >= 500 || response.status === 408 || response.status === 429 ? "DEGRADED" : "UNAVAILABLE", httpStatus: response.status };
}

function createHandler({ dbFactory = createPostgresDb, fetchImpl = boundedFetch, storageBackend = storage.backend } = {}) {
  return async function uboPocHealth(req, res) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!authorized(req)) return res.status(401).json({ error: "Unauthorized" });
    const checks = { app: {
      status: "HEALTHY",
      environment: process.env.UBO_POC_ENVIRONMENT || "local",
      productVersion: process.env.UBO_POC_PRODUCT_VERSION || "development",
      commitSha: process.env.UBO_POC_COMMIT_SHA || "unversioned",
    } };
    let db;
    try {
      db = dbFactory();
      await db.query("SELECT 1");
      checks.database = { status: "HEALTHY" };
      const tableResult = await db.query(`SELECT to_regclass('public.evidence_artifacts') artifacts,
        to_regclass('public.evidence_customer_extraction_jobs') jobs`);
      const row = tableResult.rows?.[0] || tableResult[0] || {};
      checks.evidencePersistence = row.artifacts && row.jobs
        ? { status: "HEALTHY", artifactStore: process.env.BLOB_READ_WRITE_TOKEN ? "vercel_blob" : process.env.EVIDENCE_ARTIFACT_DIR ? "filesystem" : "not_configured" }
        : { status: "UNAVAILABLE", reason: "required_tables_missing" };
      if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.EVIDENCE_ARTIFACT_DIR) checks.evidencePersistence = { status: "UNAVAILABLE", reason: "artifact_store_not_configured" };
      else if (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN) checks.evidencePersistence = { status: "UNAVAILABLE", artifactStore: "filesystem", reason: "ephemeral_hosted_artifact_store" };
      const worker = await new PostgresCustomerExtractionJobRepository(db).health();
      checks.extractionWorker = { status: Number(worker.stale || 0) ? "DEGRADED" : "HEALTHY", queued: Number(worker.queued || 0), stale: Number(worker.stale || 0) };
    } catch (error) {
      checks.database = { status: "UNAVAILABLE", reason: "connection_or_schema_failure" };
      checks.evidencePersistence = { status: "UNAVAILABLE", reason: "database_unavailable" };
      checks.extractionWorker = { status: "UNAVAILABLE", reason: "job_store_unavailable" };
    }
    const cacheBackend = storageBackend();
    checks.researchCache = cacheBackend === "kv" || cacheBackend === "redis"
      ? { status: "HEALTHY", backend: cacheBackend }
      : { status: process.env.VERCEL ? "UNAVAILABLE" : "DEGRADED", backend: cacheBackend, reason: process.env.VERCEL ? "ephemeral_hosted_cache" : "local_filesystem_cache" };
    const anthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
    let anthropicConnectivity;
    if (anthropicConfigured) {
      try {
        const response = await fetchImpl("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } });
        anthropicConnectivity = providerResult(response);
      } catch (error) { anthropicConnectivity = { status: "DEGRADED", reason: error?.name === "AbortError" ? "timeout" : "network" }; }
    } else anthropicConnectivity = { status: "UNAVAILABLE", reason: "ANTHROPIC_API_KEY_missing" };
    checks.aiExtractionProvider = { ...anthropicConnectivity, model: process.env.EVIDENCE_A3_ANTHROPIC_MODEL || "claude-sonnet-4-5", service: "anthropic" };
    checks.researchProvider = { ...anthropicConnectivity, model: process.env.UBO_RESEARCH_ANTHROPIC_MODEL || "claude-sonnet-4-5", service: "anthropic" };
    if (process.env.COMPANIES_HOUSE_API_KEY) {
      try {
        const auth = Buffer.from(`${process.env.COMPANIES_HOUSE_API_KEY}:`).toString("base64");
        const response = await fetchImpl("https://api.company-information.service.gov.uk/company/00000006", { headers: { Authorization: `Basic ${auth}` } });
        checks.companiesHouseConnectivity = providerResult(response);
      } catch (error) { checks.companiesHouseConnectivity = { status: "DEGRADED", reason: error?.name === "AbortError" ? "timeout" : "network" }; }
    } else checks.companiesHouseConnectivity = { status: "UNAVAILABLE", reason: "COMPANIES_HOUSE_API_KEY_missing" };
    if (db?.close) await db.close().catch(() => {});
    const status = aggregate(checks);
    return res.status(status === "UNAVAILABLE" ? 503 : 200).json({
      contractVersion: "ubo-poc-health-v2", status, checkedAt: new Date().toISOString(), timeoutMs: CONNECTIVITY_TIMEOUT_MS, checks,
    });
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
handler.CONNECTIVITY_TIMEOUT_MS = CONNECTIVITY_TIMEOUT_MS;
module.exports = handler;
