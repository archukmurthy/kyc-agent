"use strict";

// 2026-10-09: with no timeouts a dropped connection hung a read for about
// fourteen minutes, and an idle connection was reused after Neon paused the
// database. These pin the pool's settings and the transaction's error handling.

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function withFakePool(behaviour) {
  const seen = { options: null, listeners: {}, released: [] };
  class FakePool {
    constructor(options) { seen.options = options; }
    on(event, listener) { seen.listeners[event] = listener; }
    query() { return Promise.resolve({ rows: [] }); }
    async connect() {
      return { query: async (sql) => behaviour(sql), release: (error) => seen.released.push(error) };
    }
    end() { return Promise.resolve(); }
  }
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === "@neondatabase/serverless") return { Pool: FakePool };
    return original.call(this, request, ...rest);
  };
  delete require.cache[require.resolve("../postgresDb.js")];
  try { return { ...require("../postgresDb.js"), seen }; } finally { Module._load = original; }
}

test("the pool has connect, idle and query limits, and listens for lost idle connections", () => {
  const { createPostgresDb, DEFAULT_TIMEOUTS, seen } = withFakePool(() => ({}));
  createPostgresDb("postgres://example");
  assert.equal(seen.options.connectionTimeoutMillis, DEFAULT_TIMEOUTS.connectMs);
  assert.equal(seen.options.idleTimeoutMillis, DEFAULT_TIMEOUTS.idleMs);
  assert.equal(seen.options.query_timeout, DEFAULT_TIMEOUTS.queryMs);
  assert.equal(typeof seen.listeners.error, "function");
});

test("a transaction whose connection died reports the original error and does not reuse the connection", async () => {
  const lost = new Error("Connection terminated unexpectedly");
  const { createPostgresDb, seen } = withFakePool((sql) => {
    if (sql === "ROLLBACK") throw new Error("cannot roll back on a dead connection");
    return {};
  });
  const db = createPostgresDb("postgres://example");
  await assert.rejects(() => db.transaction(async () => { throw lost; }), (error) => error === lost);
  assert.ok(seen.released[0] instanceof Error, "a broken connection is released with its error, so it is destroyed");
});

test("a transaction that rolls back cleanly returns its connection for reuse", async () => {
  const { createPostgresDb, seen } = withFakePool(() => ({}));
  const db = createPostgresDb("postgres://example");
  await assert.rejects(() => db.transaction(async () => { throw new Error("work failed"); }));
  assert.equal(seen.released[0], undefined);
});
