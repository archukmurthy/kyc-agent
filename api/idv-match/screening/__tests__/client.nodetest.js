const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const { screeningConfig, assertKeyMatchesMode } = require("../config");
const { createClient, createScreeningCheck, getCheck, SCREENING_CHECK_TYPE } = require("../complyCubeClient");

const saved = {
  key: process.env.COMPLYCUBE_API_KEY,
  mode: process.env.SCREENING_RUNTIME_MODE,
  provider: process.env.SCREENING_DEFAULT_PROVIDER,
};
afterEach(() => {
  process.env.COMPLYCUBE_API_KEY = saved.key ?? "";
  process.env.SCREENING_RUNTIME_MODE = saved.mode ?? "";
  process.env.SCREENING_DEFAULT_PROVIDER = saved.provider ?? "";
});

// --- config guard ---
test("screeningConfig defaults to complycube + test mode", () => {
  delete process.env.SCREENING_DEFAULT_PROVIDER;
  delete process.env.SCREENING_RUNTIME_MODE;
  const c = screeningConfig();
  assert.strictEqual(c.provider, "complycube");
  assert.strictEqual(c.mode, "test");
});

test("assertKeyMatchesMode blocks a mode/key-environment mismatch", () => {
  assert.throws(() => assertKeyMatchesMode({ mode: "test", apiKey: "live_abc" }), /test requires a test_/);
  assert.throws(() => assertKeyMatchesMode({ mode: "live", apiKey: "test_abc" }), /live requires a live_/);
  assert.throws(() => assertKeyMatchesMode({ mode: "test", apiKey: "" }), /COMPLYCUBE_API_KEY not set/);
  assert.doesNotThrow(() => assertKeyMatchesMode({ mode: "test", apiKey: "test_abc" }));
});

// --- SDK wrapper (stubbed ComplyCube instance, no network) ---
function stubClient() {
  const calls = {};
  return {
    calls,
    cc: {
      client: { create: async (req) => { calls.clientReq = req; return { id: "cc-client-1" }; } },
      check: {
        create: async (clientId, req) => { calls.check = { clientId, req }; return { id: "cc-check-1", status: "pending" }; },
        get: async (id) => { calls.getId = id; return { id, status: "complete" }; },
      },
    },
  };
}

test("createClient builds a person client with name/DOB and requires a name", async () => {
  const { cc, calls } = stubClient();
  const out = await createClient({ firstName: "John", lastName: "Doe", dob: "1990-01-01", nationality: "GB" }, { client: cc });
  assert.strictEqual(out.id, "cc-client-1");
  assert.strictEqual(calls.clientReq.type, "person");
  assert.strictEqual(calls.clientReq.personDetails.firstName, "John");
  assert.strictEqual(calls.clientReq.personDetails.dob, "1990-01-01");
  assert.ok(calls.clientReq.email, "email is always supplied (ComplyCube requires it)");
  await assert.rejects(createClient({ firstName: "John" }, { client: cc }), /firstName and lastName are required/);
});

test("createClient normalizes an ISO-3 nationality to ISO-2 before sending to ComplyCube", async () => {
  const { cc, calls } = stubClient();
  await createClient({ firstName: "John", lastName: "Doe", nationality: "POL" }, { client: cc });
  assert.strictEqual(calls.clientReq.personDetails.nationality, "PL");
});

test("createClient omits nationality entirely when it's not a code ComplyCube accepts", async () => {
  const { cc, calls } = stubClient();
  await createClient({ firstName: "John", lastName: "Doe", nationality: "ZZ" }, { client: cc });
  assert.ok(!("nationality" in calls.clientReq.personDetails));
});

test("createClient omits nationality when none was supplied", async () => {
  const { cc, calls } = stubClient();
  await createClient({ firstName: "John", lastName: "Doe" }, { client: cc });
  assert.ok(!("nationality" in calls.clientReq.personDetails));
});

test("createScreeningCheck runs an extensive_screening_check against the client", async () => {
  const { cc, calls } = stubClient();
  const out = await createScreeningCheck("cc-client-1", { client: cc });
  assert.strictEqual(out.id, "cc-check-1");
  assert.strictEqual(calls.check.clientId, "cc-client-1");
  assert.strictEqual(calls.check.req.type, SCREENING_CHECK_TYPE);
});

test("getCheck fetches by id and guards a missing id", async () => {
  const { cc, calls } = stubClient();
  const out = await getCheck("cc-check-1", { client: cc });
  assert.strictEqual(calls.getId, "cc-check-1");
  assert.strictEqual(out.status, "complete");
  await assert.rejects(getCheck(null, { client: cc }), /checkId is required/);
});
