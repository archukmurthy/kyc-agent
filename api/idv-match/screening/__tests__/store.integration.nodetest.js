const { test } = require("node:test");
const assert = require("node:assert");

// Guarded DB integration for the screening store. Runs only with
// IDV_MATCH_DB_TEST=1 against a disposable dev DATABASE_URL (Neon idv-dev).
const RUN = process.env.IDV_MATCH_DB_TEST === "1";
if (RUN) require("dotenv").config({ path: ".env.local" });
const skip = RUN ? false : "set IDV_MATCH_DB_TEST=1 (with a dev DATABASE_URL) to run";

test("screening store create/get/list/update round-trips and cleans up", { skip }, async () => {
  const { neon } = require("@neondatabase/serverless");
  const { randomUUID } = require("node:crypto");
  const { createScreening, getByCheckId, listByAttempt, updateScreeningResult } = require("../store");

  const attemptId = "itest-att-" + randomUUID();
  const checkId = "itest-chk-" + randomUUID();
  let id;
  try {
    id = await createScreening({ attemptId, provider: "complycube", complyCubeClientId: "cli-1", complyCubeCheckId: checkId });

    const byCheck = await getByCheckId(checkId);
    assert.strictEqual(byCheck.id, id);
    assert.strictEqual(byCheck.status, "pending");

    const list = await listByAttempt(attemptId);
    assert.strictEqual(list.length, 1);

    await updateScreeningResult(id, {
      status: "complete",
      outcome: "attention",
      categories: { watchlist: true, pep: true, adverseMedia: false, other: false },
      result: { outcome: "attention" },
    });

    const after = await getByCheckId(checkId);
    assert.strictEqual(after.status, "complete");
    assert.strictEqual(after.outcome, "attention");
    assert.strictEqual(after.categories.pep, true); // JSONB round-trips
  } finally {
    if (id) {
      const sql = neon(process.env.DATABASE_URL);
      await sql`DELETE FROM idv_screening_checks WHERE id = ${id}`;
    }
  }
});
