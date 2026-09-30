// IDV schema applier — recreates the isolated `idv` database's schema in one shot.
//
// Applies IDV migrations 013–023 IN ORDER to IDV_DATABASE_URL (the dedicated
// `idv` database), splitting each multi-statement file on `;` like db/apply.js.
// Idempotent migrations (IF NOT EXISTS), so re-running is safe. Use after the
// `idv` database has been (re)created THROUGH the Neon console so it shows in the
// console dropdown — see docs/DEMO-RUNBOOK.md "Neon Console walkthrough".
//
// Usage:  node -r dotenv/config db/apply-idv.js dotenv_config_path=.env.local
//   (or)  IDV_DATABASE_URL=... node db/apply-idv.js

require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");
const fs = require("fs");
const path = require("path");

const MIGRATIONS = [
  "013_idv_match", "014_idv_attempt_result", "015_idv_webhook_events",
  "016_idv_screening", "017_idv_evidence_refactor", "018_idv_document_media",
  "019_idv_evidence_outbox", "020_idv_lifecycle_events", "021_idv_review_tasks",
  "022_idv_vault", "023_idv_identity_events",
].map((n) => `db/migrations/${n}.sql`);

// The migration runner's splitter: one copy, so a $$-quoted body is kept whole
// here too.
const { statementsOf } = require("./migrationRunner");

async function main() {
  const url = process.env.IDV_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) { console.error("IDV_DATABASE_URL (or DATABASE_URL) not set"); process.exit(1); }
  if (!/\/idv(\?|$)/.test(url)) {
    console.warn("WARNING: target database is not named 'idv' — applying to:", url.replace(/:[^:@]+@/, ":****@"));
  }
  const sql = neon(url);

  for (const file of MIGRATIONS) {
    const full = path.resolve(file);
    if (!fs.existsSync(full)) { console.error(`File not found: ${file}`); process.exit(1); }
    const statements = statementsOf(fs.readFileSync(full, "utf8"));
    process.stdout.write(`${file} — ${statements.length} stmt(s) ... `);
    let n = 0;
    for (const stmt of statements) {
      n++;
      try { await sql.query(stmt + ";"); }
      catch (err) { console.log("FAILED"); console.error(`\n❌ ${file} statement ${n}:\n${stmt}\n\n${err.message}`); process.exit(1); }
    }
    console.log("ok");
  }
  console.log("\n✅ IDV schema applied (migrations 013–023)");
  process.exit(0);
}

main().catch((err) => { console.error("❌ apply-idv failed:", err); process.exit(1); });
