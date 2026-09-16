const { test } = require("node:test");
const assert = require("node:assert");
const registry = require("../tenantRegistry");

function fakeStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    data,
    async get(key) { return key in data ? data[key] : null; },
    async set(key, value) { data[key] = value; },
  };
}

test("readRegistry returns [] when nothing is stored", async () => {
  registry.__setDeps({ storage: fakeStorage() });
  assert.deepStrictEqual(await registry.readRegistry(), []);
});

test("tenantExists is true only for registered ids", async () => {
  registry.__setDeps({ storage: fakeStorage({ "tenant-registry": [{ tenantId: "acme" }] }) });
  assert.strictEqual(await registry.tenantExists("acme"), true);
  assert.strictEqual(await registry.tenantExists("acmee"), false);
});

test("isTenantActive is false for unknown tenants and for isActive:false", async () => {
  registry.__setDeps({ storage: fakeStorage({ "tenant-registry": [
    { tenantId: "acme", isActive: true },
    { tenantId: "dormant", isActive: false },
    { tenantId: "legacy" },
  ] }) });
  assert.strictEqual(await registry.isTenantActive("acme"), true);
  assert.strictEqual(await registry.isTenantActive("dormant"), false);
  assert.strictEqual(await registry.isTenantActive("legacy"), true);
  assert.strictEqual(await registry.isTenantActive("ghost"), false);
});

test("isPreboardingEnabled requires an explicit true", async () => {
  registry.__setDeps({ storage: fakeStorage({ "tenant-registry": [
    { tenantId: "on", preboardingEnabled: true },
    { tenantId: "off", preboardingEnabled: false },
    { tenantId: "unset" },
  ] }) });
  assert.strictEqual(await registry.isPreboardingEnabled("on"), true);
  assert.strictEqual(await registry.isPreboardingEnabled("off"), false);
  assert.strictEqual(await registry.isPreboardingEnabled("unset"), false);
  assert.strictEqual(await registry.isPreboardingEnabled("ghost"), false);
});

test("isProtectedTenant honours isProtected and legacy isInternal", async () => {
  registry.__setDeps({ storage: fakeStorage({ "tenant-registry": [
    { tenantId: "flagged", isProtected: true },
    { tenantId: "legacy-internal", isInternal: true },
    { tenantId: "plain" },
  ] }) });
  assert.strictEqual(await registry.isProtectedTenant("flagged"), true);
  assert.strictEqual(await registry.isProtectedTenant("legacy-internal"), true);
  assert.strictEqual(await registry.isProtectedTenant("plain"), false);
});

test("upsertEntry patches an existing entry and appends a new one", async () => {
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme", isActive: true }] });
  registry.__setDeps({ storage });
  await registry.upsertEntry("acme", { preboardingEnabled: true });
  await registry.upsertEntry("new-co", { companyName: "New Co" });
  const stored = storage.data["tenant-registry"];
  assert.deepStrictEqual(stored[0], { tenantId: "acme", isActive: true, preboardingEnabled: true });
  assert.deepStrictEqual(stored[1], { tenantId: "new-co", companyName: "New Co" });
});

test("a storage failure degrades to an empty registry instead of throwing", async () => {
  registry.__setDeps({ storage: { async get() { throw new Error("kv down"); }, async set() {} } });
  assert.deepStrictEqual(await registry.readRegistry(), []);
  assert.strictEqual(await registry.tenantExists("acme"), false);
});

test("isProtectedTenant fails CLOSED on a storage error (opposite direction from tenantExists)", async () => {
  registry.__setDeps({ storage: { async get() { throw new Error("kv down"); }, async set() {} } });
  // A transient KV blip must never disable the delete/publish/rollback
  // guards — it must resolve as "protected", not "unprotected".
  assert.strictEqual(await registry.isProtectedTenant("anything"), true);
  // The existence question keeps failing the other way: unreadable registry
  // still reads as "unknown tenant".
  assert.strictEqual(await registry.tenantExists("anything"), false);
  // And plain listing still degrades to an empty array, not a throw.
  assert.deepStrictEqual(await registry.readRegistry(), []);
});

test("upsertEntry on an UNREADABLE registry rejects and writes nothing", async () => {
  let setCalls = 0;
  registry.__setDeps({ storage: {
    async get() { throw new Error("kv down"); },
    async set() { setCalls += 1; },
  } });
  // A fail-soft [] here used to be written back as a one-entry registry,
  // replacing every other tenant.
  await assert.rejects(() => registry.upsertEntry("acme", { isActive: true }), /kv down/);
  assert.strictEqual(setCalls, 0, "set must never be called when the registry read failed");
});

test("upsertEntry on a genuinely ABSENT registry still seeds a one-entry registry", async () => {
  const storage = fakeStorage();
  registry.__setDeps({ storage });
  await registry.upsertEntry("acme", { isActive: true });
  assert.deepStrictEqual(storage.data["tenant-registry"], [{ tenantId: "acme", isActive: true }]);
});

test("isPreboardingEnabled: protected entries default on, explicit false wins, ordinary stays opt-in", async () => {
  registry.__setDeps({ storage: fakeStorage({ "tenant-registry": [
    { tenantId: "prot-unset", isProtected: true },
    { tenantId: "prot-off", isProtected: true, preboardingEnabled: false },
    { tenantId: "prot-on", isProtected: true, preboardingEnabled: true },
    { tenantId: "plain-unset" },
  ] }) });
  const rows = [
    ["prot-unset", true],
    ["prot-off", false],
    ["prot-on", true],
    ["plain-unset", false],
    ["ghost", false],
  ];
  for (const [tenantId, expected] of rows) {
    assert.strictEqual(await registry.isPreboardingEnabled(tenantId), expected, tenantId);
  }
});
