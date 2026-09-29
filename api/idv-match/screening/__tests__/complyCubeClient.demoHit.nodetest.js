"use strict";

// DEMO-ONLY force-hit affordance: proves the sandbox trigger word CAN be
// injected under mode=test + the flag, and — the safety-critical case —
// CANNOT fire when mode=live, even with the flag set.
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const { createClient } = require("../complyCubeClient");

const saved = {
  runtimeMode: process.env.SCREENING_RUNTIME_MODE,
  forceHit: process.env.SCREENING_DEMO_FORCE_HIT,
};
afterEach(() => {
  if (saved.runtimeMode === undefined) delete process.env.SCREENING_RUNTIME_MODE;
  else process.env.SCREENING_RUNTIME_MODE = saved.runtimeMode;
  if (saved.forceHit === undefined) delete process.env.SCREENING_DEMO_FORCE_HIT;
  else process.env.SCREENING_DEMO_FORCE_HIT = saved.forceHit;
});

function stubClient() {
  const calls = {};
  return {
    calls,
    cc: {
      client: { create: async (req) => { calls.clientReq = req; return { id: "cc-client-1" }; } },
    },
  };
}

test("demoHit: mode=test + flag=1 overrides lastName to 'attention'", async () => {
  process.env.SCREENING_RUNTIME_MODE = "test";
  process.env.SCREENING_DEMO_FORCE_HIT = "1";
  const { cc, calls } = stubClient();
  await createClient({ firstName: "Jane", lastName: "Smith" }, { client: cc });
  assert.strictEqual(calls.clientReq.personDetails.lastName, "attention");
  assert.strictEqual(calls.clientReq.personDetails.firstName, "Jane");
});

test("demoHit: mode=test + flag unset leaves lastName untouched", async () => {
  process.env.SCREENING_RUNTIME_MODE = "test";
  delete process.env.SCREENING_DEMO_FORCE_HIT;
  const { cc, calls } = stubClient();
  await createClient({ firstName: "Jane", lastName: "Smith" }, { client: cc });
  assert.strictEqual(calls.clientReq.personDetails.lastName, "Smith");
});

test("demoHit: mode=live + flag=1 is IGNORED — override never fires in live mode", async () => {
  process.env.SCREENING_RUNTIME_MODE = "live";
  process.env.SCREENING_DEMO_FORCE_HIT = "1";
  const { cc, calls } = stubClient();
  // deps.client is injected so realClient()/assertKeyMatchesMode is never
  // invoked (no live API key needed to exercise this branch).
  await createClient({ firstName: "Jane", lastName: "Smith" }, { client: cc });
  assert.strictEqual(calls.clientReq.personDetails.lastName, "Smith");
});
