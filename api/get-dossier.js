// Fetch a saved entity dossier by id so the Preview button and the customer
// invite link (a signed dossier token) can reconstruct full onboarding state
// from the DB — the dossier is the source of truth. Two credentials, resolved
// via lib/dossierAccess.js: an analyst (`Bearer <PREBOARDING_PASSWORD>` +
// `?tenant=`, naming any dossier id in that tenant) or a customer (the signed
// link token, which names exactly one dossier — no bare `?dossierId=` lookup
// exists any more). Returns raw_research (the complete research.found with
// .stakeholders + verificationStatus intact) plus the tiered arrays and
// broken-out coverage counts. Read-only; best-effort on DB failure: returns
// 200 with success:false so the flow never hard-blocks, but auth failures are
// proper 4xx/410. There is no single `coverage` column — it's reconstructed
// client-side from total_fields/verified_fields/fill_rate/etc.
//
// CommonJS (module.exports) so src/setupProxy.js can require() it for local dev,
// mirroring api/submit.js, api/save-dossier.js, etc.
const { neon } = require("@neondatabase/serverless");
const dossierAccess = require("../lib/dossierAccess");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { neon, access: dossierAccess };

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Credential first: nothing about any dossier is revealed to an anonymous caller.
  const actor = await _deps.access.resolveDossierActor(req);
  if (actor.kind === "none") {
    const deny = _deps.access.denyFor(actor);
    return res.status(deny.status).json({ error: deny.error });
  }

  // A customer's token names exactly one dossier; a request-supplied id is ignored.
  const id = actor.kind === "customer" ? actor.dossierId : req.query && req.query.id;
  if (!id) {
    return res.status(400).json({ error: "dossierId_required" });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(200).json({ success: false, error: "Database not configured" });
  }

  try {
    const sql = _deps.neon(process.env.DATABASE_URL);

    // Scoped by the VERIFIED tenant, never a request parameter.
    const rows = await sql`
      SELECT
        id,
        tenant_id,
        owned_by,
        company_name,
        country_code,
        country_name,
        entity_type,
        ownership_type,
        verified_data,
        probable_data,
        indicative_data,
        stakeholders,
        required_documents,
        included_fields,
        excluded_fields,
        custom_questions,
        raw_research,
        total_fields,
        verified_fields,
        probable_fields,
        indicative_fields,
        missing_fields,
        fill_rate,
        verified_fill_rate,
        status,
        saved_at AS generated_at
      FROM entity_dossiers
      WHERE id = ${id}
      AND tenant_id = ${actor.tenantId}
      AND status != 'deleted'
      LIMIT 1
    `;

    const row = rows.length ? rows[0] : null;
    const permitted = _deps.access.canReadDossier(actor, row);
    if (!permitted.ok) {
      return res.status(permitted.status).json(
        permitted.status === 404 ? { success: false, error: permitted.error } : { error: permitted.error }
      );
    }

    return res.status(200).json({ success: true, dossier: row });
  } catch (err) {
    console.error("[get-dossier] Error:", err);
    return res.status(200).json({ success: false, error: "load_failed" });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
