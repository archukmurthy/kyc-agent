const { test, before, after } = require("node:test");
const assert = require("node:assert");
const handler = require("../amendment-documents");

let prevUrl;
before(() => { prevUrl = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgres://test"; });
after(() => { if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl; });

function fakeRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function accessWith(actor) {
  const real = require("../../lib/dossierAccess");
  return { ...real, resolveDossierActor: async () => actor };
}

function deps(dossierRow, actor) {
  const sql = (strings) => {
    const text = strings.join(" ");
    // Mirror real Postgres: a `status != 'deleted'` clause in the query text
    // actually excludes a row whose status is 'deleted'. Makes the
    // "gate lookup must not filter on status" test meaningful.
    if (dossierRow && dossierRow.status === "deleted" && /status\s*!=\s*'deleted'/i.test(text)) {
      return Promise.resolve([]);
    }
    return Promise.resolve(dossierRow ? [dossierRow] : []);
  };
  return {
    neon: () => sql,
    getEventsBySubmission: async () => [{ id: "e" }],
    deriveAmendmentDocuments: () => [{ docType: "Certificate" }],
    access: accessWith(actor),
  };
}

const ROW = { id: "d-1", tenant_id: "acme", owned_by: "customer" };
const req = (submissionId) => ({ method: "GET", query: { submissionId }, headers: {} });

test("a read failure reports a fixed code, never the raw error text", async () => {
  handler.__setDeps({
    neon: () => () => Promise.resolve([]),
    getEventsBySubmission: async () => { throw new Error("connection terminated unexpectedly - internal detail"); },
    deriveAmendmentDocuments: () => [],
    access: accessWith({ kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }),
  });
  const res = fakeRes();
  await handler(req("fresh-app"), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { documents: [], warning: "amendment_documents_failed" });
});

test("a fresh application's documents are readable as before", async () => {
  handler.__setDeps(deps(null, { kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }));
  const res = fakeRes();
  await handler(req("fresh-app"), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.documents.length, 1);
});

test("a dossier's documents need a credential", async () => {
  handler.__setDeps(deps(ROW, { kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }));
  const res = fakeRes();
  await handler(req("d-1"), res);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.documents, undefined);
});

test("a soft-deleted dossier's id still requires a credential - it is not a fresh application", async () => {
  handler.__setDeps(deps({ ...ROW, status: "deleted" }, { kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }));
  const res = fakeRes();
  await handler(req("d-1"), res);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.documents, undefined);
});

test("a credentialed analyst cannot read a soft-deleted dossier's documents", async () => {
  handler.__setDeps(deps({ ...ROW, status: "deleted" }, { kind: "analyst", tenantId: "acme", dossierId: null, reason: null }));
  const res = fakeRes();
  await handler(req("d-1"), res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "dossier_not_found" });
});

test("a credentialed customer cannot read its own soft-deleted dossier's documents", async () => {
  handler.__setDeps(deps({ ...ROW, status: "deleted" }, { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null }));
  const res = fakeRes();
  await handler(req("d-1"), res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "dossier_not_found" });
});

test("an analyst may READ a customer-owned dossier's documents", async () => {
  handler.__setDeps(deps(ROW, { kind: "analyst", tenantId: "acme", dossierId: null, reason: null }));
  const res = fakeRes();
  await handler(req("d-1"), res);
  assert.strictEqual(res.statusCode, 200);
});

test("a customer reads only its own dossier's documents", async () => {
  handler.__setDeps(deps({ ...ROW, id: "d-2" }, { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null }));
  const res = fakeRes();
  await handler(req("d-2"), res);
  assert.strictEqual(res.statusCode, 403);
});
