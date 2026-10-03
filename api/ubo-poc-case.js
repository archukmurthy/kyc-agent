"use strict";

const { randomUUID } = require("node:crypto");

// A UBO case: the company, the research, the customer's answers and the
// assessment. Reading one tells you who owns a company and what its customer
// said; writing one changes a compliance record. So: signed in, rate-limited,
// and always inside the caller's own workspace - never one named in the request.

const { createPostgresDb } = require("../evidence/a2/postgresDb.js");
const { PocCaseService, PostgresPocCaseRepository } = require("../ubo-control-lab/server/pocCaseState.js");
const { applyCors, requireUboCaller, uboCallerTenant } = require("../lib/routeAuth");
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

// What a customer (a session for ONE case) may do to that case. Research and
// the analyst's own state are the analyst's; anything new is refused until it
// is deliberately added here.
const CUSTOMER_OPERATIONS = new Set(["UPSERT_CASE", "ASSOCIATE_CHART", "SYNC_RESOLUTION", "SUBMIT_ANSWER", "RESET_ANSWERS", "FINALIZE_ASSESSMENT", "COMPLETE_IDV"]);

function commandCaseId(body) {
  return String(body?.caseId || body?.payload?.demoCase?.demoCaseId || "").trim();
}

const DEFAULT_GATES = { applyCors, requireUboCaller, enforceRateLimit };

function createHandler(factory = dependencies, gates = DEFAULT_GATES) {
  return async function uboPocCase(req, res) {
    if (gates.applyCors(req, res)) return undefined;
    if (!(await gates.enforceRateLimit(req, res, "ubo-poc-case"))) return undefined;
    const actor = await gates.requireUboCaller(req, res, { requireTenant: true });
    if (!actor) return undefined;
    const tenantId = uboCallerTenant(actor);
    if (!tenantId) return res.status(400).json({ success: false, error: "tenant_required" });

    if (req.method === "POST" && Buffer.byteLength(JSON.stringify(req.body || {})) > MAX_BODY_BYTES) {
      return res.status(413).json({ success: false, code: "case_payload_too_large", message: "This case update is too large to save." });
    }

    // A customer's session names one case. Another case answers exactly as a
    // case that does not exist would.
    const customer = actor.kind === "customer";
    const requested = req.method === "GET" ? String(req.query?.caseId || "").trim() : commandCaseId(req.body);
    if (customer && requested !== actor.caseId) {
      return res.status(404).json({ success: false, code: "case_not_found", message: "The POC case was not found." });
    }
    if (customer && req.method === "POST" && !CUSTOMER_OPERATIONS.has(req.body?.operation)) {
      return res.status(403).json({ success: false, code: "not_a_customer_operation", message: "This step is not available from a customer link." });
    }

    // One id for this whole request, in the audit ledger and the response; a
    // caller's own is used when it is a plain id.
    const offered = String(req.headers?.["x-correlation-id"] || "");
    const correlationId = /^[A-Za-z0-9:._-]{8,100}$/.test(offered) ? offered : randomUUID();
    const receivedAt = new Date().toISOString();
    res.setHeader("X-Correlation-Id", correlationId);

    let active;
    try {
      res.setHeader("Cache-Control", "no-store");
      active = factory(tenantId);
      if (req.method === "GET") {
        // The workspace's researched cases, to start a new case from without a
        // provider call. Staff only: to a customer it does not exist (and a
        // customer never reaches here - no caseId is not their case).
        if (String(req.query?.savedResearch || "") === "1") {
          if (customer) return res.status(404).json({ success: false, code: "not_found" });
          return res.status(200).json({ success: true, research: await active.service.savedResearch() });
        }
        const caseId = String(req.query?.caseId || "").trim();
        if (!caseId) return res.status(400).json({ success: false, code: "case_id_required", message: "caseId is required" });
        // The audit ledger is staff's (UBO-33): to a customer it does not exist.
        if (String(req.query?.ledger || "") === "1") {
          if (customer) return res.status(404).json({ success: false, code: "not_found" });
          return res.status(200).json({ success: true, events: await active.service.ledger(caseId) });
        }
        const record = await active.service.load(caseId);
        if (!record) return res.status(404).json({ success: false, code: "case_not_found", message: "The POC case was not found." });
        return res.status(200).json({ success: true, case: record });
      }
      if (req.method === "POST") {
        // A customer works on a case that exists; they never create one - a
        // link to a deleted case (a purged trial) must not write it back.
        if (customer && !(await active.service.load(actor.caseId))) {
          return res.status(404).json({ success: false, code: "case_not_found", message: "The POC case was not found." });
        }
        if (active.db) await ensureTenantRow(active.db, tenantId);
        // Who acted, and when the server received it, are the credential's and
        // the server's answers - never the request's.
        const record = await active.service.apply({
          ...(req.body || {}),
          actorType: customer ? "CUSTOMER" : "ANALYST",
          actorId: actor.userId || null,
          correlationId,
          receivedAt,
        });
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
