const { test } = require("node:test");
const assert = require("node:assert");
const { interpretCheck } = require("../interpret");

const clear = {
  status: "complete",
  result: {
    outcome: "clear",
    breakdown: {
      summary: {
        pep: { level1: "clear", level2: "clear", level3: "clear", level4: "clear" },
        watchlist: { sanctionsList: "clear", terror: "clear" },
        adverseMedia: { regulatory: "clear" },
        otherLists: { financialCrime: "clear" },
      },
      matches: [],
    },
  },
};

const attention = {
  status: "complete",
  result: {
    outcome: "attention",
    breakdown: {
      summary: {
        pep: { level1: "attention", level2: "clear", level3: "clear", level4: "clear" },
        watchlist: { sanctionsList: "attention", terror: "clear" },
        adverseMedia: { regulatory: "clear" },
        otherLists: { financialCrime: "clear" },
      },
      matches: [{ id: "m1", score: 90, details: { classifications: { pep: ["level1"], watchlist: ["sanctionsList"] } } }],
    },
  },
};

test("clear result is not a hit and flags no categories", () => {
  const r = interpretCheck(clear);
  assert.strictEqual(r.hit, false);
  assert.strictEqual(r.notProcessed, false);
  assert.deepStrictEqual(r.categories, { watchlist: false, pep: false, adverseMedia: false, other: false });
  assert.strictEqual(r.matchCount, 0);
});

test("attention is a hit with the right categories and match count", () => {
  const r = interpretCheck(attention);
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.categories.watchlist, true);
  assert.strictEqual(r.categories.pep, true);
  assert.strictEqual(r.categories.adverseMedia, false);
  assert.strictEqual(r.matchCount, 1);
});

test("not_processed is flagged and never treated as clear/hit", () => {
  const r = interpretCheck({ status: "complete", result: { outcome: "not_processed", breakdown: { summary: {}, matches: [] } } });
  assert.strictEqual(r.hit, false);
  assert.strictEqual(r.notProcessed, true);
});

test("tolerates a still-pending check with no result", () => {
  const r = interpretCheck({ status: "pending" });
  assert.strictEqual(r.status, "pending");
  assert.strictEqual(r.outcome, null);
  assert.strictEqual(r.hit, false);
});
