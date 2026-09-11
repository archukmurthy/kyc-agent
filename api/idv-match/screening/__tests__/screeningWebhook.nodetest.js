"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { processScreeningWebhook } = require("../webhook");

test("a completion webhook re-resolves the band for the attempt", async () => {
  let resolved = null;
  const deps = {
    verifyEvent: () => ({ type: "check.completed", payload: { id: "chk_1" } }),
    store: {
      getByCheckId: async () => ({ id: "scr_1", attempt_id: "att_9" }),
      updateScreeningResult: async () => {},
    },
    getCheck: async () => ({ id: "chk_1", status: "complete", result: { outcome: "attention", breakdown: { summary: { pep: { pep: "attention" } }, matches: [{}] } } }),
    resolveAttempt: async (attemptId) => { resolved = attemptId; return { enabled: true, band: "A" }; },
  };
  const out = await processScreeningWebhook({ rawBody: "{}", signature: "sig", secret: "shh" }, deps);
  assert.equal(out.statusCode, 200);
  assert.equal(resolved, "att_9");
});

test("a re-resolve failure is swallowed — the webhook still reports success", async () => {
  const deps = {
    verifyEvent: () => ({ type: "check.completed", payload: { id: "chk_1" } }),
    store: {
      getByCheckId: async () => ({ id: "scr_1", attempt_id: "att_9" }),
      updateScreeningResult: async () => {},
    },
    getCheck: async () => ({ id: "chk_1", status: "complete", result: { outcome: "attention", breakdown: { summary: { pep: { pep: "attention" } }, matches: [{}] } } }),
    resolveAttempt: async () => { throw new Error("boom"); },
  };
  const out = await processScreeningWebhook({ rawBody: "{}", signature: "sig", secret: "shh" }, deps);
  assert.equal(out.statusCode, 200);
});
