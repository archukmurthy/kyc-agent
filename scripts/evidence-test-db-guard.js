"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONFIRMATION = "I_UNDERSTAND_TEST_DATA_WILL_BE_WRITTEN";

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = rawLine.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function normalize(value) {
  return String(value || "").trim().replace(/[?&](?:sslmode|channel_binding)=[^&]*/g, "").replace(/[?&]$/, "");
}

function loadEvidenceTestEnv(cwd = process.cwd(), env = process.env) {
  const values = parseEnvFile(path.resolve(cwd, ".env.test.local"));
  for (const [key, value] of Object.entries(values)) if (env[key] === undefined) env[key] = value;
  return env;
}

function requireDisposableEvidenceDatabase({ cwd = process.cwd(), env = process.env } = {}) {
  const testUrl = env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL is required");
  if (env.REAL_DB_SMOKE_CONFIRM !== CONFIRMATION) throw new Error(`Set REAL_DB_SMOKE_CONFIRM=${CONFIRMATION}`);
  const localApplicationUrl = parseEnvFile(path.resolve(cwd, ".env.local")).DATABASE_URL;
  const applicationUrl = env.DATABASE_URL || localApplicationUrl;
  if (applicationUrl && normalize(testUrl) === normalize(applicationUrl)) throw new Error("TEST_DATABASE_URL resolves to the configured development/Lab DATABASE_URL. Refusing to write smoke-test Evidence there.");
  return testUrl;
}

module.exports = { CONFIRMATION, loadEvidenceTestEnv, normalize, parseEnvFile, requireDisposableEvidenceDatabase };
