"use strict";

// Managing people. The tests that matter are the refusals: "make me an owner"
// is the most valuable request anyone can send this product, and an admin who
// can reach another company's list has broken the only wall between customers.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const people = require("../ubo-people");

function call({ method = "POST", body = {}, query = {} } = {}) {
  const req = { method, body, query, headers: { authorization: "Bearer t" }, url: "/api/ubo-people" };
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

const OWNER = { kind: "staff", userId: "user_owner", role: "owner", tenantId: null };
const ADMIN = { kind: "staff", userId: "user_admin", role: "admin", tenantId: "acme" };

/** A stand-in access list that records what it was asked to do. */
function fakeAccess(overrides = {}) {
  return {
    calls: [],
    listAccess: async function (t) { this.calls.push(["listAccess", t]); return []; },
    listPending: async function (t) { this.calls.push(["listPending", t]); return []; },
    inviteByEmail: async function (args) { this.calls.push(["inviteByEmail", args]); return args; },
    grantAccess: async function (args) { this.calls.push(["grantAccess", args]); return args; },
    revokeAccess: async function (id) { this.calls.push(["revokeAccess", id]); return true; },
    cancelInvite: async function (e) { this.calls.push(["cancelInvite", e]); return true; },
    getAccess: async () => null,
    ...overrides,
  };
}

beforeEach(() => {
  people.__resetDeps();
  people.__setDeps({ enforceRateLimit: async () => true });
});

test("an analyst never reaches this route", async () => {
  people.__setDeps({
    requireStaff: async (_req, res) => { res.status(403).json({ error: "forbidden" }); return null; },
    userAccess: fakeAccess({ listAccess: async () => { throw new Error("must not be reached"); } }),
  });
  const { req, res } = call({ method: "GET", query: { action: "list" } });
  await people(req, res);
  assert.equal(res.statusCode, 403);
});

test("an admin sees their own company and nobody else's", async () => {
  const access = fakeAccess();
  people.__setDeps({ requireStaff: async () => ADMIN, userAccess: access });
  const { req, res } = call({ method: "GET", query: { action: "list" } });
  await people(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(access.calls[0], ["listAccess", "acme"], "the filter is in the query, not in the browser");
  assert.deepEqual(access.calls[1], ["listPending", "acme"]);
});

test("an owner sees everyone", async () => {
  const access = fakeAccess();
  people.__setDeps({ requireStaff: async () => OWNER, userAccess: access });
  const { req, res } = call({ method: "GET", query: { action: "list" } });
  await people(req, res);
  assert.deepEqual(access.calls[0], ["listAccess", null]);
});

test("an admin cannot make anybody an owner", async () => {
  // The single most valuable request in the product.
  const access = fakeAccess();
  people.__setDeps({ requireStaff: async () => ADMIN, userAccess: access });
  const { req, res } = call({ body: { action: "invite", email: "new@acme.test", role: "owner" } });
  await people(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "role_not_allowed");
  assert.equal(access.calls.length, 0, "refused before anything is stored");
});

test("an admin cannot invite somebody into another company", async () => {
  const access = fakeAccess();
  people.__setDeps({ requireStaff: async () => ADMIN, userAccess: access });
  const { req, res } = call({ body: { action: "invite", email: "spy@other.test", role: "analyst", tenantId: "rival" } });
  await people(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(access.calls.length, 0);
});

test("an admin's invitation lands in their own company, whatever the request says", async () => {
  const access = fakeAccess();
  people.__setDeps({ requireStaff: async () => ADMIN, userAccess: access });
  const { req, res } = call({ body: { action: "invite", email: "new@acme.test", role: "analyst" } });
  await people(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(access.calls[0][1].tenantId, "acme");
  assert.equal(access.calls[0][1].addedBy, "user_admin", "every invitation records who sent it");
});

test("an owner names the company an invitation is for", async () => {
  const access = fakeAccess();
  people.__setDeps({ requireStaff: async () => OWNER, userAccess: access });
  const { req, res } = call({ body: { action: "invite", email: "boss@rival.test", role: "admin", tenantId: "rival" } });
  await people(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(access.calls[0][1].tenantId, "rival");
});

test("an invitation to nobody is refused", async () => {
  const access = fakeAccess();
  people.__setDeps({ requireStaff: async () => OWNER, userAccess: access });
  const { req, res } = call({ body: { action: "invite", role: "analyst", tenantId: "acme" } });
  await people(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(access.calls.length, 0);
});

test("an admin cannot change somebody in another company", async () => {
  const access = fakeAccess({ getAccess: async () => ({ userId: "user_x", role: "analyst", tenantId: "rival" }) });
  people.__setDeps({ requireStaff: async () => ADMIN, userAccess: access });
  const { req, res } = call({ body: { action: "role", userId: "user_x", role: "admin" } });
  await people(req, res);
  assert.equal(res.statusCode, 403);
  assert.ok(!access.calls.some((c) => c[0] === "grantAccess"), "nothing is written on a refusal");
});

test("an admin cannot demote an owner", async () => {
  // An owner belongs to no company, so nothing an admin runs should reach one.
  const access = fakeAccess({ getAccess: async () => ({ userId: "user_owner", role: "owner", tenantId: null }) });
  people.__setDeps({ requireStaff: async () => ADMIN, userAccess: access });
  const { req, res } = call({ body: { action: "role", userId: "user_owner", role: "analyst" } });
  await people(req, res);
  assert.equal(res.statusCode, 403);
});

test("nobody changes their own role", async () => {
  // How somebody locks themselves out of this screen by accident. An admin has
  // no way back in.
  const access = fakeAccess();
  people.__setDeps({ requireStaff: async () => ADMIN, userAccess: access });
  const { req, res } = call({ body: { action: "role", userId: "user_admin", role: "analyst" } });
  await people(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "cannot_change_own_role");
});

test("nobody removes themselves", async () => {
  const access = fakeAccess();
  people.__setDeps({ requireStaff: async () => OWNER, userAccess: access });
  const { req, res } = call({ body: { action: "remove", userId: "user_owner" } });
  await people(req, res);
  assert.equal(res.statusCode, 400);
  assert.ok(!access.calls.some((c) => c[0] === "revokeAccess"));
});

test("an admin removes somebody from their own company", async () => {
  const access = fakeAccess({ getAccess: async () => ({ userId: "user_x", role: "analyst", tenantId: "acme", source: "stored" }) });
  people.__setDeps({ requireStaff: async () => ADMIN, userAccess: access });
  const { req, res } = call({ body: { action: "remove", userId: "user_x" } });
  await people(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(access.calls.find((c) => c[0] === "revokeAccess"), ["revokeAccess", "user_x"]);
});

test("removing an owner set in the configuration says so rather than lying", async () => {
  // PLATFORM_OWNER_CLERK_IDS wins over anything stored, so deleting the row
  // changes nothing - and a screen that showed "removed" would be showing a
  // fiction as fact.
  const access = fakeAccess({ getAccess: async () => ({ userId: "user_boot", role: "owner", tenantId: null, source: "bootstrap" }) });
  people.__setDeps({ requireStaff: async () => OWNER, userAccess: access });
  const { req, res } = call({ body: { action: "remove", userId: "user_boot" } });
  await people(req, res);
  assert.equal(res.statusCode, 409);
  assert.ok(!access.calls.some((c) => c[0] === "revokeAccess"));
});

test("an admin cannot withdraw another company's invitation", async () => {
  const access = fakeAccess({ listPending: async () => [] });
  people.__setDeps({ requireStaff: async () => ADMIN, userAccess: access });
  const { req, res } = call({ body: { action: "cancel", email: "someone@rival.test" } });
  await people(req, res);
  assert.equal(res.statusCode, 404, "invisible and absent look the same, so one company cannot probe another's list");
  assert.ok(!access.calls.some((c) => c[0] === "cancelInvite"));
});

test("an admin withdraws an invitation to their own company", async () => {
  const access = fakeAccess({ listPending: async () => [{ email: "new@acme.test", tenantId: "acme", role: "analyst" }] });
  people.__setDeps({ requireStaff: async () => ADMIN, userAccess: access });
  const { req, res } = call({ body: { action: "cancel", email: "New@Acme.test " } });
  await people(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(access.calls.find((c) => c[0] === "cancelInvite"), ["cancelInvite", "new@acme.test"]);
});

test("an admin with no company is refused rather than shown everything", async () => {
  // The list functions read "no company" as "every company". An admin who
  // somehow has none must never reach them.
  const access = fakeAccess({ listAccess: async () => { throw new Error("must not be reached"); } });
  people.__setDeps({
    requireStaff: async () => ({ kind: "staff", userId: "user_stray", role: "admin", tenantId: null }),
    userAccess: access,
  });
  const { req, res } = call({ method: "GET", query: { action: "list" } });
  await people(req, res);
  assert.equal(res.statusCode, 403);
});

test("the rate limiter answers before the access list is touched", async () => {
  const access = fakeAccess({ listAccess: async () => { throw new Error("must not be reached"); } });
  people.__setDeps({
    enforceRateLimit: async (_req, res) => { res.status(429).json({ error: "rate_limited" }); return false; },
    requireStaff: async () => { throw new Error("must not be reached"); },
    userAccess: access,
  });
  const { req, res } = call({ method: "GET", query: { action: "list" } });
  await people(req, res);
  assert.equal(res.statusCode, 429);
});
