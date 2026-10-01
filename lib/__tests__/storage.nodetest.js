"use strict";

// The local filesystem store (no KV configured). Two ways it lost a
// developer's data on 2026-10-01, each pinned here.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const storage = require("../storage");

const ownFile = path.join(os.tmpdir(), `kyc-test-store-${process.pid}.json`);

test("a test process never writes the developer's own store", async () => {
  const key = `storage-nodetest:${process.pid}`;
  await storage.set(key, 1);
  assert.equal(await storage.get(key), 1);
  assert.ok(fs.existsSync(ownFile), "a test writes its own throwaway file");
  const developers = path.join(process.cwd(), ".config-store.json");
  if (fs.existsSync(developers)) assert.ok(!(key in JSON.parse(fs.readFileSync(developers, "utf8"))));
});

test("a store caught halfway through a write is refused, never read as empty and saved over", async () => {
  await storage.set("kept", "yes");
  fs.writeFileSync(ownFile, '{"kept": "y');
  await assert.rejects(storage.set("other", 1));
  fs.writeFileSync(ownFile, '{"kept": "yes"}');
  assert.equal(await storage.get("kept"), "yes");
});
