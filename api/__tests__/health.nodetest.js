"use strict";

// The health check. Two things matter: it tells the truth when the store is
// down, and it tells a stranger nothing.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const health = require("../health");

function call() {
  const req = { method: "GET", headers: {}, query: {}, url: "/api/health" };
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

const SAVED = {};
beforeEach(() => {
  health.__resetDeps();
  health.__setDeps({ enforceRateLimit: async () => true, storage: { get: async () => null } });
  for (const k of ["CLERK_SECRET_KEY", "DATABASE_URL", "ANTHROPIC_API_KEY"]) {
    SAVED[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("a working deployment answers 200", async () => {
  const { req, res } = call();
  await health(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.checks.storage, true);
});

test("a store that does not answer is a 503, not a cheerful 200", async () => {
  // A monitor pointed at a 200 that says "ok: false" is a monitor nobody
  // notices.
  health.__setDeps({ storage: { get: async () => { throw new Error("kv down"); } } });
  const { req, res } = call();
  await health(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.checks.storage, false);
});

test("it reports whether things are configured, never what they are", async () => {
  process.env.CLERK_SECRET_KEY = "sk_test_secret_value";
  process.env.DATABASE_URL = "postgres://user:password@host/db";
  const { req, res } = call();
  await health(req, res);

  assert.deepEqual(res.body.checks, {
    storage: true,
    clerkConfigured: true,
    databaseConfigured: true,
    aiConfigured: false,
  });

  const serialised = JSON.stringify(res.body);
  assert.ok(!serialised.includes("sk_test_secret_value"), "a public route must never echo a secret");
  assert.ok(!serialised.includes("postgres://"), "nor a connection string");
  assert.ok(!serialised.includes("host"), "nor a hostname");
});

test("every answer carries a reference the caller can quote", async () => {
  const { req, res } = call();
  await health(req, res);
  assert.ok(res.body.reference, "a support message saying 'reference 8f2c1a' is worth an hour of guessing");
  assert.equal(res.headers["x-request-id"], res.body.reference);
});

test("it is rate-limited like every other open route", async () => {
  let asked = false;
  health.__setDeps({
    enforceRateLimit: async (_req, res) => { asked = true; res.status(429).json({ error: "rate_limited" }); return false; },
    storage: { get: async () => { throw new Error("must not be reached"); } },
  });
  const { req, res } = call();
  await health(req, res);
  assert.equal(asked, true);
  assert.equal(res.statusCode, 429);
});
