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
  const { createPostgresDb } = require("../evidence/a2/postgresDb");
  const { createArtifactStore } = require("../evidence/customerOwnershipJobs/dependencies");
  const db = createPostgresDb();
  return { db, artifactStore: createArtifactStore(), close: () => db.close() };
}

function createHandler(deps = { connect, runTrialPurge }) {
  return async function purgeTrialData(req, res) {
    const header = String(req.headers?.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!verifyEnvBearer(token, "CRON_SECRET")) return res.status(401).json({ error: "unauthorized" });
    if (!process.env.DATABASE_URL && deps.connect === connect) return res.status(503).json({ error: "database_not_configured" });

    const dryRun = String(req.query?.dryRun || "") === "1";
    const { db, artifactStore, close } = deps.connect();
    try {
      const report = await deps.runTrialPurge({ db, artifactStore, dryRun });
      // Workspace ids only - no people, no company names - so it is safe to log.
      console.info("[purge-trial-data]", JSON.stringify({ dryRun, deleted: report.deleted.map((w) => w.tenantId), failed: report.failed }));
      return res.status(report.failed.length ? 500 : 200).json({ ok: report.failed.length === 0, dryRun, ...report });
    } finally {
      await close();
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
module.exports = handler;
