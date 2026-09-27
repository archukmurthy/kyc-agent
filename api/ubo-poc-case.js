"use strict";

const { createPostgresDb } = require("../evidence/a2/postgresDb.js");
const { PocCaseService, PostgresPocCaseRepository } = require("../ubo-control-lab/server/pocCaseState.js");

function dependencies() {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error("POC case persistence requires DATABASE_URL"), { statusCode: 503, code: "poc_case_persistence_unavailable" });
  const db = createPostgresDb();
  return { service: new PocCaseService(new PostgresPocCaseRepository(db)), close: () => db.close() };
}

function createHandler(factory = dependencies) {
  return async function uboPocCase(req, res) {
    let active;
    try {
      res.setHeader("Cache-Control", "no-store");
      active = factory();
      if (req.method === "GET") {
        const caseId = String(req.query?.caseId || "").trim();
        if (!caseId) return res.status(400).json({ success: false, code: "case_id_required", message: "caseId is required" });
        const record = await active.service.load(caseId);
        if (!record) return res.status(404).json({ success: false, code: "case_not_found", message: "The POC case was not found." });
        return res.status(200).json({ success: true, case: record });
      }
      if (req.method === "POST") {
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
module.exports = handler;
