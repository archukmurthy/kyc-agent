"use strict";

// Background retry worker for the submission inbox. Claims pending/failed rows and
// runs the all-or-nothing finalize for each. Invoked by Vercel Cron on a schedule;
// also runnable locally via scripts/run-finalize-worker.js. attempts is incremented
// by claimPending on claim (start of attempt, not on failure) so a hard-crashing
// process still counts toward the retry ceiling via stale-processing reclaim. A row
// that fails is marked failed and retried on the next tick until it succeeds or hits
// the attempts ceiling — the submission is never lost (or, past the ceiling,
// abandoned and dead-lettered for manual triage).
const store = require("./lib/submissionInboxStore");
const { finalizeSubmission } = require("./lib/finalizeSubmission");

// Parses a positive-integer env override, falling back to `def` on missing/NaN/non-positive.
function parseIntEnv(raw, def) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

async function runWorker(deps = {}) {
  const claimPending = deps.claimPending || store.claimPending;
  const finalize = deps.finalizeSubmission || finalizeSubmission;
  const markDone = deps.markDone || store.markDone;
  const markFailed = deps.markFailed || store.markFailed;
  const countDeadLettered = deps.countDeadLettered || store.countDeadLettered;

  const limit = parseIntEnv(process.env.FINALIZE_BATCH_LIMIT, 20);
  const staleSeconds = parseIntEnv(process.env.FINALIZE_STALE_SECONDS, 300);
  const rows = await claimPending({ limit, staleSeconds });
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

  const deadLettered = await countDeadLettered();
  if (deadLettered > 0) {
    console.error(
      `[finalize-submissions] ${deadLettered} submission(s) dead-lettered (attempts >= ${store.MAX_ATTEMPTS}) — manual triage required`
    );
  }

  return { claimed: rows.length, done, failed, deadLettered };
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
