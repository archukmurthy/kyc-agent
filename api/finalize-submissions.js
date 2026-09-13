"use strict";

// Background retry worker for the submission inbox. Claims pending/failed rows and
// runs the all-or-nothing finalize for each. Invoked by Vercel Cron on a schedule;
// also runnable locally via scripts/run-finalize-worker.js. A row that fails is
// marked failed (attempts++) and retried on the next tick until it succeeds or hits
// the attempts ceiling — the submission is never lost.
const store = require("./lib/submissionInboxStore");
const { finalizeSubmission } = require("./lib/finalizeSubmission");

async function runWorker(deps = {}) {
  const claimPending = deps.claimPending || store.claimPending;
  const finalize = deps.finalizeSubmission || finalizeSubmission;
  const markDone = deps.markDone || store.markDone;
  const markFailed = deps.markFailed || store.markFailed;

  const rows = await claimPending({ limit: 20 });
  let done = 0, failed = 0;
  for (const row of rows) {
    try {
      const r = await finalize(row.payload);
      await markDone(row.id, r.sessionId);
      done++;
    } catch (err) {
      await markFailed(row.id, err.message);
      failed++;
    }
  }
  return { claimed: rows.length, done, failed };
}

module.exports = async function handler(req, res) {
  // Vercel sets Authorization: Bearer <CRON_SECRET> on cron invocations when the
  // env var is present. Reject anything else so the endpoint isn't publicly runnable.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const result = await runWorker();
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("[finalize-submissions] worker error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

module.exports.runWorker = runWorker;
