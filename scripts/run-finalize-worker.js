// One-shot local run of the finalize worker (Vercel Cron does not fire in dev).
// Usage: node -r dotenv/config scripts/run-finalize-worker.js dotenv_config_path=.env.local
// Optional: --limit=<n> overrides the batch size for this run only.
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
if (limitArg) process.env.FINALIZE_BATCH_LIMIT = limitArg.slice("--limit=".length);

const { runWorker } = require("../api/finalize-submissions");
runWorker()
  .then((r) => { console.log("worker result:", r); process.exit(0); })
  .catch((e) => { console.error("worker failed:", e); process.exit(1); });
