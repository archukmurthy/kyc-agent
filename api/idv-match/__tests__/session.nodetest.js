const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const attemptStore = require("../attemptStore");
const sessionModule = require("../session");
const { startVerificationAttempt } = sessionModule;

function mockRes() {
  const r = { statusCode: null, body: null };
  r.setHeader = () => {};
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

const realBandsFlag = process.env.IDV_DISCREPANCY_BANDS_ENABLED;

const realFetch = global.fetch;
const realCreate = attemptStore.createAttempt;
const realUpdate = attemptStore.updateAttempt;

let createdWith;
let updatedWith;
let fetchBody;

beforeEach(() => {
  process.env.DIDIT_API_KEY = "k";
  process.env.DIDIT_WORKFLOW_ID = "wf";
  // Stub the DB layer (no database in unit tests).
  attemptStore.createAttempt = async (args) => { createdWith = args; return "attempt-abc"; };
  attemptStore.updateAttempt = async (id, patch) => { updatedWith = { id, patch }; };
  // Stub the network so createSession returns a hosted session.
  global.fetch = async (url, opts) => {
    fetchBody = JSON.parse(opts.body);
    return { ok: true, status: 201, json: async () => ({ session_id: "sess-9", url: "https://verify.didit.me/s/x", status: "Not Started" }) };
  };
});

afterEach(() => {
  global.fetch = realFetch;
  attemptStore.createAttempt = realCreate;
  attemptStore.updateAttempt = realUpdate;
  if (realBandsFlag === undefined) delete process.env.IDV_DISCREPANCY_BANDS_ENABLED;
  else process.env.IDV_DISCREPANCY_BANDS_ENABLED = realBandsFlag;
});

test("HTTP handler 404s when the flag is off", async () => {
  delete process.env.IDV_DISCREPANCY_BANDS_ENABLED;
  const res = mockRes();
  await sessionModule.handler({ method: "POST", body: { applicationId: "a", officerCandidate: {} } }, res);
  assert.strictEqual(res.statusCode, 404);
});

test("HTTP handler 400s on missing fields when the flag is on", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const res = mockRes();
  await sessionModule.handler({ method: "POST", body: {} }, res);
  assert.strictEqual(res.statusCode, 400);
});

test("guards missing applicationId / officerCandidate", async () => {
  await assert.rejects(startVerificationAttempt({ officerCandidate: {} }), /applicationId is required/);
  await assert.rejects(startVerificationAttempt({ applicationId: "app-1" }), /officerCandidate is required/);
});

test("binds the Didit session to the server-created attempt (vendor_data = attempt id)", async () => {
  const out = await startVerificationAttempt({
    applicationId: "app-1",
    officerCandidate: { name: "SMITH, John", role: "Director", dob: "1985-05-24", officerId: "off-1" },
  });

  assert.strictEqual(out.attemptId, "attempt-abc");
  assert.strictEqual(out.hostedVerificationUrl, "https://verify.didit.me/s/x");

  // Officer snapshot was frozen with month/year birth.
  assert.strictEqual(createdWith.applicationId, "app-1");
  assert.strictEqual(createdWith.selectedOfficer.birthMonthYear, "1985-05");
  assert.strictEqual(createdWith.selectedOfficer.officerId, "off-1");

  // The binding is the server attempt id, not any browser value.
  assert.strictEqual(fetchBody.vendor_data, "attempt-abc");

  // The Didit session id is persisted back on the attempt.
  assert.strictEqual(updatedWith.id, "attempt-abc");
  assert.strictEqual(updatedWith.patch.diditSessionId, "sess-9");
  assert.strictEqual(updatedWith.patch.status, "session_created");
});
