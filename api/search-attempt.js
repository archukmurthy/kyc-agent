// Server-authoritative count of the CUSTOMER's re-searches on a dossier →
// Neon `entity_dossiers.customer_searches` (migration 027). Cap: 2. The
// analyst's original search is never counted, and an analyst can never
// consume the customer's searches.
//
//   GET  /api/search-attempt[?dossierId=]  → { attemptsUsed, remaining, cap }
//   POST /api/search-attempt               → { allowed, attemptsUsed, remaining }
//
// Credential-gated and tenant-scoped (lib/dossierAccess.js): a customer's
// dossier id comes only from its signed token; an analyst names one with
// ?dossierId= to read. POST is customer-only. The increment is a single
// conditional UPDATE, so two concurrent clicks cannot both get the second
// search, and it flips owned_by to 'customer' — spending a search is a
// customer action, after which the analyst is read-only.
//
// An allowed POST also returns a one-time research grant (lib/researchGrant.js)
// that /api/research requires from a link customer. It is minted BEFORE the
// increment, so a missing secret refuses the search without spending it.
//
// Fails CLOSED: on a DB error the search is refused (the customer falls back
// to manual entry) rather than letting an unknown count run a paid search.
//
// CommonJS so src/setupProxy.js can mount it for `npm start`.

const { neon } = require("@neondatabase/serverless");
const dossierAccess = require("../lib/dossierAccess");
const researchGrant = require("../lib/researchGrant");
const { SEARCH_CAP } = require("../src/reresearch/searchPolicy");

// Injected deps (overridable in tests via __setDeps).
let _deps = { neon, access: dossierAccess, grant: researchGrant };

function refused(warning) {
  return { allowed: false, attemptsUsed: null, remaining: null, warning };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const actor = await _deps.access.resolveDossierActor(req);
  if (actor.kind === "none") {
    const deny = _deps.access.denyFor(actor);
    return res.status(deny.status).json({ error: deny.error });
  }
  if (req.method === "POST" && actor.kind !== "customer") {
    return res.status(403).json({ error: "forbidden" });
  }

  const dossierId = actor.kind === "customer" ? actor.dossierId : req.query && req.query.dossierId;
  if (!dossierId) {
    return res.status(400).json({ error: "dossierId_required" });
  }

  if (!process.env.DATABASE_URL) {
    console.warn("[search-attempt] No DATABASE_URL");
    return req.method === "POST"
      ? res.status(200).json(refused("database_not_configured"))
      : res.status(200).json({ attemptsUsed: null, remaining: null, cap: SEARCH_CAP, warning: "database_not_configured" });
  }

  try {
    const sql = _deps.neon(process.env.DATABASE_URL);

    const found = await sql`
      SELECT id, tenant_id, owned_by, customer_searches
      FROM entity_dossiers
      WHERE id = ${dossierId} AND tenant_id = ${actor.tenantId} AND status != 'deleted'
      LIMIT 1
    `;
    const row = found.length ? found[0] : null;

    const permitted = req.method === "POST"
      ? _deps.access.canWriteDossier(actor, row)
      : _deps.access.canReadDossier(actor, row);
    if (!permitted.ok) return res.status(permitted.status).json({ error: permitted.error });

    const used = Number(row.customer_searches) || 0;
    if (req.method === "GET") {
      return res.status(200).json({ attemptsUsed: used, remaining: Math.max(0, SEARCH_CAP - used), cap: SEARCH_CAP });
    }

    let grant;
    try {
      grant = _deps.grant.mint({ subject: `dossier:${dossierId}`, tenantId: actor.tenantId });
    } catch (_) {
      console.warn("[search-attempt] research grant unavailable (no secret)");
      return res.status(200).json({ allowed: false, attemptsUsed: used, remaining: Math.max(0, SEARCH_CAP - used), warning: "grant_unavailable" });
    }

    const rows = await sql`
      UPDATE entity_dossiers
      SET customer_searches = customer_searches + 1,
          owned_by = ${"customer"},
          last_customer_action_at = NOW()
      WHERE id = ${dossierId} AND tenant_id = ${actor.tenantId} AND status != 'deleted' AND customer_searches < ${SEARCH_CAP}
      RETURNING customer_searches
    `;
    if (rows.length === 0) {
      return res.status(200).json({ allowed: false, attemptsUsed: Math.max(used, SEARCH_CAP), remaining: 0 });
    }
    const attemptsUsed = Number(rows[0].customer_searches);
    console.log(`[search-attempt] dossier ${dossierId} → customer search ${attemptsUsed}`);
    return res.status(200).json({ allowed: true, attemptsUsed, remaining: Math.max(0, SEARCH_CAP - attemptsUsed), grant });
  } catch (err) {
    console.error("[search-attempt] ❌", err.message);
    return req.method === "POST"
      ? res.status(200).json(refused("search_attempt_failed"))
      : res.status(200).json({ attemptsUsed: null, remaining: null, cap: SEARCH_CAP, warning: "search_attempt_failed" });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
