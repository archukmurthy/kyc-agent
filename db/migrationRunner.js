"use strict";

/**
 * Applies database changes in order, once, and records what it did.
 *
 * Before this, migrations were applied by hand one file at a time (db/apply.js)
 * with nothing recording what had run where. Five were sitting unapplied and
 * there was no way to tell which environment had which.
 *
 * It decides nothing about what tables exist - it applies whatever .sql files
 * are in db/migrations. Adding it does not touch anybody's schema design.
 *
 * Rules it follows:
 *   - files run in filename order, so 001 before 002
 *   - a file that has already run is skipped
 *   - a failure stops the run; the remaining files are not attempted, because
 *     a half-applied database nobody can measure is worse than one that stopped
 *   - the checksum of each file is stored, so editing a migration that has
 *     already run is visible rather than silent
 *   - a migration recorded in the database but missing from the folder is
 *     reported as drift rather than ignored
 *
 * Usage:
 *   npm run db:migrate                apply everything pending
 *   npm run db:migrate -- --dry       say what would happen, change nothing
 *   npm run db:migrate -- --baseline  adopt an existing database: record every
 *                                     current file as applied WITHOUT running
 *                                     it. Run this once per database that was
 *                                     migrated by hand before the runner
 *                                     existed, or the first real run would
 *                                     re-apply years of history.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

const CREATE_LEDGER = `CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

function checksumOf(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

/** Reads db/migrations into { filename: contents }, in filename order. */
function readMigrations(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return {};
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const out = {};
  for (const file of files) out[file] = fs.readFileSync(path.join(dir, file), "utf8");
  return out;
}

/** Splits a file into statements. Mirrors db/apply.js: strip `--` comments
 *  first so a semicolon inside one cannot split a statement in half. A
 *  $$-quoted body (a trigger function's) is kept whole: its own semicolons
 *  are not statement ends. */
function statementsOf(contents) {
  const stripped = contents
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
  const out = [];
  let current = "";
  let quoted = false;
  for (const part of stripped.split(/(\$\$|;)/)) {
    if (part === "$$") quoted = !quoted;
    if (part === ";" && !quoted) { out.push(current); current = ""; } else current += part;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {object} options
 * @param {(statement: string) => Promise<any>} options.sql  executes one statement
 * @param {Record<string,string>} [options.files]            filename -> contents
 * @param {boolean} [options.dryRun]
 */
async function run({ sql, files = readMigrations(), dryRun = false, baseline = false, log = () => {} } = {}) {
  if (typeof sql !== "function") throw new Error("run() needs a sql executor");

  await sql(CREATE_LEDGER);
  const rows = await sql("SELECT filename FROM schema_migrations ORDER BY filename;");
  const already = new Set((rows || []).map((r) => r.filename));

  const names = Object.keys(files).sort();
  const pending = names.filter((name) => !already.has(name));

  // Recorded as applied, but no longer in the folder. Someone applied a file by
  // hand, or a branch was reverted. Silence here is how two environments
  // diverge without anybody noticing.
  const drift = [...already].filter((name) => !names.includes(name));

  if (dryRun) return { pending, applied: [], drift };

  if (baseline) {
    // Adopting a database that was migrated by hand. Record what is there
    // without running anything: these tables already exist, and re-running
    // their migrations would range from wasteful to destructive.
    for (const name of pending) {
      log(`baseline ${name}`);
      await sql(
        `INSERT INTO schema_migrations (filename, checksum) VALUES ('${name}', '${checksumOf(files[name])}');`
      );
    }
    return { pending, applied: [], baselined: pending, drift };
  }

  const applied = [];
  for (const name of pending) {
    const contents = files[name];
    log(`applying ${name}`);
    try {
      for (const statement of statementsOf(contents)) {
        await sql(`${statement};`);
      }
    } catch (err) {
      // Stop here. Attempting the rest would leave a database nobody can
      // describe, and the next run could not tell how far it got.
      throw new Error(`${name} failed: ${err.message}`);
    }
    await sql(
      `INSERT INTO schema_migrations (filename, checksum) VALUES ('${name}', '${checksumOf(contents)}');`
    );
    applied.push(name);
  }

  return { pending, applied, drift };
}

module.exports = { run, readMigrations, statementsOf, checksumOf, CREATE_LEDGER, MIGRATIONS_DIR };
