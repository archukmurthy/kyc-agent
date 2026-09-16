const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const cache = require("../researchCache");

function fakeNeon(rows) {
  const log = [];
  const sql = (strings, ...values) => {
    log.push({ text: strings.join("?"), values });
    const p = Promise.resolve(/^\s*SELECT/i.test(strings[0]) ? rows : []);
    return p;
  };
  return { log, neon: () => sql };
}

const PARTS = {
  tenant: "Acme",
  companyName: " Stripe UK ",
  jurisdiction: "GB",
  entityType: "Corporate",
  ownershipType: "private_limited",
  registrationNumber: "SC123",
};

beforeEach(() => { process.env.DATABASE_URL = "postgres://test"; });

test("the key includes tenant, ownership type and registration number, normalised", () => {
  assert.strictEqual(cache.buildCacheKey(PARTS), "acme|stripe uk|gb|corporate|private_limited|sc123");
});

test("the key changes when any of tenant, ownership type or registration number changes", () => {
  const base = cache.buildCacheKey(PARTS);
  assert.notStrictEqual(cache.buildCacheKey({ ...PARTS, tenant: "other" }), base);
  assert.notStrictEqual(cache.buildCacheKey({ ...PARTS, ownershipType: "public_listed" }), base);
  assert.notStrictEqual(cache.buildCacheKey({ ...PARTS, registrationNumber: "" }), base);
});

test("missing parts become empty segments, never 'undefined'", () => {
  assert.strictEqual(cache.buildCacheKey({ tenant: "acme", companyName: "X" }), "acme|x||||");
});

test("a hit is returned with cache markers and queried by the full key", async () => {
  const fake = fakeNeon([{ research_result: { content: [] }, fetched_at: "2026-09-01", expires_at: "2026-10-01", hit_count: 2 }]);
  cache.__setDeps({ neon: fake.neon });
  const hit = await cache.getCachedResearch(PARTS);
  assert.deepStrictEqual(hit, { content: [], _fromCache: true, _cachedAt: "2026-09-01", _cacheHits: 3 });
  assert.ok(fake.log[0].values.includes("acme|stripe uk|gb|corporate|private_limited|sc123"));
});

test("a miss returns null", async () => {
  cache.__setDeps({ neon: fakeNeon([]).neon });
  assert.strictEqual(await cache.getCachedResearch(PARTS), null);
});

test("save writes the full key", async () => {
  const fake = fakeNeon([]);
  cache.__setDeps({ neon: fake.neon });
  await cache.saveResearchToCache(PARTS, { content: [] }, "claude-sonnet-4-5");
  assert.ok(fake.log[0].values.includes("acme|stripe uk|gb|corporate|private_limited|sc123"));
});

test("no DATABASE_URL throws so the caller can fall through to the live API", async () => {
  delete process.env.DATABASE_URL;
  await assert.rejects(() => cache.getCachedResearch(PARTS), /DATABASE_URL not set/);
});
