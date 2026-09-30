"use strict";

// The customer's key to one UBO case. Written from the attacker's side: what a
// forged, expired, revoked, forwarded or repurposed token gets you - nothing.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const link = require("../uboCustomerLink");

let store;
let clock;
let saved;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  store = new Map();
  clock = Date.parse("2026-09-30T10:00:00.000Z");
  link.__setDeps({ storage: { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } }, now: () => clock });
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
  const { token, expiresAt } = link.mintLink(CASE);
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
  const { token } = link.mintLink(CASE);
  clock += 7 * DAY;
  assert.strictEqual((await link.verifyLink(token)).reason, "expired");
});

test("the link is bound to its recipient's email, not carried in it", async () => {
  const { token } = link.mintLink(CASE);
  assert.doesNotMatch(Buffer.from(token.split(".")[0], "base64url").toString(), /example\.test/i, "the address must not be readable from the link");
  const { payload } = await link.verifyLink(token);
  assert.strictEqual(link.emailMatches(payload, "customer@example.test "), true, "case and spaces do not matter");
  assert.strictEqual(link.emailMatches(payload, "someone.else@example.test"), false);
  assert.strictEqual(link.emailMatches(payload, ""), false);
});

test("a tampered link is refused", async () => {
  const { token } = link.mintLink(CASE);
  const [body, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  const forged = Buffer.from(JSON.stringify({ ...payload, caseId: "someone-elses-case" })).toString("base64url");
  assert.strictEqual((await link.verifyLink(`${forged}.${signature}`)).valid, false);
});

test("revoking a case's links kills every copy, and a new link still works", async () => {
  const { token: forwarded } = link.mintLink(CASE);
  clock += 1000;
  await link.revokeLinks(CASE);
  assert.strictEqual((await link.verifyLink(forwarded)).reason, "revoked");
  clock += 1000;
  const { token: fresh } = link.mintLink(CASE);
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
  const { token } = link.mintLink(CASE);
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
  assert.throws(() => link.mintLink(CASE), /SECRET/);
  assert.strictEqual((await link.verifyLink("a.b")).valid, false);
});
