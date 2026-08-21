"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadConfig } = require("../config");
const { ProviderAdapter } = require("../contracts/providerAdapter");
const { ProviderRouter } = require("../services/providerRouter");
const { sanitizeLogFields } = require("../security/safeLogger");
const { PostgresTransactionRunner } = require("../persistence/postgresTransactionRunner");

test("production configuration rejects synthetic/harness modes and requires DB plus OIDC", () => {
  assert.throws(() => loadConfig({ IDV_RUNTIME_MODE: "production", IDV_SYNTHETIC_ONLY: "1" }), /forbidden/);
  assert.throws(() => loadConfig({ IDV_RUNTIME_MODE: "production", IDV_POC_HARNESS_ENABLED: "1" }), /forbidden/);
  assert.throws(() => loadConfig({ IDV_RUNTIME_MODE: "production" }), /IDV_DATABASE_URL/);
});

test("module-local schema force-enables default-deny RLS with transaction-local tenant context", () => {
  const schema = fs.readFileSync(path.join(__dirname, "..", "persistence", "migrations", "001_idv_module_schema.sql"), "utf8");
  for (const table of ["idv_secure_identity_records", "idv_encrypted_identity_attributes", "idv_encrypted_customer_responses", "idv_identity_access_audit"]) {
    assert.match(schema, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(schema, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
  }
  assert.match(schema, /current_setting\('app\.tenant_id', true\)/);
  assert.match(schema, /must not own these/);
});

test("PostgreSQL tenant context is transaction-local and missing context is denied", async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; }, release: () => calls.push({ sql: "RELEASE" }) };
  const runner = new PostgresTransactionRunner({ pool: { connect: async () => client } });
  await runner.withTenantTransaction("tenant-a", async (transaction) => transaction.query("SELECT 1"));
  assert.deepEqual(calls.slice(0, 4).map((call) => call.sql), ["BEGIN", "SELECT set_config('app.tenant_id', $1, true)", "SELECT 1", "COMMIT"]);
  assert.deepEqual(calls[1].params, ["tenant-a"]);
  await assert.rejects(runner.withTenantTransaction("", async () => {}), /trusted tenant context/);
});

test("a conventional third provider needs only an adapter registration and routing configuration", () => {
  class ThirdProvider extends ProviderAdapter {
    async createVerificationSession() {}
    getHostedVerificationUrl() {}
    async handleWebhook() {}
    async retrieveVerificationResult() {}
    getCapabilities() {}
    getExternalEvidenceReferences() {}
    getProviderCostInformation() {}
  }
  const adapter = new ThirdProvider();
  const router = new ProviderRouter({ defaultProvider: "THIRD", availableProviders: ["DIDIT", "VERIFF", "THIRD"], overrides: [{ tenantId: "tenant-c", provider: "THIRD" }] });
  assert.equal(router.select({ tenantId: "tenant-c" }), "THIRD");
  assert.equal(typeof adapter.handleWebhook, "function");
});

test("tracked IDV fixtures and source contain no obvious real secrets or raw evidence payloads", () => {
  const root = path.join(__dirname, "..");
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : files.push(path.join(dir, entry.name)));
  walk(root);
  const text = files.filter((file) => /\.(?:js|json|md|sql|example)$/.test(file)).map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const secretPatterns = [
    new RegExp("sk_" + "live_"),
    new RegExp("AK" + "IA[0-9A-Z]{16}"),
    new RegExp("-----BEGIN " + "(?:RSA )?PRIVATE KEY-----"),
  ];
  for (const pattern of secretPatterns) assert.doesNotMatch(text, pattern);
  for (const fixture of files.filter((file) => file.includes(`${path.sep}fixtures${path.sep}`))) {
    const value = fs.readFileSync(fixture, "utf8");
    assert.doesNotMatch(value, /data:image|document_image|selfie_image|biometric_template|facial_vector/i);
  }
});

test("normal IDV logging drops PII, raw payloads, hosted tokens, and biometric scores", () => {
  const sanitized = sanitizeLogFields({
    internal_idv_session_id: "session-1",
    provider: "DIDIT",
    canonical_status: "VERIFIED",
    first_name: "SYNTHETIC_NAME",
    date_of_birth: "2000-01-01",
    document_number: "SYNTHETIC_DOCUMENT",
    raw_payload: { secret: true },
    hosted_verification_url: "https://provider.example/secret-token",
    biometric_score: 0.99,
  });
  assert.deepEqual(sanitized, { internal_idv_session_id: "session-1", provider: "DIDIT", canonical_status: "VERIFIED" });
});
