"use strict";

// Calling a paid provider safely.
//
// Five call sites reach api.anthropic.com and not one of them sets a timeout.
// A provider that accepts the connection and then goes quiet holds a serverless
// function open until the platform kills it - we pay for the wall-clock, the
// caller sees nothing, and the retry makes it worse.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const providerCall = require("../providerCall");

let clock;
beforeEach(() => {
  clock = 0;
  providerCall.__setDeps({ now: () => clock });
});

test("a normal response comes back untouched", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ hello: "world" }) });
  const response = await providerCall.fetchWithTimeout("https://api.example.com", {}, { fetchImpl });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { hello: "world" });
});

test("a provider that never answers is abandoned, with a clear error", async () => {
  // Never resolves, like a connection that is accepted and then ignored.
  const fetchImpl = (url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason));
    });

  await assert.rejects(
    () => providerCall.fetchWithTimeout("https://api.example.com", {}, { fetchImpl, timeoutMs: 20 }),
    (err) => {
      assert.match(err.message, /timed out after 20ms/);
      assert.equal(err.code, "provider_timeout");
      return true;
    }
  );
});

test("the caller's own abort signal still works", async () => {
  // A request the user navigated away from should stop, not wait for our
  // timeout to expire.
  const controller = new AbortController();
  const fetchImpl = (url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted by caller")));
    });

  const promise = providerCall.fetchWithTimeout(
    "https://api.example.com",
    { signal: controller.signal },
    { fetchImpl, timeoutMs: 10_000 }
  );
  controller.abort();
  await assert.rejects(promise, /aborted/);
});

test("the timer is cleared once the call returns", async () => {
  // A left-running timer keeps the process alive after the work is done, which
  // on a serverless platform means paying for an idle function.
  const fetchImpl = async () => ({ ok: true, status: 200 });
  const before = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  await providerCall.fetchWithTimeout("https://api.example.com", {}, { fetchImpl, timeoutMs: 60_000 });
  const after = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  assert.equal(after, before, "no timer may outlive the call");
});

test("the default timeout is sane for a research call, and overridable", () => {
  assert.ok(providerCall.DEFAULT_TIMEOUT_MS >= 30_000, "research with web search legitimately takes tens of seconds");
  assert.ok(providerCall.DEFAULT_TIMEOUT_MS <= 120_000, "but not minutes - the platform kills the function anyway");
});

test("a timeout is reported as the provider's fault, not the caller's", async () => {
  const fetchImpl = (url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason));
    });
  try {
    await providerCall.fetchWithTimeout("https://api.example.com", {}, { fetchImpl, timeoutMs: 5 });
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(err.status, 504, "a gateway timeout, so a 4xx is never blamed on the user");
  }
});
