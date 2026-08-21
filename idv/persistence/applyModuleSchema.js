"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

async function apply() {
  if (!process.env.IDV_DATABASE_URL) throw new Error("IDV_DATABASE_URL is required");
  const sql = fs.readFileSync(path.join(__dirname, "migrations", "001_idv_module_schema.sql"), "utf8");
  const pool = new Pool({ connectionString: process.env.IDV_DATABASE_URL });
  try { await pool.query(sql); } finally { await pool.end(); }
}

if (require.main === module) apply().then(() => process.stdout.write("IDV module schema applied\n")).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { apply };
