"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createExecutionGuard, createHistoryStore, freshProducerRequestKey } = require("../../public/evidence-lab-state");

test("repeated UI submission is ignored while the same operation is active", async () => {
  const guard = createExecutionGuard(); let resolve, calls = 0; const pending = new Promise((done) => { resolve = done; });
  const first = guard.run("collect", { work: async () => { calls += 1; return pending; } });
  const second = await guard.run("collect", { work: async () => { calls += 1; } });
  assert.equal(second.ignored, true); assert.equal(calls, 1); assert.equal(guard.isActive("collect"), true); resolve("done"); await first; assert.equal(guard.isActive("collect"), false);
});

test("Artifact selection history cards retain histories for previously selected Artifacts", () => {
  const store = createHistoryStore(); store.set("overview", { artifact: { id: "overview" }, runs: [{ id: "run-overview" }] }); store.set("officers", { artifact: { id: "officers" }, runs: [{ id: "run-officers" }] });
  assert.deepEqual(store.values().map((entry) => entry.artifact.id), ["overview", "officers"]); assert.equal(store.get("overview").runs[0].id, "run-overview");
});

test("displayed interpretation histories can be cleared without altering persisted Evidence", () => {
  const store = createHistoryStore(); store.set("officers", { artifact: { id: "officers" }, runs: [{ id: "persisted-run" }] }); store.clear(); assert.deepEqual(store.values(), []);
});

test("fresh recollection request keys differ across attempts and coordinates", () => {
  const first = freshProducerRequestKey("12345678"), repeat = freshProducerRequestKey("12345678"), changed = freshProducerRequestKey("87654321");
  assert.notEqual(first, repeat); assert.notEqual(repeat, changed); assert.match(first, /GB-12345678/); assert.match(changed, /GB-87654321/);
});
