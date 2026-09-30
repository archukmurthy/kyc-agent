"use strict";

// A UBO case: the company, the research, the customer's answers and the
// assessment. Reading one tells you who owns a company and what its customer
// said; writing one changes a compliance record. So: signed in, rate-limited,
// and always inside the caller's own workspace - never one named in the request.

const { createPostgresDb } = require("../evidence/a2/postgresDb.js");
const { PocCaseService, PostgresPocCaseRepository } = require("../ubo-control-lab/server/pocCaseState.js");
const { applyCors, requireStaff, uboCallerTenant } = require("../lib/routeAuth");
const { enforceRateLimit } = require("../lib/rateLimit");
const { ensureTenantRow } = require("../lib/tenantRow");

// ponytail: a fixed ceiling, well under Vercel's 4.5 MB request cap. The
// screens compact what they send (pocCaseClient.js); raise it only if a real
// case is measured above it.
const MAX_BODY_BYTES = 3 * 1024 * 1024;

function dependencies(tenantId) {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error("POC case persistence requires DATABASE_URL"), { statusCode: 503, code: "poc_case_persistence_unavailable" });
  const db = createPostgresDb();
  return { db, service: new PocCaseService(new PostgresPocCaseRepository(db, tenantId)), close: () => db.close() };
}

const DEFAULT_GATES = { applyCors, requireStaff, enforceRateLimit };

function createHandler(factory = dependencies, gates = DEFAULT_GATES) {
  return async function uboPocCase(req, res) {
    if (gates.applyCors(req, res)) return undefined;
    if (!(await gates.enforceRateLimit(req, res, "ubo-poc-case"))) return undefined;
    const actor = await gates.requireStaff(req, res, { requireTenant: true });
    if (!actor) return undefined;
    const tenantId = uboCallerTenant(actor);
    if (!tenantId) return res.status(400).json({ success: false, error: "tenant_required" });

    if (req.method === "POST" && Buffer.byteLength(JSON.stringify(req.body || {})) > MAX_BODY_BYTES) {
      return res.status(413).json({ success: false, code: "case_payload_too_large", message: "This case update is too large to save." });
    }

    let active;
    try {
      res.setHeader("Cache-Control", "no-store");
      active = factory(tenantId);
      if (req.method === "GET") {
        const caseId = String(req.query?.caseId || "").trim();
        if (!caseId) return res.status(400).json({ success: false, code: "case_id_required", message: "caseId is required" });
        const record = await active.service.load(caseId);
        if (!record) return res.status(404).json({ success: false, code: "case_not_found", message: "The POC case was not found." });
        return res.status(200).json({ success: true, case: record });
      }
      if (req.method === "POST") {
        if (active.db) await ensureTenantRow(active.db, tenantId);
        const record = await active.service.apply(req.body || {});
        return res.status(200).json({ success: true, case: record });
      }
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ success: false, error: "Method not allowed" });
    } catch (error) {
      console.error("[ubo-poc-case] request-failed", { code: error.code || "poc_case_request_failed", statusCode: error.statusCode || 500 });
      return res.status(error.statusCode || 500).json({
        success: false,
        code: error.code || "poc_case_request_failed",
        message: error.statusCode && error.statusCode < 500 ? error.message : "The case could not be saved or restored right now.",
      });
    } finally {
      if (active?.close) await active.close();
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
handler.MAX_BODY_BYTES = MAX_BODY_BYTES;
module.exports = handler;
