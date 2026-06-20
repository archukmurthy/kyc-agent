// Generic migration applier for MULTI-statement .sql files.
//
// The shared db/migrate.js assumes one statement per file (the Neon HTTP driver
// runs a single SQL command per request). This runner splits a file into
// individual statements on `;` boundaries and runs them sequentially, so a
// migration with many CREATE TABLE / CREATE INDEX / INSERT statements works
// over the same HTTP driver.
//
// Usage:  node db/apply.js db/migrations/003_persistence_now.sql
//
// `--` comments are stripped line-by-line BEFORE splitting (so semicolons
// inside comments don't break the split). Assumes no semicolons inside string
// literals or dollar-quoted function bodies, and no `--` inside string literals
// (true for the plain DDL here). Designed for idempotent migrations.

require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");
const fs = require("fs");
const path = require("path");

async function apply() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node db/apply.js <path-to-sql>");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not found in .env.local");
    process.exit(1);
  }

  const fullPath = path.resolve(file);
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const content = fs.readFileSync(fullPath, "utf8");

  // Strip `--` comments line-by-line FIRST (a `;` inside a comment would
  // otherwise break the split), then split into statements on `;`.
  const stripped = content
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");

  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`Applying ${file} — ${statements.length} statement(s)\n`);

  let n = 0;
  for (const stmt of statements) {
    n++;
    // First non-comment line, for a readable progress log
    const label =
      stmt
        .split("\n")
        .find((line) => line.trim() && !line.trim().startsWith("--"))
        ?.trim()
        .slice(0, 70) || "(statement)";
    process.stdout.write(`  [${n}/${statements.length}] ${label} ... `);
    try {
      await sql.query(stmt + ";");
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      console.error(`\n❌ Statement ${n} failed:\n${stmt}\n\n${err.message}`);
      process.exit(1);
    }
  }

  console.log(`\n✅ ${file} applied (${statements.length} statements)`);
  process.exit(0);
}

apply().catch((err) => {
  console.error("❌ Apply failed:", err);
  process.exit(1);
});
