"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// The Lab files work under a named workspace and refuses without one
// (api/evidence/tenant.js). Each test file runs in its own process.
process.env.EVIDENCE_LAB_TENANT_ID = "lab-tests";
const handler = require("../../../api/evidence/a3-interpret");
const configHandler = require("../../../api/evidence/a3-config");

function recorder() { return { headers: {}, statusCode: 0, body: null, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

test("live A3 API accepts Artifact identity but no browser bytes or storage reference", async () => {
  let received;
  const serviceDependencies = { repository: { async findArtifactForInterpretation(input) { received = input; return null; }, async appendInterpretation() {} }, artifactReader: { async read() { throw new Error("not called"); } }, provider: null };
  const api = handler.createHandler(async () => serviceDependencies); const res = recorder();
  await api({ method: "POST", body: { artifactIds: ["artifact-1", "artifact-2"], tenantId: "nium", bytes: "replacement", storageReference: "file:///secret" } }, res);
  // The tenant the browser named is ignored as well: the workspace is the server's.
  assert.equal(res.statusCode, 404); assert.deepEqual(received, { artifactId: "artifact-1", tenantId: "lab-tests", contextId: null });
});

test("A3 config exposes readiness but never credentials", () => {
  const oldKey = process.env.ANTHROPIC_API_KEY; const oldModel = process.env.EVIDENCE_A3_ANTHROPIC_MODEL;
  process.env.ANTHROPIC_API_KEY = "secret-test-value"; process.env.EVIDENCE_A3_ANTHROPIC_MODEL = "configured-model";
  const res = recorder(); configHandler({ method: "GET" }, res); const serialized = JSON.stringify(res.body);
  assert.equal(res.statusCode, 200); assert.equal(res.body.liveInterpretation.providerConfigured, true); assert.equal(serialized.includes("secret-test-value"), false); assert.equal(serialized.includes("configured-model"), false);
  if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = oldKey;
  if (oldModel === undefined) delete process.env.EVIDENCE_A3_ANTHROPIC_MODEL; else process.env.EVIDENCE_A3_ANTHROPIC_MODEL = oldModel;
});

test("the chart reading asks the configured model for medium effort and reports what the call used", async () => {
  const { AnthropicSemanticProvider, acceptsEffort } = require("../providers");
  let sent;
  const fetchImpl = async (_url, init) => { sent = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ model: "claude-sonnet-5-5", stop_reason: "end_turn", usage: { input_tokens: 1200, output_tokens: 3400 }, content: [{ type: "thinking", thinking: "..." }, { type: "text", text: JSON.stringify({ facts: [] }) }] }) }; };
  const provider = new AnthropicSemanticProvider({ apiKey: "test", model: "claude-sonnet-5-5", fetchImpl, effort: "medium", maxOutputTokens: 32000 });
  const result = await provider.extract({ decodedText: "{}", requestedConcepts: [], context: { schemaReference: "ownership-chart-extraction-v2" } });
  assert.deepEqual(sent.output_config, { effort: "medium" });
  assert.equal(sent.max_tokens, 32000);
  assert.deepEqual({ ...result.providerUsage, durationMs: 0 }, { model: "claude-sonnet-5-5", effort: "medium", inputTokens: 1200, outputTokens: 3400, durationMs: 0 });
  // An older model refuses effort outright, so it is never sent one.
  assert.equal(acceptsEffort("claude-sonnet-4-5"), false);
  const older = new AnthropicSemanticProvider({ apiKey: "test", model: "claude-sonnet-4-5", fetchImpl, effort: "medium" });
  await older.extract({ decodedText: "{}", requestedConcepts: [], context: { schemaReference: "ownership-chart-extraction-v2" } });
  assert.equal(sent.output_config, undefined);
});
