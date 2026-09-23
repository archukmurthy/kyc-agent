const { test } = require("node:test");
// Sets a session secret, which a login now needs in order to mint one.
require("./_sessions");
const assert = require("node:assert");
const handler = require("../admin-auth");
const registry = require("../../lib/tenantRegistry");

function fakeReqRes(body) {
  const req = { method: "POST", query: { tenant: "nium" }, body, headers: {}, url: "/api/admin-auth" };
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

test("env-password login with an UNREADABLE registry succeeds and never overwrites the registry", async (t) => {
  const prev = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "test-admin-password";
  t.after(() => {
    if (prev === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prev;
  });

  const writes = [];
  const storage = {
    async get(key) {
      if (key === "tenant-registry") throw new Error("kv down");
      return null; // no tenant-auth:nium yet → env fallback path
    },
    async set(key) { writes.push(key); },
  };
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ password: "test-admin-password" });
  await handler(req, res);

  // The password verified; a failed opportunistic registry seed must not
  // turn that into a failed login.
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(!writes.includes("tenant-registry"), "registry must not be written from an unreadable read");
});
