"use strict";

const { createPostgresDb } = require("../../evidence/a2/postgresDb");
const { PostgresA3Repository } = require("../../evidence/a3/repository");
const { EvidenceInterpretationHistoryService } = require("../../evidence/a3/historyService");

function dependencies() {
  if (!process.env.DATABASE_URL) throw new Error("A3 history requires DATABASE_URL and migrations 010-012");
  const db = createPostgresDb();
  return { repository: new PostgresA3Repository(db), close: () => db.close() };
}

function createHandler(dependencyFactory = dependencies) {
  return async function evidenceA3HistoryHandler(req, res) {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
    let deps;
    try {
      deps = await dependencyFactory(req.body || {});
      const tenantId = process.env.EVIDENCE_LAB_TENANT_ID || process.env.TENANT_ID || "nium";
      const result = await new EvidenceInterpretationHistoryService(deps.repository).forArtifact({ artifactId: req.body?.artifactId, tenantId });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: "Interpretation history lookup failed", message: error.message });
    } finally { if (deps?.close) await deps.close(); }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
module.exports = handler;
