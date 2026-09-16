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
// Credential-gated and tenant-scoped (lib/dossierAccess.js): a customer's
// dossier id comes only from its signed token; an analyst must name one via
// `dossierId` (query for GET, body for POST). Every statement is filtered by
// the verified tenant, so a foreign-tenant id is simply not found.
//
// CommonJS (module.exports), mirroring api/track-event.js / api/get-dossier.js.
// Always returns 200 with the best-known count on a DB error (with a warning)
// rather than failing the customer's flow; authorisation failures are proper
// 4xx. NOTE: src/setupProxy.js gets an additive route registration so this
// also works under local npm start.

const { neon } = require("@neondatabase/serverless");
const dossierAccess = require("../lib/dossierAccess");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { neon, access: dossierAccess };

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const actor = await _deps.access.resolveDossierActor(req);
  if (actor.kind === "none") {
    const deny = _deps.access.denyFor(actor);
    return res.status(deny.status).json({ error: deny.error });
  }

  const requested = req.method === "GET" ? req.query && req.query.dossierId : (req.body || {}).dossierId;
  const dossierId = actor.kind === "customer" ? actor.dossierId : requested;
  if (!dossierId) {
    return res.status(400).json({ error: "dossierId_required" });
  }

  if (!process.env.DATABASE_URL) {
    console.warn("[search-attempt] No DATABASE_URL");
    return res.status(200).json({ attempts: null, warning: "Database not configured" });
  }

  try {
    const sql = _deps.neon(process.env.DATABASE_URL);

    // Tenant-scoped: an id from another tenant is simply not found.
    const found = await sql`
      SELECT id, tenant_id, owned_by, search_attempts
      FROM entity_dossiers
      WHERE id = ${dossierId} AND tenant_id = ${actor.tenantId} AND status != 'deleted'
      LIMIT 1
    `;
    const row = found.length ? found[0] : null;

    const permitted = req.method === "POST"
      ? _deps.access.canWriteDossier(actor, row)
      : _deps.access.canReadDossier(actor, row);
    if (!permitted.ok) return res.status(permitted.status).json({ error: permitted.error });

    if (req.method === "GET") {
      return res.status(200).json({ attempts: row.search_attempts });
    }

    // Atomic increment — the database is the single source of truth, so two
    // concurrent re-search clicks can't both read the same pre-increment value.
    const rows = await sql`
      UPDATE entity_dossiers
      SET search_attempts = search_attempts + 1
      WHERE id = ${dossierId} AND tenant_id = ${actor.tenantId}
      RETURNING search_attempts
    `;
    const attempts = rows.length ? rows[0].search_attempts : null;
    console.log(`[search-attempt] dossier ${dossierId} → attempt ${attempts}`);
    return res.status(200).json({ attempts });
  } catch (err) {
    console.error("[search-attempt] ❌", err.message);
    return res.status(200).json({ attempts: null, warning: err.message });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
