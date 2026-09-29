const { test, before, after } = require("node:test");
const assert = require("node:assert");
const handler = require("../search-attempt");
const researchGrant = require("../../lib/researchGrant");

let prevUrl;
let prevSecret;
before(() => {
  prevUrl = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgres://test";
  prevSecret = process.env.RESEARCH_GRANT_SECRET; process.env.RESEARCH_GRANT_SECRET = "grant-secret";
});
after(() => {
  if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl;
  if (prevSecret === undefined) delete process.env.RESEARCH_GRANT_SECRET; else process.env.RESEARCH_GRANT_SECRET = prevSecret;
});

const withoutGrant = ({ grant, ...rest }) => rest;

function fakeRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

// Mirrors Postgres: the UPDATE only matches while customer_searches < 2.
function fakeSql(row) {
  const log = [];
  const state = row ? { ...row } : null;
  const sql = (strings, ...values) => {
    const text = strings.join(" ");
    log.push({ text, values });
    if (/UPDATE entity_dossiers/i.test(text)) {
      if (!state || state.customer_searches >= 2) return Promise.resolve([]);
      state.customer_searches += 1;
      state.owned_by = "customer";
      return Promise.resolve([{ customer_searches: state.customer_searches }]);
    }
    return Promise.resolve(state ? [{ ...state }] : []);
  };
  sql.log = log;
  sql.state = () => state;
  return sql;
}

function accessWith(actor) {
  const real = require("../../lib/dossierAccess");
  return { ...real, resolveDossierActor: async () => actor };
}

const ROW = { id: "d-1", tenant_id: "acme", owned_by: "analyst", customer_searches: 0 };
const ANALYST = { kind: "analyst", tenantId: "acme", dossierId: null, reason: null };
const CUSTOMER = { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null };
const post = (body = {}) => ({ method: "POST", body, query: {}, headers: {} });
const get = (query = {}) => ({ method: "GET", body: {}, query, headers: {} });

test("no credential is a 401 and the counter is untouched", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith({ kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }) });
  const res = fakeRes();
  await handler(post({ dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(sql.log.length, 0);
});

test("an analyst can read the count but never consume a customer search", async () => {
  const sql = fakeSql({ ...ROW, customer_searches: 1 });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const read = fakeRes();
  await handler(get({ dossierId: "d-1" }), read);
  assert.strictEqual(read.statusCode, 200);
  assert.deepStrictEqual(read.body, { attemptsUsed: 1, remaining: 1, cap: 2 });

  const write = fakeRes();
  await handler(post({ dossierId: "d-1" }), write);
  assert.strictEqual(write.statusCode, 403);
  assert.deepStrictEqual(write.body, { error: "forbidden" });
  assert.ok(!sql.log.some((l) => /UPDATE/i.test(l.text)));
});

test("a customer gets exactly two searches; the third is refused", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });

  const first = fakeRes();
  await handler(post(), first);
  assert.deepStrictEqual(withoutGrant(first.body), { allowed: true, attemptsUsed: 1, remaining: 1 });

  const second = fakeRes();
  await handler(post(), second);
  assert.deepStrictEqual(withoutGrant(second.body), { allowed: true, attemptsUsed: 2, remaining: 0 });

  const third = fakeRes();
  await handler(post(), third);
  assert.strictEqual(third.statusCode, 200);
  assert.deepStrictEqual(third.body, { allowed: false, attemptsUsed: 2, remaining: 0 });
  assert.strictEqual(sql.state().customer_searches, 2);
});

test("consuming a search flips the dossier to customer-owned", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  await handler(post(), fakeRes());
  const update = sql.log.find((l) => /UPDATE entity_dossiers/i.test(l.text));
  assert.match(update.text, /owned_by\s*=/);
  assert.match(update.text, /customer_searches\s*=\s*customer_searches\s*\+\s*1/);
  assert.match(update.text, /customer_searches\s*<\s*/);
});

test("a customer's dossier id comes from the token, never the body", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  await handler(post({ dossierId: "someone-else" }), fakeRes());
  assert.ok(sql.log.every((l) => !l.values.includes("someone-else")));
  assert.ok(sql.log.every((l) => l.values.includes("d-1")));
});

test("every statement is scoped by the verified tenant", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  await handler(post(), fakeRes());
  assert.ok(sql.log.length >= 2);
  for (const entry of sql.log) {
    assert.match(entry.text, /tenant_id\s*=/);
    assert.ok(entry.values.includes("acme"));
  }
});

test("a dossier in another tenant is a 404", async () => {
  const sql = fakeSql(null);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(post(), res);
  assert.strictEqual(res.statusCode, 404);
});

test("an analyst must name the dossier to read", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(get(), res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "dossierId_required" });
});

test("a DB failure refuses the search (fail closed) with a fixed code", async () => {
  const throwingSql = () => { throw new Error("connection terminated — internal detail"); };
  handler.__setDeps({ neon: () => throwingSql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(post(), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { allowed: false, attemptsUsed: null, remaining: null, warning: "search_attempt_failed" });
});

test("no DATABASE_URL refuses the search", async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    handler.__setDeps({ neon: () => { throw new Error("must not connect"); }, access: accessWith(CUSTOMER) });
    const res = fakeRes();
    await handler(post(), res);
    assert.deepStrictEqual(res.body, { allowed: false, attemptsUsed: null, remaining: null, warning: "database_not_configured" });
  } finally {
    process.env.DATABASE_URL = saved;
  }
});

test("an allowed search returns a grant for this dossier and tenant; a refused one returns none", async () => {
  const sql = fakeSql({ ...ROW, customer_searches: 1 });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const allowed = fakeRes();
  await handler(post(), allowed);
  assert.strictEqual(allowed.body.allowed, true);
  assert.strictEqual(researchGrant.verify(allowed.body.grant, { subject: "dossier:d-1", tenantId: "acme" }).valid, true);
  assert.strictEqual(researchGrant.verify(allowed.body.grant, { subject: "dossier:d-2", tenantId: "acme" }).valid, false);

  const refused = fakeRes();
  await handler(post(), refused);
  assert.strictEqual(refused.body.allowed, false);
  assert.strictEqual("grant" in refused.body, false);
});

test("no grant secret refuses the search without spending it", async () => {
  const saved = { r: process.env.RESEARCH_GRANT_SECRET, d: process.env.DOSSIER_TOKEN_SECRET };
  delete process.env.RESEARCH_GRANT_SECRET;
  delete process.env.DOSSIER_TOKEN_SECRET;
  try {
    const sql = fakeSql({ ...ROW, customer_searches: 1 });
    handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
    const res = fakeRes();
    await handler(post(), res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { allowed: false, attemptsUsed: 1, remaining: 1, warning: "grant_unavailable" });
    assert.strictEqual(sql.state().customer_searches, 1);
    assert.ok(!sql.log.some((l) => /UPDATE/i.test(l.text)));
  } finally {
    process.env.RESEARCH_GRANT_SECRET = saved.r;
    if (saved.d !== undefined) process.env.DOSSIER_TOKEN_SECRET = saved.d;
  }
});
