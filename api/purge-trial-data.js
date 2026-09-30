"use strict";

// Deletes the UBO trial workspaces of companies that did not buy, 90 days
// after their trial ended (lib/uboTrialPurge.js; the rule is in
// lib/uboRetention.js). Called once a day by the Vercel scheduler (vercel.json).
//
// Who may call it: the scheduler, with Authorization: Bearer <CRON_SECRET>.
// Nobody else. It deletes for real, so an unset secret refuses everyone - it
// must never copy api/finalize-submissions.js, which lets anyone in when the
// secret is missing (CRON-1).
//
// ?dryRun=1 reports what would be deleted and deletes nothing.

const { verifyEnvBearer } = require("../lib/auth");
const { runTrialPurge } = require("../lib/uboTrialPurge");

function connect() {
  const path = require("node:path");
  const { createPostgresDb } = require("../evidence/a2/postgresDb");
  const { FileArtifactStore, VercelBlobArtifactStore } = require("../evidence/a2/artifactStore");
  const db = createPostgresDb();
  // Each file is deleted from the store its row says it is in. A store this
  // deployment cannot reach throws, and the file waits on the pending list.
  const deleteFile = async ({ provider, key }) => {
    if (provider === "vercel_blob" && process.env.BLOB_READ_WRITE_TOKEN) return new VercelBlobArtifactStore().delete(key);
    if (provider === "filesystem" && process.env.EVIDENCE_ARTIFACT_DIR) return new FileArtifactStore(path.resolve(process.env.EVIDENCE_ARTIFACT_DIR)).delete(key);
    throw Object.assign(new Error(`no store for ${provider}`), { code: "file_store_unavailable" });
  };
  return { db, deleteFile, close: () => db.close() };
}

function createHandler(deps = { connect, runTrialPurge }) {
  return async function purgeTrialData(req, res) {
    const header = String(req.headers?.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!verifyEnvBearer(token, "CRON_SECRET")) return res.status(401).json({ error: "unauthorized" });
    if (!process.env.DATABASE_URL && deps.connect === connect) return res.status(503).json({ error: "database_not_configured" });

    const dryRun = String(req.query?.dryRun || "") === "1";
    const { db, deleteFile, close } = deps.connect();
    try {
      const report = await deps.runTrialPurge({ db, deleteFile, dryRun });
      // Workspace ids only - no people, no company names - so it is safe to log.
      console.info("[purge-trial-data]", JSON.stringify({ dryRun, disabled: Boolean(report.disabled), deleted: report.deleted.map((w) => w.tenantId), blocked: report.blocked.map((w) => w.tenantId), failed: report.failed, pendingFiles: report.pendingFiles }));
      return res.status(report.failed.length ? 500 : 200).json({ ok: report.failed.length === 0, dryRun, ...report });
    } finally {
      await close();
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
module.exports = handler;
