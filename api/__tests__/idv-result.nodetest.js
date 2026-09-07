const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const realFetch = global.fetch;
let handler, store, tmp;

function mockRes() {
  return { statusCode: 200, body: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; } };
}

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `didit-result-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.DIDIT_STORE_PATH = tmp;
  process.env.DIDIT_API_KEY = "k";
  ["../idv-result", "../../lib/didit/diditClient", "../../lib/didit/store", "../../lib/didit/mapDecision"]
    .forEach((m) => delete require.cache[require.resolve(m)]);
  handler = require("../idv-result");
  store = require("../../lib/didit/store");
});
afterEach(() => { global.fetch = realFetch; try { fs.unlinkSync(tmp); } catch (_) {} });

test("404 when ref has no session", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: { ref: "nope" } }, res);
  assert.strictEqual(res.statusCode, 404);
});

test("pulls decision, maps, stores, returns mappedFields", async () => {
  store.saveSession("ref-5", { providerSessionId: "sess-5" });
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    status: "Approved",
    decision: { status: "Approved", id_verifications: [{ first_name: "ADA", last_name: "LOVELACE", document_number: "X1" }] },
  }) });
  const res = mockRes();
  await handler({ method: "POST", body: { ref: "ref-5" } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.verified, true);
  assert.strictEqual(res.body.mappedFields.applicantFirstName, "ADA");
  assert.strictEqual(res.body.extras.documentNumber, "X1");
  assert.strictEqual(store.getResult("ref-5").mappedFields.applicantLastName, "LOVELACE");
});
