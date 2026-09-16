const { test } = require("node:test");
const assert = require("node:assert");
const benchmarkHandler = require("../benchmark");
const configHandler = require("../config");
const registry = require("../../lib/tenantRegistry");

// Covers the refusal branch added when api/benchmark.js dropped its
// duplicate tenant-config reader and started routing through the shared
// readConfigForTenant (api/config.js) — see api/benchmark.js lines 204-207.
//
// The 404 branch returns before any Anthropic call, which is what makes
// cases 1 and 2 safe to run with no network seam. Case 3 deliberately
// removes ANTHROPIC_API_KEY so that even though it clears the tenant gate,
// the handler fails locally on the missing key instead of calling out.

function fakeStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    data,
    async get(key) { return key in data ? data[key] : null; },
    async set(key, value) { data[key] = value; },
    async del(key) { delete data[key]; },
    async list(prefix) { return Object.keys(data).filter((k) => k.startsWith(prefix)); },
  };
}

function fakeReqRes({ method = "GET", query = {}, headers = {} } = {}) {
  const req = { method, query, headers, url: "/api/benchmark" };
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

test("no resolvable tenant (no ?tenant=, no x-tenant-id) returns 404 tenant_not_found", async (t) => {
  const prevTenantId = process.env.TENANT_ID;
  delete process.env.TENANT_ID;
  t.after(() => {
    if (prevTenantId !== undefined) process.env.TENANT_ID = prevTenantId;
  });

  const storage = fakeStorage({});
  configHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ method: "GET", query: {} });
  await benchmarkHandler(req, res);

  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "tenant_not_found" });
});

test("a tenant not in the registry returns 404 tenant_not_found", async () => {
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme" }] });
  configHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: "ghost" } });
  await benchmarkHandler(req, res);

  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "tenant_not_found" });
});

test("a registered tenant with a stored config clears the tenant gate", async (t) => {
  // Guarantees this test cannot issue a live Anthropic request even though it
  // gets past the tenant_not_found check: callAnthropic() (api/benchmark.js)
  // throws on the missing key before it ever calls fetch().
  const prevKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  t.after(() => {
    if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
  });

  const storage = fakeStorage({
    "tenant-registry": [{ tenantId: "acme" }],
    "config:acme": {
      _version: 1,
      licences: [{ id: "GB" }],
      entityTypes: [{ id: "Corporate", active: true }],
    },
  });
  configHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "GET",
    query: {
      tenant: "acme",
      companyName: "Acme Corp",
      countryCode: "GB",
      entityType: "Corporate",
    },
  });
  await benchmarkHandler(req, res);

  // Not asserting a successful benchmark run — only that the tenant gate
  // (the thing this test targets) did not reject the request.
  assert.notStrictEqual(res.statusCode, 404);
  assert.notDeepStrictEqual(res.body, { error: "tenant_not_found" });
});
