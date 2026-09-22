"use strict";

// Clerk session verification, server side.
//
// The browser gets a signed token from Clerk and sends it as a bearer. These
// tests say what the server does with it - and, just as importantly, what it
// does when Clerk is not configured yet.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const clerkAuth = require("../clerkAuth");

function req(headers = {}) {
  return { headers, query: {} };
}

beforeEach(() => {
  delete process.env.CLERK_SECRET_KEY;
  clerkAuth.__resetDeps();
});

test("with no secret configured, Clerk is reported as off rather than failing", async () => {
  // The switch for the whole integration: no key means we have not wired Clerk
  // in this environment yet, and routes keep their current behaviour.
  assert.equal(clerkAuth.isConfigured(), false);
  const result = await clerkAuth.verifyClerkSession(req({ authorization: "Bearer whatever" }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_configured");
});

test("a request with no bearer token is refused", async () => {
  process.env.CLERK_SECRET_KEY = "sk_test_x";
  const result = await clerkAuth.verifyClerkSession(req());
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_token");
});

test("a valid token yields the user, organisation and role", async () => {
  process.env.CLERK_SECRET_KEY = "sk_test_x";
  clerkAuth.__setDeps({
    verifyToken: async () => ({ sub: "user_123", org_id: "org_abc", org_role: "org:admin", sid: "sess_1" }),
  });
  const result = await clerkAuth.verifyClerkSession(req({ authorization: "Bearer good-token" }));
  assert.equal(result.ok, true);
  assert.equal(result.userId, "user_123");
  assert.equal(result.orgId, "org_abc");
  assert.equal(result.role, "admin", "org:admin is normalised to admin");
  assert.equal(result.sessionId, "sess_1");
});

test("a token Clerk rejects is refused, and the reason is not leaked to the caller", async () => {
  process.env.CLERK_SECRET_KEY = "sk_test_x";
  clerkAuth.__setDeps({
    verifyToken: async () => { throw new Error("token-expired: jwt expired at 1700000000"); },
  });
  const result = await clerkAuth.verifyClerkSession(req({ authorization: "Bearer stale" }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_token");
  assert.ok(!JSON.stringify(result).includes("1700000000"), "internal detail must not travel back to the caller");
});

test("a token with no user in it is refused", async () => {
  process.env.CLERK_SECRET_KEY = "sk_test_x";
  clerkAuth.__setDeps({ verifyToken: async () => ({ org_id: "org_abc" }) });
  const result = await clerkAuth.verifyClerkSession(req({ authorization: "Bearer odd" }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_token");
});

test("a user with no organisation is allowed through with no role", async () => {
  // Signed in, but not yet a member of any organisation. Authentication and
  // authorisation are different questions: the route decides what that earns.
  process.env.CLERK_SECRET_KEY = "sk_test_x";
  clerkAuth.__setDeps({ verifyToken: async () => ({ sub: "user_1" }) });
  const result = await clerkAuth.verifyClerkSession(req({ authorization: "Bearer fine" }));
  assert.equal(result.ok, true);
  assert.equal(result.orgId, null);
  assert.equal(result.role, null);
});

test("the token is read from the Authorization header only", async () => {
  // Not from a query string: URLs end up in logs, history and referrer headers.
  process.env.CLERK_SECRET_KEY = "sk_test_x";
  let seen = null;
  clerkAuth.__setDeps({ verifyToken: async (t) => { seen = t; return { sub: "user_1" }; } });
  const r = { headers: {}, query: { __clerk_db_jwt: "sneaky" } };
  const result = await clerkAuth.verifyClerkSession(r);
  assert.equal(result.ok, false);
  assert.equal(seen, null, "a token in the query string must never be verified");
});

// -- the email, as Clerk has verified it ------------------------------------
//
// The session token carries no email. It matters because an email is how
// somebody is invited before they have ever signed in: trusting the address in
// a request body would let any signed-in stranger collect the admin grant left
// waiting for somebody else.

test("the verified primary address comes back, lower-cased", async () => {
  process.env.CLERK_SECRET_KEY = "sk_test_x";
  clerkAuth.__setDeps({
    getUser: async () => ({
      primaryEmailAddressId: "idem_2",
      emailAddresses: [
        { id: "idem_1", emailAddress: "old@acme.test", verification: { status: "verified" } },
        { id: "idem_2", emailAddress: "Real@Acme.test", verification: { status: "verified" } },
      ],
    }),
  });
  assert.equal(await clerkAuth.verifiedEmailFor("user_1"), "real@acme.test");
});

test("an unverified address is refused", async () => {
  // Clerk lets a user add any address to their account; only a verified one
  // proves they read that inbox. Otherwise anybody could add
  // boss@ourcustomer.test and collect the invitation waiting for them.
  process.env.CLERK_SECRET_KEY = "sk_test_x";
  clerkAuth.__setDeps({
    getUser: async () => ({
      primaryEmailAddressId: "idem_1",
      emailAddresses: [{ id: "idem_1", emailAddress: "claimed@acme.test", verification: { status: "unverified" } }],
    }),
  });
  assert.equal(await clerkAuth.verifiedEmailFor("user_1"), null);
});

test("no email is the answer whenever there is any doubt", async () => {
  process.env.CLERK_SECRET_KEY = "sk_test_x";
  clerkAuth.__setDeps({ getUser: async () => { throw new Error("clerk unreachable"); } });
  assert.equal(await clerkAuth.verifiedEmailFor("user_1"), null, "an outage must leave an invitation pending, not hand it out");

  clerkAuth.__setDeps({ getUser: async () => ({ emailAddresses: [] }) });
  assert.equal(await clerkAuth.verifiedEmailFor("user_1"), null);
  assert.equal(await clerkAuth.verifiedEmailFor(null), null);
});

test("without a Clerk key nothing is asked of Clerk", async () => {
  delete process.env.CLERK_SECRET_KEY;
  let asked = false;
  clerkAuth.__setDeps({ getUser: async () => { asked = true; return {}; } });
  assert.equal(await clerkAuth.verifiedEmailFor("user_1"), null);
  assert.equal(asked, false);
});
