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
