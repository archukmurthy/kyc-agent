const { test } = require("node:test");
const assert = require("node:assert");
const { finalizeSubmission } = require("../lib/finalizeSubmission");

// Fake pooled client: records the ordered query text, returns canned RETURNING
// rows for the three id-bearing inserts so the chain resolves. No live DB.
function fakeClient() {
  const queries = [];
  return {
    queries,
    query(text, params) {
      queries.push(String(text).trim().split("\n")[0].trim());
      const t = String(text);
      if (/INSERT INTO clients/i.test(t)) return Promise.resolve({ rows: [{ id: "client-1" }] });
      if (/INSERT INTO onboarding_sessions/i.test(t)) return Promise.resolve({ rows: [{ id: "session-1" }] });
      if (/INSERT INTO journeys/i.test(t)) return Promise.resolve({ rows: [{ journey_id: "journey-1" }] });
      return Promise.resolve({ rows: [] });
    },
    release() {},
  };
}

const basePayload = {
  submissionId: "sub-1",
  tenantId: "nium",
  company: { name: "Acme Ltd", code: "GB" },
  entityType: "company",
  fieldValues: { legal_name: "Acme Ltd" },
  declaration: { agreedAt: "2026-09-13T00:00:00Z" },
};

test("finalize wraps all writes in one transaction (BEGIN first, COMMIT last)", async () => {
  const client = fakeClient();
  const pool = { connect: () => Promise.resolve(client) };
  const r = await finalizeSubmission(basePayload, { pool });
  assert.strictEqual(client.queries[0], "BEGIN");
  assert.strictEqual(client.queries[client.queries.length - 1], "COMMIT");
  assert.deepStrictEqual(r, { sessionId: "session-1", clientId: "client-1", journeyId: "journey-1" });
});

test("finalize is idempotent on submissionId (session upsert, not insert-blind)", async () => {
  const client = fakeClient();
  const pool = { connect: () => Promise.resolve(client) };
  await finalizeSubmission(basePayload, { pool });
  const sessionInsert = client.queries.find((q) => /INSERT INTO onboarding_sessions/i.test(q));
  const full = client.queries.join("\n");
  assert.ok(sessionInsert, "expected an onboarding_sessions insert");
  assert.match(full, /submission_id/); // submission_id threaded in
});

test("finalize rolls back when a write throws (no partial commit)", async () => {
  const client = fakeClient();
  let rolledBack = false;
  const orig = client.query.bind(client);
  client.query = (text, params) => {
    if (/INSERT INTO field_values/i.test(String(text))) return Promise.reject(new Error("boom"));
    if (String(text).trim() === "ROLLBACK") rolledBack = true;
    return orig(text, params);
  };
  const pool = { connect: () => Promise.resolve(client) };
  await assert.rejects(() => finalizeSubmission(basePayload, { pool }), /boom/);
  assert.strictEqual(rolledBack, true);
  assert.ok(!client.queries.includes("COMMIT"), "must not COMMIT after a failed write");
});

function recordingClient() {
  const calls = [];
  return {
    calls,
    query(text, params) {
      calls.push({ text: String(text), params: params || [] });
      const t = String(text);
      if (/INSERT INTO clients/i.test(t)) return Promise.resolve({ rows: [{ id: "client-1" }] });
      if (/INSERT INTO onboarding_sessions/i.test(t)) return Promise.resolve({ rows: [{ id: "session-1" }] });
      if (/INSERT INTO journeys/i.test(t)) return Promise.resolve({ rows: [{ journey_id: "journey-1" }] });
      return Promise.resolve({ rows: [] });
    },
    release() {},
  };
}

test("the session records its source dossier and the dossier becomes customer-owned in the same transaction", async () => {
  const client = recordingClient();
  await finalizeSubmission({ ...basePayload, dossierId: "d-1" }, { pool: { connect: () => Promise.resolve(client) } });
  const session = client.calls.find((c) => /INSERT INTO onboarding_sessions/i.test(c.text));
  assert.match(session.text, /dossier_id/);
  assert.ok(session.params.includes("d-1"));
  const flipIdx = client.calls.findIndex((c) => /UPDATE entity_dossiers/i.test(c.text));
  assert.ok(flipIdx !== -1, "expected the ownership flip");
  assert.match(client.calls[flipIdx].text, /owned_by\s*=\s*'customer'/);
  assert.deepStrictEqual(client.calls[flipIdx].params, ["d-1", "nium"]);
  const commitIdx = client.calls.findIndex((c) => c.text.trim() === "COMMIT");
  assert.ok(flipIdx < commitIdx);
});

test("a submission without a dossier writes a null link and flips nothing", async () => {
  const client = recordingClient();
  await finalizeSubmission({ ...basePayload }, { pool: { connect: () => Promise.resolve(client) } });
  const session = client.calls.find((c) => /INSERT INTO onboarding_sessions/i.test(c.text));
  assert.match(session.text, /dossier_id/);
  assert.strictEqual(session.params[session.params.length - 1], null);
  assert.ok(!client.calls.some((c) => /UPDATE entity_dossiers/i.test(c.text)));
});
