"use strict";

// UBO-1: where the tenant on a UBO investigation comes from.
//
// Before this, the route read tenantId straight from the request body and
// defaulted a caller who sent none to "nium" - so anyone could file research
// under any company's audit trail, including ours.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const routeAuth = require("../../lib/routeAuth");
const discovery = require("../ubo-discovery");

function fakeReqRes(body = {}, headers = {}) {
  const req = { method: "POST", body, headers, query: {}, url: "/api/ubo-discovery" };
  const res = {
    statusCode: null, body: null, headers: {}, chunks: [],
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    write(c) { this.chunks.push(c); return true; },
    end() { return this; },
  };
  return { req, res };
}

const VALID = { entityName: "Acme Ltd", jurisdiction: "GB" };

// Never touch the real store: a cached result from one test otherwise answers
// the next one, and the suite quietly stops testing what it claims to.
const NO_STORE = {
  getFresh: async () => null,
  cacheResult: async () => null,
  appendAudit: async () => ({ id: "audit-test" }),
  persistUboInvestigation: async () => ({ persisted: false }),
};

beforeEach(() => {
  discovery.__resetDeps();
  routeAuth.__resetDeps();
  discovery.__setDeps(NO_STORE);
});

test("the tenant comes from the caller, not the body", async () => {
  let seenTenant = "unset";
  discovery.__setDeps({
    requireStaff: async () => ({ kind: "staff", userId: "user_1", tenantId: "acme", role: "analyst" }),
    enforceRateLimit: async () => true,
    runUboFramework: async (input) => { seenTenant = input.tenantConfig.tenantId; return { ownershipGraph: null }; },
  });
  const { req, res } = fakeReqRes({ ...VALID, tenantId: "victim-corp" });
  await discovery(req, res);
  assert.equal(seenTenant, "acme", "a tenant named in the body must be ignored entirely");
});

test("a caller who names no tenant is refused, never defaulted", async () => {
  // The platform rule everywhere else: no tenant resolved means the request is
  // refused. This route used to answer "nium" instead.
  discovery.__setDeps({
    requireStaff: async () => ({ kind: "staff", userId: "user_1", tenantId: null, role: "owner" }),
    enforceRateLimit: async () => true,
    runUboFramework: async () => { throw new Error("must not run"); },
  });
  const { req, res } = fakeReqRes(VALID);
  await discovery(req, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "tenant_required" });
});

test("nothing is spent before the caller is known", async () => {
  let ran = false;
  discovery.__setDeps({
    requireStaff: async (_req, res) => { res.status(401).json({ error: "unauthorized" }); return null; },
    enforceRateLimit: async () => true,
    runUboFramework: async () => { ran = true; return {}; },
  });
  const { req, res } = fakeReqRes(VALID);
  await discovery(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(ran, false, "the paid framework must not run for a refused caller");
});

test("with Clerk switched off the route still refuses an unidentified tenant", async () => {
  // Today requireStaff returns an "unauthenticated" actor when Clerk has no
  // key. That must not become a way back to the old default.
  discovery.__setDeps({
    requireStaff: async () => ({ kind: "unauthenticated", userId: null, tenantId: null, role: null }),
    enforceRateLimit: async () => true,
    runUboFramework: async () => { throw new Error("must not run"); },
  });
  const { req, res } = fakeReqRes({ ...VALID, tenantId: "nium" });
  await discovery(req, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "tenant_required" });
});

test("the local lab keeps working through an explicit opt-in, not a default", async () => {
  // public/ubo-lab.html posts no tenant. With Clerk off, one configured
  // variable keeps it usable; without the variable the request is still
  // refused, so a production deployment that forgets Clerk does not quietly
  // fall back to someone's tenant.
  process.env.UBO_DEV_TENANT_ID = "local-lab";
  let seenTenant = null;
  discovery.__setDeps({
    requireStaff: async () => ({ kind: "unauthenticated", userId: null, tenantId: null, role: null }),
    enforceRateLimit: async () => true,
    runUboFramework: async (input) => { seenTenant = input.tenantConfig.tenantId; return { ownershipGraph: null }; },
  });
  const { req, res } = fakeReqRes(VALID);
  await discovery(req, res);
  assert.equal(seenTenant, "local-lab");
  delete process.env.UBO_DEV_TENANT_ID;
});

test("a signed-in caller cannot be overridden by the dev variable", async () => {
  process.env.UBO_DEV_TENANT_ID = "local-lab";
  let seenTenant = null;
  discovery.__setDeps({
    requireStaff: async () => ({ kind: "staff", userId: "user_1", tenantId: "acme", role: "analyst" }),
    enforceRateLimit: async () => true,
    runUboFramework: async (input) => { seenTenant = input.tenantConfig.tenantId; return {}; },
  });
  const { req, res } = fakeReqRes(VALID);
  await discovery(req, res);
  assert.equal(seenTenant, "acme");
  delete process.env.UBO_DEV_TENANT_ID;
});

// UBO-44: a trial's paid AI step is counted where the AI call starts - never
// for a request that is refused, or answered from the cache.
function counting() {
  const counted = [];
  discovery.__setDeps({
    enforceRateLimit: async () => true,
    demoAllowance: { record: async () => {} },
    trials: { countPaidStep: async (actor) => { counted.push(actor.userId); } },
    runUboFramework: async () => ({ status: "COMPLETE", entities: [] }),
  });
  return counted;
}

test("a request refused for want of a workspace uses no trial step", async () => {
  const counted = counting();
  discovery.__setDeps({ requireStaff: async () => ({ kind: "staff", userId: "user_owner", role: "owner", tenantId: null }) });
  const { req, res } = fakeReqRes(VALID);
  await discovery(req, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(counted, []);
});

test("a cached result uses no trial step; a live run uses exactly one", async () => {
  const counted = counting();
  discovery.__setDeps({ requireStaff: async () => ({ kind: "staff", userId: "user_1", role: "analyst", tenantId: "trial-acme-1a2b3c4d" }) });
  discovery.__setDeps({ getFresh: async () => ({ result: { status: "COMPLETE" }, cachedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-10-02T00:00:00.000Z" }) });
  await discovery(fakeReqRes(VALID).req, fakeReqRes(VALID).res);
  assert.deepEqual(counted, [], "the cache spent nothing");
  discovery.__setDeps({ getFresh: async () => null });
  const live = fakeReqRes(VALID);
  await discovery(live.req, live.res);
  assert.deepEqual(counted, ["user_1"]);
});

// Review, 2026-10-09: the step is taken and checked at the call; a refused one
// stops the run before Companies House or Anthropic is reached.
test("a run whose trial step is refused at the call makes no provider call and says why", async () => {
  let ran = 0;
  let demoRuns = 0;
  discovery.__setDeps({
    enforceRateLimit: async () => true,
    requireStaff: async () => ({ kind: "staff", userId: "user_1", tenantId: "acme" }),
    demoAllowance: { record: async () => { demoRuns += 1; } },
    trials: { countPaidStep: async () => ({ refused: "trial_budget_spent", budget: 10 }) },
    runUboFramework: async () => { ran += 1; return { status: "COMPLETE", entities: [] }; },
    getFresh: async () => null,
  });
  const { req, res } = fakeReqRes({ ...VALID, forceRefresh: true });
  await discovery(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(ran, 0);
  assert.equal(demoRuns, 0, "a refused run does not use a demo run either");
});
