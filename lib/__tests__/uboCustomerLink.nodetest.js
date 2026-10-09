"use strict";

// The customer's key to one UBO case. Written from the attacker's side: what a
// forged, expired, revoked, forwarded or repurposed token gets you - nothing.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const link = require("../uboCustomerLink");
const { createMemoryStore } = require("../storage");

let store;
let clock;
let saved;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  store = createMemoryStore();
  clock = Date.parse("2026-09-30T10:00:00.000Z");
  link.__setDeps({ storage: store, now: () => clock });
  saved = { session: process.env.SESSION_SECRET, dossier: process.env.DOSSIER_TOKEN_SECRET, days: process.env.UBO_CUSTOMER_LINK_DAYS };
  process.env.SESSION_SECRET = "test-secret-that-is-long-enough-for-hmac";
  delete process.env.UBO_CUSTOMER_LINK_DAYS;
});
afterEach(() => {
  for (const [key, name] of [["session", "SESSION_SECRET"], ["dossier", "DOSSIER_TOKEN_SECRET"], ["days", "UBO_CUSTOMER_LINK_DAYS"]]) {
    if (saved[key] === undefined) delete process.env[name]; else process.env[name] = saved[key];
  }
});

const CASE = { caseId: "case-1", tenantId: "trial-acme-1a2b3c4d", email: "Customer@Example.test" };

test("a link opens its own case, for thirty days", async () => {
  const { token, expiresAt } = await link.mintLink(CASE);
  const opened = await link.verifyLink(token);
  assert.strictEqual(opened.valid, true);
  assert.strictEqual(opened.payload.caseId, "case-1");
  assert.strictEqual(opened.payload.tenantId, CASE.tenantId);
  assert.strictEqual(expiresAt, new Date(clock + 30 * DAY).toISOString());
  clock += 30 * DAY;
  assert.strictEqual((await link.verifyLink(token)).reason, "expired");
});

test("the length is a setting, as agreed", async () => {
  process.env.UBO_CUSTOMER_LINK_DAYS = "7";
  const { token } = await link.mintLink(CASE);
  clock += 7 * DAY;
  assert.strictEqual((await link.verifyLink(token)).reason, "expired");
});

test("the link is bound to its recipient's email, not carried in it", async () => {
  const { token } = await link.mintLink(CASE);
  assert.doesNotMatch(Buffer.from(token.split(".")[0], "base64url").toString(), /example\.test/i, "the address must not be readable from the link");
  const { payload } = await link.verifyLink(token);
  assert.strictEqual(link.emailMatches(payload, "customer@example.test "), true, "case and spaces do not matter");
  assert.strictEqual(link.emailMatches(payload, "someone.else@example.test"), false);
  assert.strictEqual(link.emailMatches(payload, ""), false);
});

test("a tampered link is refused", async () => {
  const { token } = await link.mintLink(CASE);
  const [body, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  const forged = Buffer.from(JSON.stringify({ ...payload, caseId: "someone-elses-case" })).toString("base64url");
  assert.strictEqual((await link.verifyLink(`${forged}.${signature}`)).valid, false);
});

test("revoking a case's links kills every copy, and a new link still works", async () => {
  const { token: forwarded } = await link.mintLink(CASE);
  clock += 1000;
  await link.revokeLinks(CASE);
  assert.strictEqual((await link.verifyLink(forwarded)).reason, "revoked");
  clock += 1000;
  const { token: fresh } = await link.mintLink(CASE);
  assert.strictEqual((await link.verifyLink(fresh)).valid, true);
});

test("a customer session lasts hours and is scoped to one case", async () => {
  const { session, expiresAt } = link.mintCustomerSession({ caseId: "case-1", tenantId: CASE.tenantId });
  assert.strictEqual(expiresAt, new Date(clock + 8 * 60 * 60 * 1000).toISOString());
  const verified = await link.verifyCustomerSession(session);
  assert.deepStrictEqual({ caseId: verified.payload.caseId, tenantId: verified.payload.tenantId }, { caseId: "case-1", tenantId: CASE.tenantId });
  clock += 8 * 60 * 60 * 1000;
  assert.strictEqual((await link.verifyCustomerSession(session)).reason, "expired");
});

test("a link is not a session and a session is not a link", async () => {
  const { token } = await link.mintLink(CASE);
  const { session } = link.mintCustomerSession({ caseId: "case-1", tenantId: CASE.tenantId });
  assert.strictEqual((await link.verifyCustomerSession(token)).valid, false);
  assert.strictEqual((await link.verifyLink(session)).valid, false);
});

test("a revoked case's customer sessions end too", async () => {
  const { session } = link.mintCustomerSession({ caseId: "case-1", tenantId: CASE.tenantId });
  clock += 1000;
  await link.revokeLinks(CASE);
  assert.strictEqual((await link.verifyCustomerSession(session)).reason, "revoked");
});

test("a staff session or a dossier link cannot pass as either", async () => {
  process.env.DOSSIER_TOKEN_SECRET = process.env.SESSION_SECRET;
  const staff = require("../session").mint({ subject: "user_1", tenantId: CASE.tenantId, role: "analyst" });
  assert.strictEqual((await link.verifyLink(staff)).valid, false);
  assert.strictEqual((await link.verifyCustomerSession(staff)).valid, false);
});

test("with no secret configured nothing is minted and nothing verifies", async () => {
  delete process.env.SESSION_SECRET;
  delete process.env.DOSSIER_TOKEN_SECRET;
  await assert.rejects(link.mintLink(CASE), /SECRET/);
  assert.strictEqual((await link.verifyLink("a.b")).valid, false);
});

test("with no secret configured, making a link withdraws nothing", async () => {
  const { token } = await link.mintLink(CASE);
  const secret = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  await assert.rejects(link.mintLink(CASE), /SECRET/);
  process.env.SESSION_SECRET = secret;
  assert.strictEqual((await link.verifyLink(token)).valid, true);
});

// Review, 2026-10-09: "Create customer link" said it replaced the earlier
// link, and did not - every link ever made stayed live until a withdrawal.
test("a new link replaces every earlier link for the case, and ends their sessions", async () => {
  const first = await link.mintLink(CASE);
  assert.strictEqual(first.replaced, false);
  const opened = await link.verifyLink(first.token);
  const { session } = link.mintCustomerSession({ ...opened.payload, subject: "user_customer" });
  assert.strictEqual((await link.verifyCustomerSession(session)).valid, true);

  const second = await link.mintLink(CASE);
  assert.strictEqual(second.replaced, true);
  assert.strictEqual((await link.verifyLink(first.token)).reason, "revoked");
  assert.strictEqual((await link.verifyCustomerSession(session)).reason, "revoked");
  assert.strictEqual((await link.verifyLink(second.token)).valid, true);
  // Another case's links are untouched.
  const other = await link.mintLink({ ...CASE, caseId: "case-2" });
  assert.strictEqual((await link.verifyLink(second.token)).valid, true);
  assert.strictEqual((await link.verifyLink(other.token)).valid, true);
});

test("a link made in the same millisecond as a withdrawal works, and the withdrawn one does not", async () => {
  // Timestamps compared with <= killed the new link; a server clock behind the
  // one that withdrew would have too. The clock does not move in this test.
  const { token: old } = await link.mintLink(CASE);
  await link.revokeLinks(CASE);
  const { token: fresh } = await link.mintLink(CASE);
  assert.strictEqual((await link.verifyLink(old)).reason, "revoked");
  assert.strictEqual((await link.verifyLink(fresh)).valid, true);
  clock -= 60 * 1000; // a server whose clock is a minute behind
  assert.strictEqual((await link.verifyLink(fresh)).valid, true);
});

test("links made at the same time for one case: exactly one survives", async () => {
  const made = await Promise.all(Array.from({ length: 10 }, () => link.mintLink(CASE)));
  const valid = await Promise.all(made.map(({ token }) => link.verifyLink(token)));
  assert.strictEqual(valid.filter((v) => v.valid).length, 1);
});

test("a token from before generations still works until a link is made or withdrawn", async () => {
  // Links already sent when this shipped carry no generation.
  const { session: legacy } = link.mintCustomerSession({ caseId: "case-1", tenantId: CASE.tenantId });
  assert.strictEqual((await link.verifyCustomerSession(legacy)).valid, true);
  await store.set(`ubo-customer-link-revoked:${CASE.tenantId}:case-1`, clock);
  assert.strictEqual((await link.verifyCustomerSession(legacy)).reason, "revoked", "an old-style withdrawal still applies");
  await store.del(`ubo-customer-link-revoked:${CASE.tenantId}:case-1`);
  await link.mintLink(CASE);
  assert.strictEqual((await link.verifyCustomerSession(legacy)).reason, "revoked", "a new link replaces it");
});

test("an unreadable generation refuses the link rather than reviving it", async () => {
  const { token } = await link.mintLink(CASE);
  link.__setDeps({ storage: createMemoryStore({ fail: () => { throw new Error("kv down"); } }) });
  assert.strictEqual((await link.verifyLink(token)).reason, "revocation_unavailable");
});


test("a very long link setting is capped at 90 days", async () => {
  process.env.UBO_CUSTOMER_LINK_DAYS = "100000000";
  const { expiresAt } = await link.mintLink(CASE);
  assert.strictEqual(expiresAt, new Date(clock + 90 * DAY).toISOString());
});

test("a withdrawal outlives every link it kills, whatever the setting is later", async () => {
  // Review: the revocation record expired with the setting at revoke time, so
  // lowering the setting brought older, longer links back to life.
  const ttls = [];
  link.__setDeps({ storage: { ...store, incr: async (k, by, opts) => { ttls.push(opts && opts.ttlSeconds); return store.incr(k, by, opts); } } });
  process.env.UBO_CUSTOMER_LINK_DAYS = "7";
  await link.mintLink(CASE);
  await link.revokeLinks(CASE);
  assert.strictEqual(ttls.length, 2);
  for (const ttl of ttls) assert.ok(ttl >= 91 * 24 * 60 * 60, String(ttl));
});

test("a customer session names the person who opened it", async () => {
  const { session } = link.mintCustomerSession({ caseId: "case-1", tenantId: CASE.tenantId, subject: "user_customer" });
  assert.strictEqual((await link.verifyCustomerSession(session)).payload.sub, "user_customer");
});
