const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const research = require("../research");
const { buildDefaultConfig } = require("../../lib/seedConfig");
const { buildAnthropicRequest } = require("../../lib/researchPrompts");
const pipeline = require("../../src/pipeline");

const STORED = buildDefaultConfig("acme");
const DRAFT = { ...buildDefaultConfig("acme"), _draftMarker: true };

function fakeRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

function req(body, headers = { "x-tenant-id": "acme" }) {
  return { method: "POST", headers, query: {}, url: "/api/research", body };
}

const researchBody = (extra = {}) => ({
  mode: "research",
  companyName: "Britannia Group Limited",
  countryCode: "GB",
  countryName: "United Kingdom",
  entityType: "Corporate",
  ownershipType: "private_limited",
  registrationNumber: "01234567",
  ...extra,
});

const CLAUDE_OK = { content: [{ type: "text", text: "{\"found\":[]}" }], usage: { input_tokens: 10, output_tokens: 5 } };

let calls;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  calls = { fetch: [], cacheGet: [], cacheSave: [], readConfig: [], officers: [], inject: [] };
  research.__setDeps({
    fetch: async (url, init) => {
      calls.fetch.push({ url, init, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(CLAUDE_OK)) };
    },
    cache: {
      getCachedResearch: async (parts) => { calls.cacheGet.push(parts); return null; },
      saveResearchToCache: async (parts, data, model) => { calls.cacheSave.push({ parts, data, model }); },
    },
    officersLayer: {
      fetchOfficersLayer: async (input) => { calls.officers.push(input); return null; },
      injectOfficers: (data, officers) => { calls.inject.push(officers); },
    },
    enforceRateLimit: async () => true,
    readConfigForTenant: async (tenant) => { calls.readConfig.push(tenant); return tenant === "acme" ? STORED : null; },
    authorizeAdmin: async (tenant, token) => tenant === "acme" && token === "admin-secret",
  });
});

test("rejects every client-authored prompt field before any work", async () => {
  for (const key of ["prompt", "messages", "model", "tools", "max_tokens"]) {
    const res = fakeRes();
    await research(req(researchBody({ [key]: "x" })), res);
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.body, { error: "client_prompt_not_allowed" });
  }
  assert.strictEqual(calls.fetch.length, 0);
  assert.strictEqual(calls.readConfig.length, 0);
});

test("a request with no tenant is refused", async () => {
  const res = fakeRes();
  await research(req(researchBody(), {}), res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "tenant_required" });
});

test("an unknown tenant is a 404 and nothing is spent", async () => {
  const res = fakeRes();
  await research(req(researchBody(), { "x-tenant-id": "ghost" }), res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "tenant_not_found" });
  assert.strictEqual(calls.fetch.length, 0);
});

test("a rate-limited caller gets the limiter's 429 and nothing else happens", async () => {
  research.__setDeps({ enforceRateLimit: async (_req, res) => { res.status(429).json({ error: "rate_limited", retryAfterSeconds: 60 }); return false; } });
  const res = fakeRes();
  await research(req(researchBody()), res);
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(calls.readConfig.length, 0);
  assert.strictEqual(calls.fetch.length, 0);
});

test("research: prompt, model and tools are built from the stored tenant config", async () => {
  const res = fakeRes();
  await research(req(researchBody()), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, CLAUDE_OK);
  assert.strictEqual(calls.fetch.length, 1);
  const expected = buildAnthropicRequest(researchBody(), STORED).requestBody;
  assert.deepStrictEqual(calls.fetch[0].body, expected);
  assert.strictEqual(calls.fetch[0].init.headers["x-api-key"], "test-key");
  assert.deepStrictEqual(calls.fetch[0].body.tools, pipeline.RESEARCH_TOOLS);
  assert.deepStrictEqual(calls.officers, [{ companyName: "Britannia Group Limited", jurisdiction: "GB", registrationNumber: "01234567" }]);
});

test("research: the cache key carries tenant, country name, ownership type and registration number", async () => {
  const res = fakeRes();
  await research(req(researchBody()), res);
  const parts = {
    tenant: "acme",
    companyName: "Britannia Group Limited",
    jurisdiction: "GB",
    countryName: "United Kingdom",
    entityType: "Corporate",
    ownershipType: "private_limited",
    registrationNumber: "01234567",
  };
  assert.deepStrictEqual(calls.cacheGet, [parts]);
  assert.deepStrictEqual(calls.cacheSave[0].parts, parts);
  assert.strictEqual(calls.cacheSave[0].model, "claude-sonnet-4-5");
});

test("research: wolfsbergFields present is never read from or written to the cache", async () => {
  const res = fakeRes();
  await research(req(researchBody({ wolfsbergFields: { legal_name: "Britannia Group Limited" } })), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.cacheGet.length, 0);
  assert.strictEqual(calls.cacheSave.length, 0);
  assert.strictEqual(calls.fetch.length, 1);
});

test("research: sourcedDocuments present is never read from or written to the cache", async () => {
  const res = fakeRes();
  await research(req(researchBody({
    sourcedDocuments: [{ label: "AR", year: 2024, sourceUrl: "https://example.com/ar.pdf", sourceLabel: "Web" }],
  })), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.cacheGet.length, 0);
  assert.strictEqual(calls.cacheSave.length, 0);
  assert.strictEqual(calls.fetch.length, 1);
});

test("research: a cache hit is served without calling Anthropic", async () => {
  research.__setDeps({
    cache: {
      getCachedResearch: async () => ({ content: [], _fromCache: true, _cachedAt: "2026-09-01" }),
      saveResearchToCache: async () => { throw new Error("must not save on a hit"); },
    },
  });
  const res = fakeRes();
  await research(req(researchBody()), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body._fromCache, true);
  assert.strictEqual(calls.fetch.length, 0);
});

test("research: forceRefresh skips the lookup but still saves", async () => {
  const res = fakeRes();
  await research(req(researchBody({ forceRefresh: true })), res);
  assert.strictEqual(calls.cacheGet.length, 0);
  assert.strictEqual(calls.cacheSave.length, 1);
  assert.strictEqual(calls.fetch.length, 1);
});

test("research: a cache failure falls through to the live call", async () => {
  research.__setDeps({
    cache: {
      getCachedResearch: async () => { throw new Error("db down"); },
      saveResearchToCache: async () => { throw new Error("db down"); },
    },
  });
  const res = fakeRes();
  await research(req(researchBody()), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.fetch.length, 1);
});

test("draftConfig is ignored without a valid admin token", async () => {
  for (const headers of [{ "x-tenant-id": "acme" }, { "x-tenant-id": "acme", "x-admin-token": "wrong" }]) {
    calls.readConfig = [];
    const res = fakeRes();
    await research(req(researchBody({ draftConfig: DRAFT }), headers), res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(calls.readConfig, ["acme"]);
  }
});

test("draftConfig is honoured with a valid admin token and bypasses the cache", async () => {
  calls.cacheGet = [];
  calls.cacheSave = [];
  const res = fakeRes();
  await research(req(researchBody({ draftConfig: DRAFT }), { "x-tenant-id": "acme", "x-admin-token": "admin-secret" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.readConfig.length, 0);
  assert.strictEqual(calls.cacheGet.length, 0);
  assert.strictEqual(calls.cacheSave.length, 0);
  assert.deepStrictEqual(calls.fetch[0].body, buildAnthropicRequest(researchBody(), DRAFT).requestBody);
});

test("gap_recovery: server-built, never cached, no officers layer", async () => {
  const schema = pipeline.getSchemaFromConfig("GB", "Corporate", STORED);
  const body = {
    mode: "gap_recovery",
    companyName: "Britannia Group Limited",
    countryCode: "GB",
    countryName: "United Kingdom",
    entityType: "Corporate",
    ownershipType: "private_limited",
    missingFields: [schema.researchFields[0].field],
    upgradeableFields: [],
  };
  const res = fakeRes();
  await research(req(body), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(calls.fetch[0].body, buildAnthropicRequest(body, STORED).requestBody);
  assert.strictEqual(calls.cacheGet.length + calls.cacheSave.length, 0);
  assert.strictEqual(calls.officers.length, 0);
});

test("extract_document: server-built, no tools, never cached", async () => {
  const body = { mode: "extract_document", docKey: "certificate", file: { mediaType: "application/pdf", base64: "JVBERi0=" } };
  const res = fakeRes();
  await research(req(body), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.fetch[0].body.tools, undefined);
  assert.strictEqual(calls.fetch[0].body.max_tokens, 4096);
  assert.strictEqual(calls.cacheGet.length + calls.cacheSave.length, 0);
});

test("invalid structured input is a 400 with the builder's code", async () => {
  const res = fakeRes();
  await research(req({ mode: "extract_document", docKey: "nope", file: {} }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "invalid_doc_key" });
  assert.strictEqual(calls.fetch.length, 0);
});

test("an Anthropic error passes its status and details through", async () => {
  research.__setDeps({
    fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: { type: "rate_limit_error", message: "slow down" } }) }),
  });
  const res = fakeRes();
  await research(req(researchBody()), res);
  assert.strictEqual(res.statusCode, 429);
  assert.deepStrictEqual(res.body, { error: "Claude API error", details: { error: { type: "rate_limit_error", message: "slow down" } } });
});

test("an unexpected failure is a 500 without the raw message", async () => {
  research.__setDeps({ fetch: async () => { throw new Error("socket hang up at 10.0.0.1"); } });
  const res = fakeRes();
  await research(req(researchBody()), res);
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(res.body, { error: "research_failed" });
});

test("a missing API key is reported before any Anthropic call", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const res = fakeRes();
  await research(req(researchBody()), res);
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(res.body, { error: "Server API key not configured" });
  assert.strictEqual(calls.fetch.length, 0);
});

test("non-POST methods are refused", async () => {
  const res = fakeRes();
  await research({ method: "GET", headers: {}, query: {}, url: "/api/research" }, res);
  assert.strictEqual(res.statusCode, 405);
});
