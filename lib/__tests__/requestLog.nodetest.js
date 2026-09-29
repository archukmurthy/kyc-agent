"use strict";

// One request, one id, one log line you can find.
//
// The test that matters most is the last one: a log line that quietly carries a
// customer's data is worse than no log line, because it looks like diligence.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const requestLog = require("../requestLog");

let lines;
const realError = console.error;
beforeEach(() => {
  lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  requestLog.__setDeps({ now: () => "2026-09-22T10:00:00.000Z" });
});
afterEach(() => { console.error = realError; });

function req(overrides = {}) {
  return { method: "POST", url: "/api/ubo-people?action=list&secret=hunter2", headers: {}, ...overrides };
}

test("the platform's own id is used where there is one", async () => {
  // So our line and Vercel's line describe the same request.
  const id = requestLog.requestId(req({ headers: { "x-vercel-id": "lhr1::iad1::abcdef1234567890" } }));
  assert.equal(id, "abcdef1234567890");
});

test("without one, an id is invented, and it stays the same all request", () => {
  const r = req();
  const first = requestLog.requestId(r);
  assert.match(first, /^[0-9a-f]{12}$/);
  assert.equal(requestLog.requestId(r), first, "two different ids for one request is worse than none");
});

test("a failure writes one structured line, and returns the reference", () => {
  const error = new Error("storage unavailable");
  error.code = "kv_down";
  const id = requestLog.logFailure("ubo-people", error, req(), { tenantId: "acme", userId: "user_1", status: 500 });

  assert.equal(lines.length, 1);
  const line = JSON.parse(lines[0]);
  assert.equal(line.requestId, id);
  assert.equal(line.scope, "ubo-people");
  assert.equal(line.code, "kv_down");
  assert.equal(line.status, 500);
  assert.equal(line.tenantId, "acme");
  assert.equal(line.at, "2026-09-22T10:00:00.000Z");
});

test("the query string never reaches the log", () => {
  // Whatever a caller put in the URL is theirs, and often nobody's business.
  requestLog.logFailure("ubo-people", new Error("boom"), req());
  const line = JSON.parse(lines[0]);
  assert.equal(line.route, "/api/ubo-people");
  assert.ok(!lines[0].includes("hunter2"));
});

test("the reference reaches the caller in a header", () => {
  const r = req();
  const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } };
  const id = requestLog.attachRequestId(r, res);
  assert.equal(res.headers["x-request-id"], id);
});

test("headers already sent do not turn bookkeeping into an outage", () => {
  const res = { setHeader() { throw new Error("headers already sent"); } };
  assert.doesNotThrow(() => requestLog.attachRequestId(req(), res));
});

test("nothing a person typed can reach the log", () => {
  // A log line carrying a customer's data is worse than no log line: it looks
  // like diligence. Only ids, the route, and what went wrong.
  const error = new Error("boom");
  requestLog.logFailure("ubo-discovery", error, {
    method: "POST",
    url: "/api/ubo-discovery",
    headers: { authorization: "Bearer sk_live_secret", cookie: "session=abc" },
    body: { companyName: "Barclays PLC", email: "someone@bank.test", registrationNumber: "01026167" },
  }, { tenantId: "trial-acme-1234" });

  const written = lines[0];
  for (const secret of ["Bearer", "sk_live_secret", "session=abc", "Barclays", "someone@bank.test", "01026167"]) {
    assert.ok(!written.includes(secret), `the log must not carry ${secret}`);
  }
  assert.deepEqual(Object.keys(JSON.parse(written)).sort(), [
    "at", "code", "level", "message", "method", "requestId", "route", "scope", "status", "tenantId", "userId",
  ]);
});

test("a long error message is cut rather than pasted whole", () => {
  requestLog.logFailure("ubo-people", new Error("x".repeat(5000)), req());
  assert.equal(JSON.parse(lines[0]).message.length, 300);
});
