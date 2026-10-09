"use strict";

// Row 15 - the tests that attack rather than check.
//
// Every other suite asks "does this work". This one asks "what happens when
// somebody tries". Each test below is written from the attacker's side: what
// they would send, and what must come back.
//
// Three of these were written after finding the defect, not before. That is
// worth saying out loud, because it is the argument for the suite existing:
// until this file, an expired trial could research forever, a trial's research
// budget was never counted, and the daily spend ceiling did not apply to trial
// users at all - the exact people it was built for.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const rateLimit = require("../../lib/rateLimit");
const routeAuth = require("../../lib/routeAuth");
const discovery = require("../ubo-discovery");
const invite = require("../ubo-invite");
const people = require("../ubo-people");

function reqRes({ method = "POST", body = {}, headers = {}, query = {}, url = "/api/test" } = {}) {
  const req = { method, body, headers, query, url, socket: { remoteAddress: "10.0.0.1" } };
  const res = {
    statusCode: null, body: null, headers: {}, chunks: [],
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    write(c) { this.chunks.push(c); return true; },
    end(c) { if (c) this.chunks.push(c); return this; },
  };
  return { req, res };
}

/** An in-memory rate limiter wired to stand-ins, so an attack can be run
 *  end to end without touching a real store or a real Clerk. */
function armLimiter({ session = null, access = null, trial = { inTrial: false }, spend = {} } = {}) {
  const recorded = { spendCap: [], trialSpend: [] };
  rateLimit.__setDeps({
    storage: require("../../lib/storage").createMemoryStore(),
    clerkAuth: {
      isConfigured: () => Boolean(session),
      verifyClerkSession: async () => (session ? { ok: true, ...session } : { ok: false }),
    },
    userAccess: { getAccess: async () => access, bootstrapOwners: () => [] },
    // The trial as lib/uboTrials.js#admitPaidStep would answer for it.
    trials: {
      admitPaidStep: async ({ userId, take }) => {
        if (trial.inTrial && trial.readOnly) return { refused: trial.overBudget ? "trial_budget_spent" : "trial_ended", budget: trial.budget };
        if (trial.inTrial && take) recorded.trialSpend.push(userId);
        return { refused: null };
      },
    },
    spendCap: {
      check: async (tenantId) => { recorded.spendCap.push(["check", tenantId]); return spend.blocked ? { blocked: true, limit: 100, message: "stop" } : { blocked: false }; },
      record: async (tenantId) => { recorded.spendCap.push(["record", tenantId]); },
    },
    resolveDossierActor: async () => null,
    now: () => Date.parse("2026-09-22T10:00:00.000Z"),
  });
  return recorded;
}

beforeEach(() => {
  discovery.__resetDeps();
  invite.__resetDeps();
  people.__resetDeps();
  routeAuth.__resetDeps();
});
afterEach(() => { rateLimit.__resetDeps && rateLimit.__resetDeps(); });

// ── taking somebody else's workspace ───────────────────────────────────────

test("a caller cannot file research under another company by naming it", async () => {
  // The oldest trick on this route, and the one UBO-1 was about.
  let seen = "unset";
  discovery.__setDeps({
    requireStaff: async () => ({ kind: "staff", userId: "user_attacker", tenantId: "trial-attacker-1", role: "analyst" }),
    enforceRateLimit: async () => true,
    getFresh: async () => null,
    cacheResult: async () => null,
    appendAudit: async () => ({ id: "a" }),
    persistUboInvestigation: async () => ({ persisted: false }),
    runUboFramework: async (input) => { seen = input.tenantConfig.tenantId; return { ownershipGraph: null }; },
  });
  const { req, res } = reqRes({ body: { entityName: "Acme Ltd", jurisdiction: "GB", tenantId: "trial-victim-9" } });
  await discovery(req, res);
  assert.equal(seen, "trial-attacker-1");
});

test("a caller cannot read another company's people by naming it", async () => {
  const asked = [];
  people.__setDeps({
    enforceRateLimit: async () => true,
    requireStaff: async () => ({ kind: "staff", userId: "user_admin", role: "admin", tenantId: "acme" }),
    userAccess: {
      listAccess: async (t) => { asked.push(t); return []; },
      listPending: async (t) => { asked.push(t); return []; },
    },
  });
  const { req, res } = reqRes({ method: "GET", query: { action: "list", tenantId: "rival" }, url: "/api/ubo-people" });
  await people(req, res);
  assert.deepEqual(asked, ["acme", "acme"], "a company named in the request is not a company you may read");
});

// ── privilege escalation ───────────────────────────────────────────────────

test("an analyst cannot mint themselves a trial invitation", async () => {
  // Creating invites is how somebody would help themselves to our AI budget.
  let created = false;
  invite.__setDeps({
    enforceRateLimit: async () => true,
    requireStaff: async (_req, res) => { res.status(403).json({ error: "forbidden" }); return null; },
    trials: { createInvite: async () => { created = true; return {}; } },
  });
  const { req, res } = reqRes({ body: { action: "create", company: "Free Money Ltd", seats: 500, budget: 100000 } });
  await invite(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(created, false);
});

test("an admin cannot promote themselves to owner through the people route", async () => {
  const written = [];
  people.__setDeps({
    enforceRateLimit: async () => true,
    requireStaff: async () => ({ kind: "staff", userId: "user_admin", role: "admin", tenantId: "acme" }),
    userAccess: {
      getAccess: async () => ({ userId: "user_admin", role: "admin", tenantId: "acme" }),
      grantAccess: async (a) => { written.push(a); return a; },
    },
  });
  const { req, res } = reqRes({ body: { action: "role", userId: "user_admin", role: "owner" }, url: "/api/ubo-people" });
  await people(req, res);
  // Two rules refuse this and the role check gets there first: an admin cannot
  // hand out "owner" to anybody, themselves included.
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "role_not_allowed");
  assert.deepEqual(written, []);

  // And the second rule, on its own: no self-changes even to a role they may
  // grant. This is the one that stops somebody locking themselves out.
  const self = reqRes({ body: { action: "role", userId: "user_admin", role: "analyst" }, url: "/api/ubo-people" });
  await people(self.req, self.res);
  assert.equal(self.res.statusCode, 400);
  assert.equal(self.res.body.error, "cannot_change_own_role");
  assert.deepEqual(written, []);
});

// ── spending money you no longer have ──────────────────────────────────────

test("a trial that has ended cannot start new research", async () => {
  // Found by writing this test: until now the end date was checked by a banner
  // on the screen and by nothing on the server.
  armLimiter({
    session: { userId: "user_1" },
    access: { tenantId: "trial-acme-1", role: "analyst" },
    trial: { inTrial: true, readOnly: true, overBudget: false, budget: 100 },
  });
  const { req, res } = reqRes({ headers: { authorization: "Bearer t" } });
  const allowed = await rateLimit.enforceRateLimit(req, res, "ubo-discovery");

  assert.equal(allowed, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "trial_ended");
  assert.match(res.body.message, /work is still here/, "an ended trial is a sales moment, not an error page");
});

test("a trial that has spent its research budget cannot spend more", async () => {
  armLimiter({
    session: { userId: "user_1" },
    access: { tenantId: "trial-acme-1", role: "analyst" },
    trial: { inTrial: true, readOnly: true, overBudget: true, budget: 100 },
  });
  const { req, res } = reqRes({ headers: { authorization: "Bearer t" } });
  assert.equal(await rateLimit.enforceRateLimit(req, res, "research"), false);
  assert.equal(res.body.error, "trial_budget_spent");
  assert.match(res.body.message, /all 100 paid AI steps/);
});

test("a live trial's research step is counted where it is spent, not at the door", async () => {
  // It was not being counted at all once: statusFor computed a budget nobody
  // ever decremented. Then it was counted here, before the request was checked,
  // so a refused request used a step too (UBO-44). The research route now
  // counts it where the AI call starts (api/__tests__/ubo-discovery-tenant.nodetest.js).
  const recorded = armLimiter({
    session: { userId: "user_1" },
    access: { tenantId: "trial-acme-1", role: "analyst" },
    trial: { inTrial: true, readOnly: false, budget: 100 },
  });
  const { req, res } = reqRes({ headers: { authorization: "Bearer t" } });
  assert.equal(await rateLimit.enforceRateLimit(req, res, "ubo-discovery"), true);
  assert.deepEqual(recorded.trialSpend, [], "the door does not count it");
  const other = reqRes({ headers: { authorization: "Bearer t" } });
  assert.equal(await rateLimit.enforceRateLimit(other.req, other.res, "research"), true);
  assert.deepEqual(recorded.trialSpend, ["user_1"], "a paid route that does not count for itself is still counted here");
});

test("a read does not burn a trial's research budget", async () => {
  const recorded = armLimiter({
    session: { userId: "user_1" },
    access: { tenantId: "trial-acme-1", role: "analyst" },
    trial: { inTrial: true, readOnly: false, budget: 100 },
  });
  const { req, res } = reqRes({ headers: { authorization: "Bearer t" } });
  await rateLimit.enforceRateLimit(req, res, "get-document");
  assert.deepEqual(recorded.trialSpend, [], "only the routes that spend money count against a budget");
});

test("the daily ceiling applies to trial users, whose workspace is ours not Clerk's", async () => {
  // The defect this test was written for: the caller's workspace came from
  // Clerk's organisation claim, and a trial user is in no Clerk organisation -
  // so the workspace was null and the whole spend cap was skipped for exactly
  // the people it was built to protect.
  const recorded = armLimiter({
    session: { userId: "user_1", orgId: null },
    access: { tenantId: "trial-acme-1", role: "analyst" },
    trial: { inTrial: true, readOnly: false, budget: 100 },
  });
  const { req, res } = reqRes({ headers: { authorization: "Bearer t" } });
  await rateLimit.enforceRateLimit(req, res, "ubo-discovery");
  assert.deepEqual(recorded.spendCap, [["check", "trial-acme-1"], ["record", "trial-acme-1"]]);
});

test("an account over its ceiling is refused before the provider is called", async () => {
  armLimiter({
    session: { userId: "user_1" },
    access: { tenantId: "acme", role: "analyst" },
    spend: { blocked: true },
  });
  const { req, res } = reqRes({ headers: { authorization: "Bearer t" } });
  assert.equal(await rateLimit.enforceRateLimit(req, res, "research"), false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, "spend_cap_reached");
});

// ── getting a fresh allowance ──────────────────────────────────────────────

test("a forged x-forwarded-for does not buy a new rate-limit allowance", async () => {
  // On a host that does not overwrite it, a caller who sends their own
  // x-forwarded-for gets a new bucket per request and no limit at all. The
  // platform's own header wins.
  armLimiter({});
  const first = await rateLimit.callerKey({
    headers: { "x-vercel-forwarded-for": "203.0.113.9", "x-forwarded-for": "1.1.1.1" },
    socket: { remoteAddress: "10.0.0.1" },
  });
  const second = await rateLimit.callerKey({
    headers: { "x-vercel-forwarded-for": "203.0.113.9", "x-forwarded-for": "2.2.2.2" },
    socket: { remoteAddress: "10.0.0.1" },
  });
  assert.equal(first.key, "ip:203.0.113.9");
  assert.equal(second.key, first.key, "two requests from one caller must share one allowance");
});

test("a signed-in person cannot escape their own bucket by changing address", async () => {
  armLimiter({ session: { userId: "user_1" }, access: { tenantId: "acme" } });
  const a = await rateLimit.callerKey({ headers: { authorization: "Bearer t", "x-forwarded-for": "1.1.1.1" } });
  const b = await rateLimit.callerKey({ headers: { authorization: "Bearer t", "x-forwarded-for": "2.2.2.2" } });
  assert.equal(a.key, "user:user_1");
  assert.equal(b.key, a.key);
});

// ── uploads ────────────────────────────────────────────────────────────────

test("an oversized ownership chart is refused, and a lying size header with it", () => {
  // The two shapes of the same attack: send something too big, or send
  // something small that claims to be big (or the reverse) so a size check
  // reads one number and the parser reads another.
  const { MAX_BYTES } = require("../../ubo-control-lab/server/customerOwnershipChartDemo.js");
  assert.ok(MAX_BYTES <= 5 * 1024 * 1024, "an ownership chart is a picture, not a video");

  const { validateUpload, MAX_UPLOAD_BYTES } = require("../../lib/uploadValidation");
  const oversized = validateUpload({ filename: "chart.png", mimetype: "image/png", size: MAX_UPLOAD_BYTES + 1 });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.status, 413);

  const wrongType = validateUpload({ filename: "chart.exe", mimetype: "application/x-msdownload", size: 1000 });
  assert.equal(wrongType.ok, false);

  // A dangerous extension hidden behind an accepted mimetype.
  const disguised = validateUpload({ filename: "chart.png.exe", mimetype: "image/png", size: 1000 });
  assert.equal(disguised.ok, false, "the name matters as well as the declared type");
});
