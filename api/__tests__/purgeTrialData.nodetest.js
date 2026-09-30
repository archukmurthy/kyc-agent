"use strict";

// The route that deletes non-buyers' trial data every day. It deletes for
// real, so it opens for the scheduler's secret and for nothing else - and,
// unlike api/finalize-submissions.js (CRON-1), an unset secret refuses
// everyone rather than letting everyone in.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const route = require("../purge-trial-data");

function fakeRes() {
  return {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader() { return this; },
    json(value) { this.body = value; return this; },
  };
}

let runs;
let saved;
function handler() {
  return route.createHandler({
    connect: () => ({ db: {}, deleteFile: async () => {}, close: async () => {} }),
    runTrialPurge: async (options) => { runs.push(options); return { deleted: [], failed: [], planned: [] }; },
  });
}
beforeEach(() => { runs = []; saved = process.env.CRON_SECRET; });
afterEach(() => { if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved; });

test("with no scheduler secret configured, nobody can run it", async () => {
  delete process.env.CRON_SECRET;
  const res = fakeRes();
  await handler()({ method: "GET", headers: { authorization: "Bearer " }, query: {} }, res);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(runs, []);
});

test("a wrong secret is refused", async () => {
  process.env.CRON_SECRET = "the-real-secret";
  const res = fakeRes();
  await handler()({ method: "GET", headers: { authorization: "Bearer a-guess" }, query: {} }, res);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(runs, []);
});

test("the scheduler runs it", async () => {
  process.env.CRON_SECRET = "the-real-secret";
  const res = fakeRes();
  await handler()({ method: "GET", headers: { authorization: "Bearer the-real-secret" }, query: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].dryRun, false);
});

test("a dry run can be asked for, and deletes nothing", async () => {
  process.env.CRON_SECRET = "the-real-secret";
  await handler()({ method: "GET", headers: { authorization: "Bearer the-real-secret" }, query: { dryRun: "1" } }, fakeRes());
  assert.strictEqual(runs[0].dryRun, true);
});
