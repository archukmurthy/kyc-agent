const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeScreening, OBSERVATION_KEYS } = require("../canonical");

test("normalizeScreening maps interpret output to the neutral observation vocabulary", () => {
  const out = normalizeScreening({
    status: "complete", outcome: "attention", hit: true, notProcessed: false,
    categories: { watchlist: true, pep: false, adverseMedia: true, other: false }, matchCount: 3,
  });
  assert.deepEqual(out, {
    status: "complete", outcome: "attention", hit: true, notProcessed: false,
    observations: { watchlist: true, pep: false, adverseMedia: true, other: false }, matchCount: 3,
  });
});

test("normalizeScreening defaults every observation key to false and coerces to boolean", () => {
  const out = normalizeScreening({ status: "pending", outcome: null, categories: {} });
  assert.deepEqual(OBSERVATION_KEYS, ["watchlist", "pep", "adverseMedia", "other"]);
  assert.deepEqual(out.observations, { watchlist: false, pep: false, adverseMedia: false, other: false });
  assert.equal(out.hit, false);
  assert.equal(out.notProcessed, false);
  assert.equal(out.matchCount, 0);
});
