// Smoke test: self-serve re-research persistence against REAL Neon.
//  - save-dossier persists seeded_by + search_attempts (migration 008)
//  - search-attempt GET reads the count; POST atomically increments it
// Writes a throwaway dossier, asserts, then deletes it. Run: node test-reresearch.js
require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

const saveDossier = require("./api/save-dossier.js");
const searchAttempt = require("./api/search-attempt.js");

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
  };
}
const callSave = async (body) => { const r = mockRes(); await saveDossier({ method: "POST", body }, r); return r.body; };
const callAttempt = async (method, dossierId) => {
  const r = mockRes();
  await searchAttempt({ method, query: { dossierId }, body: { dossierId } }, r);
  return r.body;
};

(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const tenantId = "nium";
  let ok = true;

  // 1) Save a customer-seeded dossier with attempt 1.
  const saved = await callSave({
    tenantId,
    company: { name: "Re-Research Test Co", code: "GB", countryName: "United Kingdom" },
    entityType: "corporate",
    ownershipType: "private_limited",
    seededBy: "customer",
    searchAttempts: 1,
  });
  console.log("save-dossier:", saved);
  const dossierId = saved.dossierId;
  if (!dossierId) { console.log("❌ no dossierId"); process.exit(1); }

  // 2) Row carries seeded_by + search_attempts.
  const row = (await sql`SELECT seeded_by, search_attempts FROM entity_dossiers WHERE id = ${dossierId}`)[0];
  console.log("row:", row);
  ok = ok && row.seeded_by === "customer" && row.search_attempts === 1;

  // 3) GET reads 1.
  const get1 = await callAttempt("GET", dossierId);
  console.log("GET attempts:", get1);
  ok = ok && get1.attempts === 1;

  // 4) POST increments to 2 (second attempt).
  const inc = await callAttempt("POST", dossierId);
  console.log("POST attempts:", inc);
  ok = ok && inc.attempts === 2;

  // 5) GET now reads 2 (server-authoritative, survives a fresh read).
  const get2 = await callAttempt("GET", dossierId);
  ok = ok && get2.attempts === 2;

  console.log(ok ? "✅ RE-RESEARCH PERSISTENCE CORRECT (seeded_by:customer, attempts 1→2)" : "❌ MISMATCH");

  // cleanup
  const del = await sql`DELETE FROM entity_dossiers WHERE id = ${dossierId} RETURNING id`;
  console.log(`cleaned up ${del.length} test dossier`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("verify failed:", e.message); process.exit(1); });
