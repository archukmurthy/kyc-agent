// Revoke every outstanding customer link for a dossier.
//
// POST { dossierId } — analyst only. Tokens for this dossier issued at or before
// the call stop working immediately (lib/dossierToken.js); a fresh invite
// afterwards issues a working one. There is no UI for this yet (backlog PREB-2).
//
// CommonJS (module.exports) so src/setupProxy.js can require() it for local dev.

const { neon } = require("@neondatabase/serverless");
const dossierAccess = require("../lib/dossierAccess");
const dossierToken = require("../lib/dossierToken");
const { applyCors } = require("../lib/routeAuth");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { neon, access: dossierAccess, dossierToken };

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return undefined;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const actor = await _deps.access.resolveDossierActor(req);
  if (actor.kind === "none") {
    const deny = _deps.access.denyFor(actor);
    return res.status(deny.status).json({ error: deny.error });
  }
  if (actor.kind !== "analyst") return res.status(403).json({ error: "forbidden" });

  const dossierId = (req.body || {}).dossierId;
  if (!dossierId) return res.status(400).json({ error: "dossierId_required" });

  // The tenant-ownership check below is a security boundary and must never be
  // skipped: without a reachable DB we cannot prove the dossier belongs to
  // this analyst's tenant, so we fail closed rather than revoking blind.
  if (!process.env.DATABASE_URL) {
    console.error("[revoke-dossier-token] DATABASE_URL is not configured");
    return res.status(500).json({ error: "not_configured" });
  }

  try {
    const sql = _deps.neon(process.env.DATABASE_URL);
    const found = await sql`
      SELECT id FROM entity_dossiers
      WHERE id = ${dossierId} AND tenant_id = ${actor.tenantId}
      LIMIT 1
    `;
    if (!found.length) return res.status(404).json({ error: "dossier_not_found" });
    // Postgres's uuid type matches an uppercase/braced/hyphenless spelling to
    // the same row as its canonical lowercase form. Revoking by the caller's
    // spelling instead of the row's own id would write
    // dossier-token-revoked:<UPPER>, leaving every lowercase-id token (what
    // invite.js actually mints) unrevoked while still answering success:true.
    const canonicalId = String(found[0].id);
    const { revokedBefore } = await _deps.dossierToken.revokeAllForDossier(canonicalId);
    return res.status(200).json({ success: true, revokedBefore });
  } catch (err) {
    console.error("[revoke-dossier-token]", err);
    return res.status(500).json({ error: "revoke_failed" });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
