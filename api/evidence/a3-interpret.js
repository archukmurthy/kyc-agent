"use strict";

const path = require("node:path");
const { createPostgresDb } = require("../../evidence/a2/postgresDb");
const { PostgresA3Repository } = require("../../evidence/a3/repository");
const { EvidenceArtifactReader } = require("../../evidence/a3/artifactReader");
const { ANTHROPIC_R4_INSTRUCTION_REFERENCE, AnthropicSemanticProvider } = require("../../evidence/a3/providers");
const { LiveArtifactInterpretationService } = require("../../evidence/a3/liveService");

function liveDependencies() {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error("Live A3 interpretation requires DATABASE_URL and migrations 010-013"), { code: "database_not_configured", statusCode: 503 });
  const db = createPostgresDb();
  const provider = process.env.ANTHROPIC_API_KEY && process.env.EVIDENCE_A3_ANTHROPIC_MODEL ? new AnthropicSemanticProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.EVIDENCE_A3_ANTHROPIC_MODEL }) : null;
  const providerLineage = provider ? provider.configuration() : { provider: "anthropic", model: process.env.EVIDENCE_A3_ANTHROPIC_MODEL || null, instructionReference: ANTHROPIC_R4_INSTRUCTION_REFERENCE };
  return { repository: new PostgresA3Repository(db), artifactReader: new EvidenceArtifactReader({ filesystemRoot: process.env.EVIDENCE_ARTIFACT_DIR ? path.resolve(process.env.EVIDENCE_ARTIFACT_DIR) : null }), provider, providerLineage, close: () => db.close() };
}

function createHandler(dependencyFactory = liveDependencies) {
  return async function evidenceA3InterpretHandler(req, res) {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
    let dependencies;
    try {
      dependencies = await dependencyFactory(req.body || {});
      const service = new LiveArtifactInterpretationService(dependencies);
      const result = await service.interpret({ artifactId: req.body?.artifactId, artifactIds: req.body?.artifactIds, tenantId: process.env.EVIDENCE_LAB_TENANT_ID || process.env.TENANT_ID || "nium" });
      return res.status(200).json({ success: true, result });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: "A3 preserved-Artifact interpretation failed", code: error.code || "a3_interpretation_failed", message: error.message, details: error.details || {} });
    } finally { if (dependencies?.close) await dependencies.close(); }
  };
}

const handler = createHandler(); handler.createHandler = createHandler; handler.liveDependencies = liveDependencies;
module.exports = handler;
