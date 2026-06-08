require("dotenv").config({
  path: ".env.local",
});
const { neon } = require("@neondatabase/serverless");
const fs = require("fs");
const path = require("path");

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not found in .env.local");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  const migrations = [
    "db/migrations/002_cost_breakdown.sql",
  ];

  for (const file of migrations) {
    const fullPath = path.resolve(file);
    if (!fs.existsSync(fullPath)) {
      console.error(`File not found: ${file}`);
      process.exit(1);
    }
    console.log(`Running ${file}...`);
    const content = fs.readFileSync(fullPath, "utf8");
    // This neon version rejects sql(string); the conventional-call form is
    // sql.query(text). Each migration file is a single SQL statement, which
    // is exactly what the HTTP driver supports per request.
    await sql.query(content);
    console.log(`✅ ${file} done`);
  }

  console.log("✅ All migrations complete");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
