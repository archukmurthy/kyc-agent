"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { FileArtifactStore, MemoryArtifactStore } = require("../../a2/artifactStore");
const { EvidenceArtifactReader } = require("../artifactReader");

test("A2 memory and filesystem stores expose bounded server-side reads", async () => {
  const memory = new MemoryArtifactStore(); await memory.put("safe/key.json", Buffer.from("memory"), "application/json"); assert.equal((await memory.read("safe/key.json")).bytes.toString(), "memory");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-a3-read-"));
  try { const store = new FileArtifactStore(root); const stored = await store.put("evidence/key.html", Buffer.from("file")); assert.equal((await store.read(stored.key)).bytes.toString(), "file"); await assert.rejects(() => store.read("../outside"), /Unsafe artifact storage key/); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("Evidence Artifact reader does not accept browser paths or arbitrary providers", async () => {
  const reader = new EvidenceArtifactReader();
  await assert.rejects(() => reader.read({ storageProvider: "browser_url", storageKey: "https://example.test/replacement" }), (e) => e.code === "artifact_storage_unavailable");
});
