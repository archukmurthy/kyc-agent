"use strict";

const { timingSafeEqual } = require("node:crypto");
const { createPostgresDb } = require("../evidence/a2/postgresDb.js");
const { PostgresCustomerExtractionJobRepository } = require("../evidence/customerOwnershipJobs/repository.js");

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
  if (states.includes("unavailable")) return "unavailable";
  if (states.includes("degraded")) return "degraded";
  return "healthy";
}

function createHandler({ dbFactory = createPostgresDb, fetchImpl = boundedFetch } = {}) {
  return async function uboPocHealth(req, res) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!authorized(req)) return res.status(401).json({ error: "Unauthorized" });
    const checks = { app: { status: "healthy" } };
    let db;
    try {
      db = dbFactory();
      await db.query("SELECT 1");
      checks.database = { status: "healthy" };
      const tableResult = await db.query(`SELECT to_regclass('public.evidence_artifacts') artifacts,
        to_regclass('public.evidence_customer_extraction_jobs') jobs`);
      const row = tableResult.rows?.[0] || tableResult[0] || {};
      checks.evidencePersistence = row.artifacts && row.jobs
        ? { status: "healthy", artifactStore: process.env.BLOB_READ_WRITE_TOKEN ? "vercel_blob" : process.env.EVIDENCE_ARTIFACT_DIR ? "filesystem" : "not_configured" }
        : { status: "unavailable", reason: "required_tables_missing" };
      if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.EVIDENCE_ARTIFACT_DIR) checks.evidencePersistence = { status: "unavailable", reason: "artifact_store_not_configured" };
      const worker = await new PostgresCustomerExtractionJobRepository(db).health();
      checks.extractionWorker = { status: Number(worker.stale || 0) ? "degraded" : "healthy", queued: Number(worker.queued || 0), stale: Number(worker.stale || 0) };
    } catch (error) {
      checks.database = { status: "unavailable", reason: "connection_or_schema_failure" };
      checks.evidencePersistence = { status: "unavailable", reason: "database_unavailable" };
      checks.extractionWorker = { status: "unavailable", reason: "job_store_unavailable" };
    }
    const anthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
    checks.providerConfiguration = anthropicConfigured
      ? { status: "healthy", model: process.env.EVIDENCE_A3_ANTHROPIC_MODEL || "claude-sonnet-4-5" }
      : { status: "unavailable", reason: "ANTHROPIC_API_KEY_missing" };
    if (anthropicConfigured) {
      try {
        const response = await fetchImpl("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } });
        checks.anthropicConnectivity = response.ok ? { status: "healthy" } : { status: response.status >= 500 ? "degraded" : "unavailable", httpStatus: response.status };
      } catch (error) { checks.anthropicConnectivity = { status: "degraded", reason: error?.name === "AbortError" ? "timeout" : "network" }; }
    } else checks.anthropicConnectivity = { status: "unavailable", reason: "not_configured" };
    if (process.env.COMPANIES_HOUSE_API_KEY) {
      try {
        const auth = Buffer.from(`${process.env.COMPANIES_HOUSE_API_KEY}:`).toString("base64");
        const response = await fetchImpl("https://api.company-information.service.gov.uk/company/00000006", { headers: { Authorization: `Basic ${auth}` } });
        checks.companiesHouseConnectivity = response.ok ? { status: "healthy" } : { status: response.status >= 500 ? "degraded" : "unavailable", httpStatus: response.status };
      } catch (error) { checks.companiesHouseConnectivity = { status: "degraded", reason: error?.name === "AbortError" ? "timeout" : "network" }; }
    } else checks.companiesHouseConnectivity = { status: "degraded", reason: "COMPANIES_HOUSE_API_KEY_missing" };
    if (db?.close) await db.close().catch(() => {});
    const status = aggregate(checks);
    return res.status(status === "unavailable" ? 503 : 200).json({
      contractVersion: "ubo-poc-health-v1", status, checkedAt: new Date().toISOString(), timeoutMs: CONNECTIVITY_TIMEOUT_MS, checks,
    });
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
handler.CONNECTIVITY_TIMEOUT_MS = CONNECTIVITY_TIMEOUT_MS;
module.exports = handler;
