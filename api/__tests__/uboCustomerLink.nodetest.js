"use strict";

// /api/ubo-customer-link: analysts make and withdraw a customer's link; the
// customer opens it. The tests that matter are the refusals - a link opened by
// the wrong person, a link made for someone else's case.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const route = require("../ubo-customer-link");
const customerLink = require("../../lib/uboCustomerLink");

function fakeRes() {
  return {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader() { return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

const ANALYST = { kind: "staff", userId: "user_analyst", tenantId: "trial-acme-1a2b3c4d", role: "analyst" };
let saved;
const { createMemoryStore } = require("../../lib/storage");
let store;
beforeEach(() => {
  saved = { secret: process.env.SESSION_SECRET, vercel: process.env.VERCEL };
  process.env.SESSION_SECRET = "customer-link-route-test-secret";
  delete process.env.VERCEL;
  store = createMemoryStore();
  customerLink.__setDeps({ storage: store });
});
afterEach(() => {
  for (const [key, name] of [["secret", "SESSION_SECRET"], ["vercel", "VERCEL"]]) {
    if (saved[key] === undefined) delete process.env[name]; else process.env[name] = saved[key];
  }
});

function handler({ staff = ANALYST, cases = { "trial-acme-1a2b3c4d": ["case-1"] }, clerk = null } = {}) {
  return route.createHandler({
    applyCors: () => false,
    enforceRateLimit: async () => true,
    requireStaff: async (req, res) => { if (!staff) { res.status(401).json({ error: "unauthorized" }); return null; } return staff; },
    caseExists: async (tenantId, caseId) => (cases[tenantId] || []).includes(caseId),
    clerk: clerk || { isConfigured: () => false },
  });
}

async function call(h, body, headers = {}) {
  const res = fakeRes();
  await h({ method: "POST", headers, body }, res);
  return res;
}

test("an analyst makes a link for a case in their own workspace", async () => {
  const res = await call(handler(), { action: "create", caseId: "case-1", email: "customer@example.test" });
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.token);
  const { payload } = await customerLink.verifyLink(res.body.token);
  assert.strictEqual(payload.tenantId, ANALYST.tenantId, "the workspace comes from the analyst, never the request");
});

test("no link for a case outside the analyst's workspace", async () => {
  const res = await call(handler(), { action: "create", caseId: "someone-elses-case", email: "customer@example.test" });
  assert.strictEqual(res.statusCode, 404);
});

test("a caller who is not signed in cannot make or withdraw links", async () => {
  const h = handler({ staff: null });
  assert.strictEqual((await call(h, { action: "create", caseId: "case-1", email: "c@example.test" })).statusCode, 401);
  assert.strictEqual((await call(h, { action: "revoke", caseId: "case-1" })).statusCode, 401);
});

test("a customer session cannot make links", async () => {
  // Making links is the analyst's; a customer would mint keys to their case for anyone.
  const { session } = customerLink.mintCustomerSession({ caseId: "case-1", tenantId: ANALYST.tenantId });
  const res = await call(handler(), { action: "create", caseId: "case-1", email: "friend@example.test" }, { "x-ubo-customer-session": session });
  assert.strictEqual(res.statusCode, 403);
});

test("a link needs a real email address", async () => {
  const res = await call(handler(), { action: "create", caseId: "case-1", email: "not-an-address" });
  assert.strictEqual(res.statusCode, 400);
});

function signedInAs(email) {
  return { isConfigured: () => true, verifyClerkSession: async () => ({ ok: true, userId: "user_customer" }), verifiedEmailFor: async () => email };
}

test("the person the link was made for opens it and gets a session for that one case", async () => {
  const { token } = await customerLink.mintLink({ caseId: "case-1", tenantId: ANALYST.tenantId, email: "customer@example.test" });
  const res = await call(handler({ clerk: signedInAs("Customer@Example.test") }), { action: "open", link: token });
  assert.strictEqual(res.statusCode, 200);
  const { payload } = await customerLink.verifyCustomerSession(res.body.session);
  assert.deepStrictEqual({ caseId: payload.caseId, tenantId: payload.tenantId }, { caseId: "case-1", tenantId: ANALYST.tenantId });
});

test("a forwarded link opened by someone else is refused", async () => {
  const { token } = await customerLink.mintLink({ caseId: "case-1", tenantId: ANALYST.tenantId, email: "customer@example.test" });
  const res = await call(handler({ clerk: signedInAs("colleague@example.test") }), { action: "open", link: token });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.error, "wrong_recipient");
  assert.strictEqual(res.body.session, undefined);
});

test("opening needs a signed-in person when sign-in is on", async () => {
  const { token } = await customerLink.mintLink({ caseId: "case-1", tenantId: ANALYST.tenantId, email: "customer@example.test" });
  const clerk = { isConfigured: () => true, verifyClerkSession: async () => ({ ok: false }), verifiedEmailFor: async () => null };
  assert.strictEqual((await call(handler({ clerk }), { action: "open", link: token })).statusCode, 401);
});

test("a hosted deployment with sign-in off opens nothing", async () => {
  // Nobody could prove who they are, so the link alone would be the key.
  process.env.VERCEL = "1";
  const { token } = await customerLink.mintLink({ caseId: "case-1", tenantId: ANALYST.tenantId, email: "customer@example.test" });
  assert.strictEqual((await call(handler(), { action: "open", link: token })).statusCode, 503);
});

test("local development with sign-in off opens with the link alone", async () => {
  const { token } = await customerLink.mintLink({ caseId: "case-1", tenantId: ANALYST.tenantId, email: "customer@example.test" });
  assert.strictEqual((await call(handler(), { action: "open", link: token })).statusCode, 200);
});

test("a withdrawn link no longer opens", async () => {
  const h = handler({ clerk: signedInAs("customer@example.test") });
  const { token } = (await call(h, { action: "create", caseId: "case-1", email: "customer@example.test" })).body;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.strictEqual((await call(h, { action: "revoke", caseId: "case-1" })).statusCode, 200);
  const res = await call(h, { action: "open", link: token });
  assert.strictEqual(res.statusCode, 401);
});

test("a forged link is refused", async () => {
  const res = await call(handler({ clerk: signedInAs("customer@example.test") }), { action: "open", link: "forged.link" });
  assert.strictEqual(res.statusCode, 401);
});

// Her customer screens move between pages with full page loads, and the
// session must not sit in browser storage. So opening also sets an HttpOnly
// cookie - unreadable by scripts, sent only to this route - and each page asks
// "resume" for the session again. Every other route still needs the header.
function cookieFrom(res) {
  return String(res.headers?.["set-cookie"] || "");
}
function withHeaders() {
  const res = fakeRes();
  res.headers = {};
  res.setHeader = function set(name, value) { this.headers[String(name).toLowerCase()] = value; return this; };
  return res;
}

test("opening a link sets an HttpOnly cookie that only this route receives", async () => {
  const { token } = await customerLink.mintLink({ caseId: "case-1", tenantId: ANALYST.tenantId, email: "customer@example.test" });
  const res = withHeaders();
  await handler({ clerk: signedInAs("customer@example.test") })({ method: "POST", headers: {}, body: { action: "open", link: token } }, res);
  const cookie = cookieFrom(res);
  assert.match(cookie, /^ubo_customer_session=[^;]+;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api\/ubo-customer-link/);
  assert.match(cookie, /Max-Age=28800/);
});

test("after a page load, resume gives the session back from the cookie", async () => {
  const { session } = customerLink.mintCustomerSession({ caseId: "case-1", tenantId: ANALYST.tenantId });
  const res = await call(handler(), { action: "resume" }, { cookie: `other=1; ubo_customer_session=${session}` });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.session, session);
  assert.strictEqual(res.body.caseId, "case-1");
});

test("resume without a valid session cookie answers that there is none", async () => {
  assert.strictEqual((await call(handler(), { action: "resume" })).statusCode, 401);
  assert.strictEqual((await call(handler(), { action: "resume" }, { cookie: "ubo_customer_session=forged.token" })).statusCode, 401);
});

test("leaving clears the cookie", async () => {
  const res = withHeaders();
  await handler()({ method: "POST", headers: {}, body: { action: "leave" } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.match(cookieFrom(res), /^ubo_customer_session=;.*Max-Age=0/);
});


// Review fixes.
function clerkAs(userId, email) {
  return { isConfigured: () => true, verifyClerkSession: async () => (userId ? { ok: true, userId } : { ok: false }), verifiedEmailFor: async () => email };
}

test("the session is bound to the person who opened the link, and only they can resume it", async () => {
  const { token } = await customerLink.mintLink({ caseId: "case-1", tenantId: ANALYST.tenantId, email: "customer@example.test" });
  const opened = await call(handler({ clerk: clerkAs("user_customer", "customer@example.test") }), { action: "open", link: token });
  assert.strictEqual((await customerLink.verifyCustomerSession(opened.body.session)).payload.sub, "user_customer");
  const cookie = { cookie: `ubo_customer_session=${opened.body.session}` };
  assert.strictEqual((await call(handler({ clerk: clerkAs("user_next_person", "next@example.test") }), { action: "resume" }, cookie)).statusCode, 401);
  assert.strictEqual((await call(handler({ clerk: clerkAs(null, null) }), { action: "resume" }, cookie)).statusCode, 401);
  assert.strictEqual((await call(handler({ clerk: clerkAs("user_customer", "customer@example.test") }), { action: "resume" }, cookie)).statusCode, 200);
});

test("a link to a case that no longer exists does not open", async () => {
  const { token } = await customerLink.mintLink({ caseId: "deleted-case", tenantId: ANALYST.tenantId, email: "customer@example.test" });
  const res = await call(handler({ clerk: clerkAs("user_customer", "customer@example.test") }), { action: "open", link: token });
  assert.strictEqual(res.statusCode, 404);
});

test("without shared storage on a hosted deployment, links are neither made nor withdrawn", async () => {
  // A withdrawal written to one server's local disk is invisible to the others.
  process.env.VERCEL = "1";
  const h = route.createHandler({
    applyCors: () => false, enforceRateLimit: async () => true,
    requireStaff: async () => ANALYST, caseExists: async () => true,
    clerk: clerkAs("user_customer", "customer@example.test"), storageBackend: () => "filesystem",
  });
  assert.strictEqual((await call(h, { action: "create", caseId: "case-1", email: "customer@example.test" })).statusCode, 503);
  assert.strictEqual((await call(h, { action: "revoke", caseId: "case-1" })).statusCode, 503);
});

test("a production build never opens a link on the link alone, wherever it runs", async () => {
  const savedEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const { token } = await customerLink.mintLink({ caseId: "case-1", tenantId: ANALYST.tenantId, email: "customer@example.test" });
    assert.strictEqual((await call(handler(), { action: "open", link: token })).statusCode, 503);
  } finally {
    process.env.NODE_ENV = savedEnv;
  }
});

test("the cookie is Secure on any HTTPS request", async () => {
  const { token } = await customerLink.mintLink({ caseId: "case-1", tenantId: ANALYST.tenantId, email: "customer@example.test" });
  const res = withHeaders();
  await handler({ clerk: clerkAs("user_customer", "customer@example.test") })({ method: "POST", headers: { "x-forwarded-proto": "https" }, body: { action: "open", link: token } }, res);
  assert.match(cookieFrom(res), /; Secure/);
});

test("an owner's link is made in the workspace they are working in", async () => {
  const h = handler({ staff: { kind: "unauthenticated", tenantId: null, role: null } });
  const saved = process.env.UBO_DEV_TENANT_ID;
  process.env.UBO_DEV_TENANT_ID = ANALYST.tenantId;
  try {
    assert.strictEqual((await call(h, { action: "create", caseId: "case-1", email: "customer@example.test" })).statusCode, 200);
  } finally {
    if (saved === undefined) delete process.env.UBO_DEV_TENANT_ID; else process.env.UBO_DEV_TENANT_ID = saved;
  }
});

// UBO-57: a link made or withdrawn is on the case's audit ledger - by the
// analyst, in their workspace - without the customer's email in it.
test("making and withdrawing a link is recorded on the case's ledger, without the email", async () => {
  const recorded = [];
  const h = route.createHandler({
    applyCors: () => false,
    enforceRateLimit: async () => true,
    requireStaff: async () => ANALYST,
    caseExists: async () => true,
    recordLinkEvent: async (tenantId, event) => { recorded.push({ tenantId, ...event }); },
    clerk: { isConfigured: () => false },
  });
  assert.strictEqual((await call(h, { action: "create", caseId: "case-1", email: "customer@example.test" })).statusCode, 200);
  assert.strictEqual((await call(h, { action: "revoke", caseId: "case-1" })).statusCode, 200);
  assert.deepStrictEqual(recorded.map(({ tenantId, caseId, eventType, actor }) => [tenantId, caseId, eventType, actor.type, actor.id]), [
    [ANALYST.tenantId, "case-1", "CUSTOMER_LINK_ISSUED", "ANALYST", "user_analyst"],
    [ANALYST.tenantId, "case-1", "CUSTOMER_LINK_REVOKED", "ANALYST", "user_analyst"],
  ]);
  assert.ok(!JSON.stringify(recorded).includes("customer@example.test"));
});

// Review, 2026-10-09: the panel says a new link replaces the old one; it did
// not, and the ledger then said "no link out" while the first still worked.
test("a new link withdraws the earlier one, on the ledger as a withdrawal", async () => {
  const recorded = [];
  const h = route.createHandler({
    applyCors: () => false,
    enforceRateLimit: async () => true,
    requireStaff: async () => ANALYST,
    caseExists: async () => true,
    recordLinkEvent: async (tenantId, event) => { recorded.push(event.eventType); },
    clerk: signedInAs("customer@example.test"),
  });
  const first = (await call(h, { action: "create", caseId: "case-1", email: "customer@example.test" })).body;
  const opened = (await call(h, { action: "open", link: first.token })).body;
  const second = (await call(h, { action: "create", caseId: "case-1", email: "customer@example.test" })).body;
  assert.strictEqual(second.replaced, true);
  assert.strictEqual((await call(h, { action: "open", link: first.token })).statusCode, 401, "the earlier link is dead");
  assert.strictEqual((await customerLink.verifyCustomerSession(opened.session)).valid, false, "and the session opened from it");
  assert.strictEqual((await call(h, { action: "open", link: second.token })).statusCode, 200);
  assert.deepStrictEqual(recorded, ["CUSTOMER_LINK_ISSUED", "CUSTOMER_LINK_REVOKED", "CUSTOMER_LINK_ISSUED"]);
});

test("an ended trial makes no new links, but can still withdraw one", async () => {
  const asked = [];
  const h = route.createHandler({
    applyCors: () => false,
    enforceRateLimit: async () => true,
    requireStaff: async () => ANALYST,
    caseExists: async () => true,
    trialEnded: async (actor) => { asked.push(actor); return true; },
    clerk: { isConfigured: () => false },
  });
  const made = await call(h, { action: "create", caseId: "case-1", email: "customer@example.test" });
  assert.strictEqual(made.statusCode, 403);
  assert.strictEqual(made.body.error, "trial_ended");
  assert.strictEqual(made.body.token, undefined);
  assert.strictEqual(asked[0].userId, ANALYST.userId);
  assert.strictEqual((await call(h, { action: "revoke", caseId: "case-1" })).statusCode, 200);
});

test("a link made straight after a withdrawal opens", async () => {
  const h = handler({ clerk: signedInAs("customer@example.test") });
  await call(h, { action: "revoke", caseId: "case-1" });
  const { token } = (await call(h, { action: "create", caseId: "case-1", email: "customer@example.test" })).body;
  assert.strictEqual((await call(h, { action: "open", link: token })).statusCode, 200);
});

test("a link the ledger could not record is not handed out", async () => {
  const h = route.createHandler({
    applyCors: () => false,
    enforceRateLimit: async () => true,
    requireStaff: async () => ANALYST,
    caseExists: async () => true,
    recordLinkEvent: async () => { throw new Error("db down"); },
    clerk: { isConfigured: () => false },
  });
  const res = await call(h, { action: "create", caseId: "case-1", email: "customer@example.test" });
  assert.strictEqual(res.statusCode, 500);
  assert.strictEqual(res.body.token, undefined);
});
