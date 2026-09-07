const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let store, tmp;
beforeEach(() => {
  tmp = path.join(os.tmpdir(), `didit-store-test-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.DIDIT_STORE_PATH = tmp;
  delete require.cache[require.resolve("../store")];
  store = require("../store");
});
afterEach(() => { try { fs.unlinkSync(tmp); } catch (_) {} });

test("saves and reads a session link", () => {
  assert.strictEqual(store.getSession("ref-1"), null);
  store.saveSession("ref-1", { providerSessionId: "sess-1" });
  assert.strictEqual(store.getSession("ref-1").providerSessionId, "sess-1");
});

test("merges a result onto an existing ref", () => {
  store.saveSession("ref-1", { providerSessionId: "sess-1" });
  store.saveResult("ref-1", { status: "Approved", verified: true, mappedFields: { applicantFirstName: "ADA" }, extras: { documentNumber: "X1" } });
  const r = store.getResult("ref-1");
  assert.strictEqual(r.verified, true);
  assert.strictEqual(r.mappedFields.applicantFirstName, "ADA");
  assert.strictEqual(store.getSession("ref-1").providerSessionId, "sess-1");
});
