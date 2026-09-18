"use strict";

// Batch 0: routes that had no access check at all.
//
// Each test names the thing that was possible before. None of these routes has
// a caller inside the app except the metrics dashboard, which holds an admin
// token already - so locking them costs nothing and closes real exposure.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const routeAuth = require("../../lib/routeAuth");

function fakeReqRes({ method = "GET", query = {}, headers = {}, body = {} } = {}) {
  const req = { method, query, headers, body, url: "/api/x" };
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

const ADMIN = { authorization: "Bearer admin-secret" };

beforeEach(() => {
  routeAuth.__setDeps({ authorizeAdmin: async (tenant, token) => tenant === "nium" && token === "admin-secret" });
});

test("metrics: an anonymous caller can no longer read every tenant's activity", async () => {
  const metrics = require("../change-intelligence-metrics");
  const { req, res } = fakeReqRes({ query: { tenant: "nium" } });
  await metrics(req, res);
  assert.strictEqual(res.statusCode, 401);
});

test("metrics: a non-platform tenant's admin is refused while events carry no tenant", async () => {
  // The aggregate spans every tenant (change_events has no tenant column until
  // Batch 2), so only the platform operator may see it. A tenant admin reading
  // another tenant's numbers would be the same leak wearing a badge.
  routeAuth.__setDeps({ authorizeAdmin: async () => true });
  const metrics = require("../change-intelligence-metrics");
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, headers: ADMIN });
  await metrics(req, res);
  assert.strictEqual(res.statusCode, 403);
});

test("reviewer: identity data is no longer released to an anonymous caller", async () => {
  const reviewer = require("../idv-match/reviewer");
  const { req, res } = fakeReqRes({ query: { tenant: "nium", attemptId: "a1" } });
  await reviewer(req, res);
  assert.strictEqual(res.statusCode, 401);
});

test("reviewer: a reveal can no longer name its own actor in the URL", async () => {
  // Before: ?actorId=whoever went straight into the vault's audit record, so the
  // audit trail recorded whatever the caller typed.
  const reviewer = require("../idv-match/reviewer");
  const { req, res } = fakeReqRes({
    method: "POST",
    query: { tenant: "nium" },
    body: { reveal: true, attemptId: "a1", concept: "first_name", actorId: "pretend-to-be-someone" },
  });
  await reviewer(req, res);
  assert.strictEqual(res.statusCode, 401);
});

test("paid Nium lookups refuse an anonymous caller before spending anything", async () => {
  for (const route of ["../nium/exhaustive-details", "../nium/public-details", "../nium/constants"]) {
    const handler = require(route);
    const { req, res } = fakeReqRes({ method: "POST", query: { tenant: "nium" }, body: { entityId: "x" } });
    await handler(req, res);
    assert.strictEqual(res.statusCode, 401, `${route} must refuse an anonymous caller`);
  }
});

test("internal tools refuse an anonymous caller", async () => {
  for (const route of ["../ubo-control-lab", "../ubo-recalculate", "../dossier-reseed"]) {
    const handler = require(route);
    const { req, res } = fakeReqRes({ method: "POST", query: { tenant: "nium" }, body: {} });
    await handler(req, res);
    assert.strictEqual(res.statusCode, 401, `${route} must refuse an anonymous caller`);
  }
});

test("an allow-listed admin still gets through", async () => {
  process.env.ADMIN_ROUTE_TEST = "1";
  const metrics = require("../change-intelligence-metrics");
  const { req, res } = fakeReqRes({ query: { tenant: "nium" }, headers: ADMIN });
  await metrics(req, res);
  assert.notStrictEqual(res.statusCode, 401);
  assert.notStrictEqual(res.statusCode, 403);
  delete process.env.ADMIN_ROUTE_TEST;
});
