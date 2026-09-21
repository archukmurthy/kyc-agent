#!/usr/bin/env node
"use strict";

/**
 * Applies every pending migration, in order, once.
 *
 *   npm run db:migrate         apply what is pending
 *   npm run db:migrate -- --dry   say what would happen, change nothing
 *
 * Replaces applying files by hand with db/apply.js and remembering which
 * environment had which. The old script stays for one-off use; this is the one
 * to run on a deploy.
 *
 * Exits non-zero on failure or on drift, so it can gate a deploy.
 */

require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");
const runner = require("./migrationRunner");

async function main() {
  const dryRun = process.argv.includes("--dry");
  const baseline = process.argv.includes("--baseline");

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Nothing to migrate against.");
    process.exit(1);
  }

  const neonSql = neon(process.env.DATABASE_URL);
  const sql = (statement) => neonSql.query(statement);

  // Which database, without printing the password.
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL).host;
    } catch (_) {
      return "(unparseable DATABASE_URL)";
    }
  })();
  const verb = dryRun ? "Checking" : baseline ? "Baselining" : "Migrating";
  console.log(`${verb} ${host}\n`);
  if (baseline) {
    console.log("Recording existing migrations as applied WITHOUT running them.");
    console.log("Only correct on a database that was already migrated by hand.\n");
  }

  const result = await runner.run({ sql, dryRun, baseline, log: (line) => console.log(`  ${line}`) });

  if (result.drift.length) {
    // Recorded as applied here but missing from the folder. Worth stopping for:
    // it means this database and this checkout disagree about history.
    console.error("\nDrift - applied here but not present in db/migrations:");
    for (const name of result.drift) console.error(`  ${name}`);
  }

  if (dryRun) {
    console.log(result.pending.length ? `\nPending (${result.pending.length}):` : "\nNothing pending.");
    for (const name of result.pending) console.log(`  ${name}`);
  } else if (baseline) {
    console.log(`\nRecorded ${(result.baselined || []).length} existing migration(s). Nothing was run.`);
  } else {
    console.log(result.applied.length ? `\nApplied ${result.applied.length}.` : "\nNothing to apply.");
  }

  process.exit(result.drift.length ? 2 : 0);
}

// Only run when invoked directly. Without this guard, importing the file to
// check that it loads starts migrating a live database - which is exactly what
// happened once during development.
if (require.main === module) {
  main().catch((err) => {
    console.error(`\n${err.message}`);
    console.error("\nStopped. Nothing after the failing migration was attempted.");
    process.exit(1);
  });
} else {
  module.exports = { main };
}
