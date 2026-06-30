// Server-authoritative search-attempt counter for the self-serve re-research
// two-retry cap → Neon `entity_dossiers.search_attempts`.
//
// The cap (run a search at most twice) must not be trivially resettable from the
// browser, so the count lives on the dossier row and is incremented here, not in
// client state. The Step 1 page reads the count from the server before offering
// the search options.
//
//   GET  /api/search-attempt?dossierId=...   → { attempts }                (read)
//   POST /api/search-attempt  { dossierId }  → { attempts }  (atomic +1, returns new)
//
// CommonJS (module.exports), mirroring api/track-event.js / api/get-dossier.js.
// Always returns 200 with the best-known count; a DB error reports attempts:null
// + a warning rather than failing the customer's flow. NOTE: src/setupProxy.js
// gets an additive route registration so this also works under local npm start.

const { neon } = require("@neondatabase/serverless");

module.exports = async function handler(req, res) {
  const dossierId =
    (req.method === "GET" ? req.query && req.query.dossierId : (req.body || {}).dossierId) || null;

  if (!dossierId) {
    return res.status(400).json({ error: "dossierId is required" });
  }

  if (!process.env.DATABASE_URL) {
    console.warn("[search-attempt] No DATABASE_URL");
    return res.status(200).json({ attempts: null, warning: "Database not configured" });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    if (req.method === "POST") {
      // Atomic increment — the database is the single source of truth, so two
      // concurrent re-search clicks can't both read the same pre-increment value.
      const rows = await sql`
        UPDATE entity_dossiers
        SET search_attempts = search_attempts + 1
        WHERE id = ${dossierId}
        RETURNING search_attempts
      `;
      const attempts = rows.length ? rows[0].search_attempts : null;
      console.log(`[search-attempt] dossier ${dossierId} → attempt ${attempts}`);
      return res.status(200).json({ attempts });
    }

    if (req.method === "GET") {
      const rows = await sql`
        SELECT search_attempts FROM entity_dossiers WHERE id = ${dossierId}
      `;
      return res.status(200).json({ attempts: rows.length ? rows[0].search_attempts : null });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[search-attempt] ❌", err.message);
    return res.status(200).json({ attempts: null, warning: err.message });
  }
};
