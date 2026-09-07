const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const realFetch = global.fetch;
let handler, tmp;

function mockRes() {
  return { statusCode: 200, body: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; } };
}

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `didit-start-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.DIDIT_STORE_PATH = tmp;
  process.env.DIDIT_API_KEY = "k"; process.env.DIDIT_WORKFLOW_ID = "wf";
  ["../idv-start", "../../lib/didit/diditClient", "../../lib/didit/store"]
    .forEach((m) => delete require.cache[require.resolve(m)]);
  handler = require("../idv-start");
});
afterEach(() => { global.fetch = realFetch; try { fs.unlinkSync(tmp); } catch (_) {} });

test("400 when ref missing", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: {} }, res);
  assert.strictEqual(res.statusCode, 400);
});

test("creates session, stores link, returns hostedUrl", async () => {
  global.fetch = async () => ({ ok: true, status: 201,
    json: async () => ({ session_id: "sess-9", url: "https://verification.didit.me/s/z", status: "Not Started" }) });
  const res = mockRes();
  await handler({ method: "POST", body: { ref: "ref-9" } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.providerSessionId, "sess-9");
  const store = require("../../lib/didit/store");
  assert.strictEqual(store.getSession("ref-9").providerSessionId, "sess-9");
});
