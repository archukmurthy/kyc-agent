"use strict";

// Who works for which company, and as what.
//
// Clerk answers "is this really that person". This answers "what may that
// person see", and it is ours rather than Clerk's so the company list stays in
// one place - the same place the tenant registry already lives.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const userAccess = require("../userAccess");

let store;
beforeEach(() => {
  delete process.env.PLATFORM_OWNER_CLERK_IDS;
  store = new Map();
  userAccess.__setDeps({
    storage: {
      get: async (k) => (store.has(k) ? store.get(k) : null),
      set: async (k, v) => { store.set(k, v); },
      del: async (k) => { store.delete(k); },
    },
    now: () => "2026-09-20T12:00:00.000Z",
  });
});

test("an unknown person has no access at all", async () => {
  const access = await userAccess.getAccess("user_nobody");
  assert.equal(access, null);
});

test("granting access records who they are, where, and who added them", async () => {
  await userAccess.grantAccess({ userId: "user_1", tenantId: "acme", role: "analyst", addedBy: "user_owner" });
  const access = await userAccess.getAccess("user_1");
  assert.equal(access.tenantId, "acme");
  assert.equal(access.role, "analyst");
  assert.equal(access.addedBy, "user_owner", "every grant records who made it - this is an audit trail, not a lookup table");
  assert.equal(access.addedAt, "2026-09-20T12:00:00.000Z");
});

test("access can be taken away", async () => {
  await userAccess.grantAccess({ userId: "user_1", tenantId: "acme", role: "analyst" });
  await userAccess.revokeAccess("user_1");
  assert.equal(await userAccess.getAccess("user_1"), null);
});

test("a role we do not recognise is refused", async () => {
  await assert.rejects(
    () => userAccess.grantAccess({ userId: "user_1", tenantId: "acme", role: "superuser" }),
    /role/i,
    "a typo in a role must fail loudly rather than create a role nobody checks for"
  );
});

test("a grant with no tenant is refused, unless it is an owner", async () => {
  await assert.rejects(() => userAccess.grantAccess({ userId: "user_1", role: "analyst" }), /tenant/i);
});

test("the bootstrap owner comes from configuration, not from the list", async () => {
  // The chicken and egg: the list starts empty, so nobody can sign in to fill
  // it. One setting names the first owner and breaks the loop.
  process.env.PLATFORM_OWNER_CLERK_IDS = "user_boss";
  const access = await userAccess.getAccess("user_boss");
  assert.equal(access.role, "owner");
  assert.equal(access.tenantId, null, "an owner is not bound to one company");
  assert.equal(access.source, "bootstrap");
});

test("several bootstrap owners can be named, and whitespace is forgiven", async () => {
  process.env.PLATFORM_OWNER_CLERK_IDS = "user_a, user_b ,user_c";
  for (const id of ["user_a", "user_b", "user_c"]) {
    assert.equal((await userAccess.getAccess(id)).role, "owner", id);
  }
  assert.equal(await userAccess.getAccess("user_d"), null);
});

test("the bootstrap setting wins over a stored row", async () => {
  // So an owner cannot be locked out by an accidental or malicious grant that
  // demotes them - the way back in is a setting only the deployer controls.
  process.env.PLATFORM_OWNER_CLERK_IDS = "user_boss";
  await userAccess.grantAccess({ userId: "user_boss", tenantId: "acme", role: "analyst" });
  const access = await userAccess.getAccess("user_boss");
  assert.equal(access.role, "owner");
});

test("a storage failure denies access rather than granting it", async () => {
  userAccess.__setDeps({ storage: { get: async () => { throw new Error("kv down"); } } });
  assert.equal(await userAccess.getAccess("user_1"), null);
});

test("people can be listed for one company", async () => {
  await userAccess.grantAccess({ userId: "user_1", tenantId: "acme", role: "analyst" });
  await userAccess.grantAccess({ userId: "user_2", tenantId: "acme", role: "admin" });
  await userAccess.grantAccess({ userId: "user_3", tenantId: "other", role: "analyst" });
  const acme = await userAccess.listAccess("acme");
  assert.deepEqual(acme.map((a) => a.userId).sort(), ["user_1", "user_2"]);
});

// -- invitations by email ---------------------------------------------------
//
// A grant is keyed by Clerk user id, and nobody has one until they sign in. So
// an admin adding a colleague has nothing to type. Invitations hold the grant
// against an email address until that person arrives.

test("somebody can be invited before they have ever signed in", async () => {
  await userAccess.inviteByEmail({ email: "New@Acme.test", tenantId: "acme", role: "analyst", addedBy: "user_admin" });
  const pending = await userAccess.listPending("acme");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].email, "new@acme.test", "addresses are compared lower-cased, or a capital letter loses somebody their access");
  assert.equal(pending[0].addedBy, "user_admin");
  assert.equal(await userAccess.getAccess("user_new"), null, "an invitation is not access - it becomes access when they sign in");
});

test("signing in turns the invitation into real access, once", async () => {
  await userAccess.inviteByEmail({ email: "new@acme.test", tenantId: "acme", role: "admin", addedBy: "user_admin" });
  const claimed = await userAccess.claimByEmail("user_new", "new@acme.test");
  assert.equal(claimed.role, "admin");
  assert.equal(claimed.tenantId, "acme");

  const access = await userAccess.getAccess("user_new");
  assert.equal(access.role, "admin");
  assert.deepEqual(await userAccess.listPending("acme"), [], "a claimed invitation is gone, so a second person cannot use the same one");
  assert.equal(await userAccess.claimByEmail("user_other", "new@acme.test"), null);
});

test("a person nobody invited claims nothing", async () => {
  assert.equal(await userAccess.claimByEmail("user_stranger", "stranger@example.test"), null);
  assert.equal(await userAccess.claimByEmail("user_stranger", ""), null);
  assert.equal(await userAccess.claimByEmail(null, "new@acme.test"), null);
});

test("an invitation can be withdrawn before it is claimed", async () => {
  await userAccess.inviteByEmail({ email: "oops@acme.test", tenantId: "acme", role: "analyst" });
  assert.equal(await userAccess.cancelInvite("OOPS@acme.test "), true);
  assert.deepEqual(await userAccess.listPending("acme"), []);
  assert.equal(await userAccess.claimByEmail("user_oops", "oops@acme.test"), null);
});

test("invitations are listed per company, like people", async () => {
  await userAccess.inviteByEmail({ email: "a@acme.test", tenantId: "acme", role: "analyst" });
  await userAccess.inviteByEmail({ email: "b@rival.test", tenantId: "rival", role: "analyst" });
  assert.deepEqual((await userAccess.listPending("acme")).map((p) => p.email), ["a@acme.test"]);
  assert.equal((await userAccess.listPending()).length, 2);
});

test("an invitation to a role that does not exist is refused", async () => {
  await assert.rejects(() => userAccess.inviteByEmail({ email: "a@acme.test", tenantId: "acme", role: "superuser" }));
  await assert.rejects(() => userAccess.inviteByEmail({ email: "not-an-address", tenantId: "acme", role: "analyst" }));
  await assert.rejects(() => userAccess.inviteByEmail({ email: "a@acme.test", role: "analyst" }), /tenant/);
});

test("an unreadable invitation list denies rather than grants", async () => {
  userAccess.__setDeps({ storage: { get: async () => { throw new Error("kv down"); }, set: async () => {} } });
  assert.equal(await userAccess.claimByEmail("user_1", "new@acme.test"), null);
});

test("an owner who joined a trial works in that trial's workspace, and stays owner", async () => {
  // Found in the browser test: the owner opened their own invite to try the
  // demo, and every case step answered tenant_required - the bootstrap check
  // returned "owner, no workspace" without looking at the trial they joined.
  process.env.PLATFORM_OWNER_CLERK_IDS = "user_boss";
  await userAccess.grantAccess({ userId: "user_boss", tenantId: "trial-acme-1a2b3c4d", role: "analyst" });
  const access = await userAccess.getAccess("user_boss");
  assert.equal(access.role, "owner", "the stored row never demotes an owner");
  assert.equal(access.tenantId, "trial-acme-1a2b3c4d");
});

test("an owner is still an owner when the access list cannot be read", async () => {
  process.env.PLATFORM_OWNER_CLERK_IDS = "user_boss";
  userAccess.__setDeps({ storage: { get: async () => { throw new Error("kv down"); } } });
  const access = await userAccess.getAccess("user_boss");
  assert.equal(access.role, "owner");
  assert.equal(access.tenantId, null);
});
