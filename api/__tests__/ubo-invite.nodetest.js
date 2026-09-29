"use strict";

// The invite route. The important tests here are the refusals: creating invites
// is how somebody would help themselves to our Anthropic budget.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const invite = require("../ubo-invite");

function call({ method = "POST", body = {}, query = {} } = {}) {
  const req = { method, body, query, headers: { authorization: "Bearer t" }, url: "/api/ubo-invite" };
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

beforeEach(() => {
  invite.__resetDeps();
  invite.__setDeps({ enforceRateLimit: async () => true });
});

test("a non-owner cannot create an invite", async () => {
  // The screen is owner-only, but hiding a screen stops nobody - anyone can
  // post here directly.
  invite.__setDeps({
    requireStaff: async (_req, res) => { res.status(403).json({ error: "forbidden" }); return null; },
    trials: { createInvite: async () => { throw new Error("must not be reached"); } },
  });
  const { req, res } = call({ body: { action: "create", company: "Acme" } });
  await invite(req, res);
  assert.equal(res.statusCode, 403);
});

test("an owner creates an invite and gets a code back", async () => {
  invite.__setDeps({
    requireStaff: async () => ({ kind: "staff", userId: "user_owner", role: "owner", tenantId: null }),
    trials: { createInvite: async (args) => ({ code: "ACME-7D3K", ...args }) },
  });
  const { req, res } = call({ body: { action: "create", company: "Acme", seats: 5, days: 7 } });
  await invite(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invite.code, "ACME-7D3K");
  assert.equal(res.body.invite.createdBy, "user_owner", "an invite records who made it");
});

test("creating without a company is refused before anything is stored", async () => {
  let created = false;
  invite.__setDeps({
    requireStaff: async () => ({ kind: "staff", userId: "user_owner", role: "owner" }),
    trials: { createInvite: async () => { created = true; return {}; } },
  });
  const { req, res } = call({ body: { action: "create" } });
  await invite(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(created, false);
});

test("redeeming needs a signed-in person, not an owner", async () => {
  invite.__setDeps({
    clerkAuth: { verifyClerkSession: async () => ({ ok: true, userId: "user_a", email: "a@acme.com" }) },
    trials: { redeem: async (args) => ({ ok: true, access: { tenantId: "trial-acme-1", email: args.email } }) },
  });
  const { req, res } = call({ body: { action: "redeem", code: "ACME-7D3K" } });
  await invite(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.access.email, "a@acme.com", "the email is carried through so their work can be re-linked later");
});

test("a signed-out visitor cannot redeem", async () => {
  invite.__setDeps({
    clerkAuth: { verifyClerkSession: async () => ({ ok: false, reason: "no_token" }) },
    trials: { redeem: async () => { throw new Error("must not be reached"); } },
  });
  const { req, res } = call({ body: { action: "redeem", code: "ACME-7D3K" } });
  await invite(req, res);
  assert.equal(res.statusCode, 401);
});

test("a full or revoked invite is refused with the reason", async () => {
  invite.__setDeps({
    clerkAuth: { verifyClerkSession: async () => ({ ok: true, userId: "user_z" }) },
    trials: { redeem: async () => ({ ok: false, reason: "invite_full" }) },
  });
  const { req, res } = call({ body: { action: "redeem", code: "ACME-7D3K" } });
  await invite(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "invite_full");
});

test("redemption is rate-limited before anything is looked up", async () => {
  // It is the only way to discover a working code, so it is the one action an
  // attacker can usefully spray.
  let lookedUp = false;
  invite.__setDeps({
    enforceRateLimit: async (_req, res) => { res.status(429).json({ error: "rate_limited" }); return false; },
    trials: { redeem: async () => { lookedUp = true; return { ok: true }; } },
  });
  const { req, res } = call({ body: { action: "redeem", code: "GUESS-1" } });
  await invite(req, res);
  assert.equal(res.statusCode, 429);
  assert.equal(lookedUp, false);
});
