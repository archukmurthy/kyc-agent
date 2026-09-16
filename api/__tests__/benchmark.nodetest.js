const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const benchmark = require("../benchmark");

function fakeReqRes({ method = "GET", query = {}, headers = {} } = {}) {
  const req = { method, query, headers, url: "/api/benchmark" };
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

let readConfigCalls;

beforeEach(() => {
  readConfigCalls = [];
  benchmark.__setDeps({
    authorizeAdmin: async (tenant, token) => tenant === "acme" && token === "admin-secret",
    readConfigForTenant: async (tenant) => { readConfigCalls.push(tenant); return tenant === "acme" ? { entityTypes: [] } : null; },
  });
});

test("no credential is a 401 and the tenant config is never read", async () => {
  const { req, res } = fakeReqRes({ query: { tenant: "acme", companyName: "X", countryCode: "GB", entityType: "Corporate" } });
  await benchmark(req, res);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { error: "unauthorized" });
  assert.deepStrictEqual(readConfigCalls, []);
});

test("a wrong admin password is a 401", async () => {
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, headers: { authorization: "Bearer nope" } });
  await benchmark(req, res);
  assert.strictEqual(res.statusCode, 401);
});

test("no resolvable tenant is a 401 (there is nothing to authenticate against)", async () => {
  const { req, res } = fakeReqRes({ headers: { authorization: "Bearer admin-secret" } });
  await benchmark(req, res);
  assert.strictEqual(res.statusCode, 401);
});

test("an admin credential for a tenant with no config is a 404", async () => {
  benchmark.__setDeps({ authorizeAdmin: async () => true });
  const { req, res } = fakeReqRes({ query: { tenant: "ghost" }, headers: { authorization: "Bearer admin-secret" } });
  await benchmark(req, res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "tenant_not_found" });
});

test("a valid admin credential clears the gate (no company given → 400, still no Anthropic call)", async () => {
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, headers: { authorization: "Bearer admin-secret" } });
  await benchmark(req, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(readConfigCalls, ["acme"]);
});
