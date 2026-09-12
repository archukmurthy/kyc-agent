const { test } = require("node:test");
const assert = require("node:assert");
const { sanitiseTenantId, getTenantIdFromRequest } = require("../tenant");

// 3-strict tenant resolution: no hardcoded "nium" fallback anywhere. Absence
// of ?tenant=, x-tenant-id, and TENANT_ID must resolve to "" so api/config.js
// can refuse the request instead of silently seeding/serving a tenant.

test("sanitiseTenantId: lowercases, strips invalid chars, clamps to 32", () => {
  assert.strictEqual(sanitiseTenantId("Acme-Corp_1!"), "acme-corp1");
  assert.strictEqual(sanitiseTenantId("a".repeat(40)), "a".repeat(32));
});

test("sanitiseTenantId: returns '' for empty/nullish/invalid input", () => {
  assert.strictEqual(sanitiseTenantId(""), "");
  assert.strictEqual(sanitiseTenantId(null), "");
  assert.strictEqual(sanitiseTenantId(undefined), "");
  assert.strictEqual(sanitiseTenantId("!!!"), "");
});

test("getTenantIdFromRequest: ?tenant= query param wins", () => {
  const req = { query: { tenant: "acme" }, headers: {} };
  assert.strictEqual(getTenantIdFromRequest(req), "acme");
});

test("getTenantIdFromRequest: falls back to x-tenant-id header", () => {
  const req = { query: {}, headers: { "x-tenant-id": "acme" } };
  assert.strictEqual(getTenantIdFromRequest(req), "acme");
});

test("getTenantIdFromRequest: falls back to TENANT_ID env var", (t) => {
  const prev = process.env.TENANT_ID;
  process.env.TENANT_ID = "acme";
  t.after(() => {
    if (prev === undefined) delete process.env.TENANT_ID;
    else process.env.TENANT_ID = prev;
  });
  const req = { query: {}, headers: {} };
  assert.strictEqual(getTenantIdFromRequest(req), "acme");
});

test("getTenantIdFromRequest: returns '' when nothing resolves — no hardcoded 'nium'", (t) => {
  const prev = process.env.TENANT_ID;
  delete process.env.TENANT_ID;
  t.after(() => {
    if (prev !== undefined) process.env.TENANT_ID = prev;
  });
  const req = { query: {}, headers: {} };
  assert.strictEqual(getTenantIdFromRequest(req), "");
});

test("getTenantIdFromRequest: parses ?tenant= from req.url when req.query is missing", () => {
  const req = { url: "/api/config?tenant=acme", headers: {} };
  assert.strictEqual(getTenantIdFromRequest(req), "acme");
});
