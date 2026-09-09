const { test } = require("node:test");
const assert = require("node:assert");

const { DATA_CLASSES, retentionFor, deletionDueAt, retentionMetadata, RETENTION_POLICY } = require("../retentionPolicy");

test("all four data classes have separate retention entries", () => {
  assert.deepStrictEqual(
    Object.values(DATA_CLASSES).sort(),
    ["evidence_provenance", "idv_operations", "provider_media", "vault_pii"],
  );
  for (const cls of Object.values(DATA_CLASSES)) assert.ok(cls in RETENTION_POLICY, `${cls} missing`);
});

test("periods are unset by default -> no scheduled deletion (keep)", () => {
  for (const cls of Object.values(DATA_CLASSES)) {
    assert.strictEqual(retentionFor(cls).periodDays, null);
    assert.strictEqual(deletionDueAt(cls, "2026-01-01T00:00:00Z"), null);
  }
});

test("deletionDueAt computes a due date once a period is set (structure works)", () => {
  // Simulate a configured period without mutating the shared policy.
  const original = RETENTION_POLICY[DATA_CLASSES.PROVIDER_MEDIA].periodDays;
  try {
    RETENTION_POLICY[DATA_CLASSES.PROVIDER_MEDIA].periodDays = 30;
    assert.strictEqual(deletionDueAt(DATA_CLASSES.PROVIDER_MEDIA, "2026-01-01T00:00:00.000Z"), "2026-01-31T00:00:00.000Z");
  } finally {
    RETENTION_POLICY[DATA_CLASSES.PROVIDER_MEDIA].periodDays = original;
  }
});

test("retentionMetadata stamp carries the class, period, from, and due date", () => {
  const m = retentionMetadata(DATA_CLASSES.VAULT_PII, "2026-01-01T00:00:00Z");
  assert.strictEqual(m.data_class, "vault_pii");
  assert.strictEqual(m.period_days, null);
  assert.strictEqual(m.retained_from, "2026-01-01T00:00:00Z");
  assert.strictEqual(m.deletion_due_at, null);
});
