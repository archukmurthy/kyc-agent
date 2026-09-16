const { test } = require("node:test");
const assert = require("node:assert");
const handler = require("../config-templates");
const registry = require("../../lib/tenantRegistry");

const ADMIN = "test-admin-password";

function fakeStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    data,
    async get(key) { return key in data ? data[key] : null; },
    async set(key, value) { data[key] = value; },
  };
}

function fakeReqRes({ query = {}, headers = {} } = {}) {
  const req = { method: "GET", query, headers, url: "/api/config-templates" };
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

function withAdmin(t) {
  const prev = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = ADMIN;
  t.after(() => {
    if (prev === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prev;
  });
}

test("listing templates requires an admin credential", async (t) => {
  withAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme", isProtected: true }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ query: { tenant: "acme" } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 401);
});

test("an authed list returns the template ids", async (t) => {
  withAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme", isProtected: true }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    query: { tenant: "acme" },
    headers: { authorization: `Bearer ${ADMIN}` },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.templates.some((x) => x.id === "nium-default"));
});

test("?id= builds the template for the requesting tenant", async (t) => {
  withAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme", isProtected: true }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    query: { tenant: "acme", id: "nium-default" },
    headers: { authorization: `Bearer ${ADMIN}` },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.config._tenantId, "acme");
  assert.strictEqual(res.body.config.company.name, "");
});

test("an unknown template id is a 404", async (t) => {
  withAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme", isProtected: true }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    query: { tenant: "acme", id: "nope" },
    headers: { authorization: `Bearer ${ADMIN}` },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "template_not_found" });
});
