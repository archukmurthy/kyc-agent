"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../../../api/evidence/a3-interpret");
const configHandler = require("../../../api/evidence/a3-config");

function recorder() { return { headers: {}, statusCode: 0, body: null, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

test("live A3 API accepts Artifact identity but no browser bytes or storage reference", async () => {
  let received;
  const serviceDependencies = { repository: { async findArtifactForInterpretation(input) { received = input; return null; }, async appendInterpretation() {} }, artifactReader: { async read() { throw new Error("not called"); } }, provider: null };
  const api = handler.createHandler(async () => serviceDependencies); const res = recorder();
  await api({ method: "POST", body: { artifactIds: ["artifact-1", "artifact-2"], tenantId: "nium", bytes: "replacement", storageReference: "file:///secret" } }, res);
  assert.equal(res.statusCode, 404); assert.deepEqual(received, { artifactId: "artifact-1", tenantId: "nium", contextId: null });
});

test("A3 config exposes readiness but never credentials", () => {
  const oldKey = process.env.ANTHROPIC_API_KEY; const oldModel = process.env.EVIDENCE_A3_ANTHROPIC_MODEL;
  process.env.ANTHROPIC_API_KEY = "secret-test-value"; process.env.EVIDENCE_A3_ANTHROPIC_MODEL = "configured-model";
  const res = recorder(); configHandler({ method: "GET" }, res); const serialized = JSON.stringify(res.body);
  assert.equal(res.statusCode, 200); assert.equal(res.body.liveInterpretation.providerConfigured, true); assert.equal(serialized.includes("secret-test-value"), false); assert.equal(serialized.includes("configured-model"), false);
  if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = oldKey;
  if (oldModel === undefined) delete process.env.EVIDENCE_A3_ANTHROPIC_MODEL; else process.env.EVIDENCE_A3_ANTHROPIC_MODEL = oldModel;
});
