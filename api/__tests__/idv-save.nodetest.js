const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

let handler, store, tmp;

function mockRes() {
  return { statusCode: 200, body: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; } };
}

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `didit-save-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.DIDIT_STORE_PATH = tmp;
  ["../idv-save", "../../lib/didit/store"].forEach((m) => delete require.cache[require.resolve(m)]);
  handler = require("../idv-save");
  store = require("../../lib/didit/store");
});
afterEach(() => { try { fs.unlinkSync(tmp); } catch (_) {} });

test("400 when ref missing", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: {} }, res);
  assert.strictEqual(res.statusCode, 400);
});

test("404 when no session for ref", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: { ref: "nope", edits: {} } }, res);
  assert.strictEqual(res.statusCode, 404);
});

test("records only changed fields as {original, changed}; original left untouched", async () => {
  store.saveResult("r1", {
    status: "Approved", verified: true,
    mappedFields: { applicantFirstName: "MARIA" },
    extras: { documentNumber: "AAF794880" },
  });
  const res = mockRes();
  await handler({ method: "POST", body: { ref: "r1", edits: { applicantFirstName: "MARIA", documentNumber: "ZZZ999" } } }, res);
  assert.strictEqual(res.statusCode, 200);
  // Unchanged applicantFirstName is omitted; only documentNumber recorded.
  assert.deepStrictEqual(res.body.edits, { documentNumber: { original: "AAF794880", changed: "ZZZ999" } });
  const rec = store.getResult("r1");
  assert.deepStrictEqual(rec.edits, { documentNumber: { original: "AAF794880", changed: "ZZZ999" } });
  // Original decision data is preserved, not overwritten.
  assert.strictEqual(rec.extras.documentNumber, "AAF794880");
  assert.strictEqual(rec.mappedFields.applicantFirstName, "MARIA");
});
