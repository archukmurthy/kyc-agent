// Persists a pre-boarding entity dossier → Neon `entity_dossiers`.
//
// CommonJS (module.exports), not `export default`, so src/setupProxy.js can
// require() it for local `npm start` (mirrors api/submit.js, api/track-event.js).
// Always returns 200 on a database failure — a save failure must never block
// the analyst — but authorisation failures are proper 4xx.
//
// Callers must hold an analyst or customer credential (lib/dossierAccess.js).
// The tenant comes from the credential only — a request body can no longer
// name (or create) a tenant. A customer may only refresh its own dossier
// (never create one, never touch another); its write flips `owned_by` to
// 'customer', after which an analyst can no longer write that row.
//
// Upsert-by-id: a caller that already has a dossierId (a re-research / an
// analyst "Update" re-save) must refresh THAT row, never insert a second one —
// an invite link may already embed the original id, and a blind INSERT would
// orphan it. `dossierId` is optional and additive; a caller that omits it (the
// original contract) still gets a plain INSERT.

const { neon } = require("@neondatabase/serverless");
const dossierAccess = require("../lib/dossierAccess");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { neon, access: dossierAccess };

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Credential first. The tenant comes from the credential ONLY — a request
  // body can no longer name (or create) a tenant.
  const actor = await _deps.access.resolveDossierActor(req);
  if (actor.kind === "none") {
    const deny = _deps.access.denyFor(actor);
    return res.status(deny.status).json({ error: deny.error });
  }
  const tenantId = actor.tenantId;

  const {
    dossierId,
    company,
    entityType,
    ownershipType,
    coverage,
    includedFields,
    excludedFields,
    customQuestions,
    verifiedData,
    probableData,
    indicativeData,
    stakeholders,
    requiredDocuments,
    costSummary,
    rawResearch,
    seededBy,
    searchAttempts,
  } = req.body || {};

  // Self-serve re-research metadata (migration 008). `seeded_by` records who
  // triggered the search that produced this dossier: 'customer' (self-serve
  // re-research) vs the default 'analyst'. `search_attempts` seeds the
  // server-authoritative two-retry counter — one search has run by the time a
  // dossier exists, so a first save is attempt 1 unless the caller says otherwise.
  const seededByValue = seededBy === "customer" ? "customer" : "analyst";
  const searchAttemptsValue = Number.isFinite(searchAttempts) ? searchAttempts : 1;

  if (!company?.name) {
    return res.status(400).json({ error: "company.name required" });
  }

  // Customers only ever refresh their own dossier; creating one is analyst work.
  if (actor.kind === "customer" && !dossierId) {
    return res.status(403).json({ error: "forbidden" });
  }

  if (!process.env.DATABASE_URL) {
    console.warn("[save-dossier] No DATABASE_URL");
    return res.status(200).json({ success: false, dossierId: null, warning: "Database not configured" });
  }

  try {
    const sql = _deps.neon(process.env.DATABASE_URL);

    let existing = null;
    if (dossierId) {
      const found = await sql`
        SELECT id, tenant_id, owned_by
        FROM entity_dossiers
        WHERE id = ${dossierId} AND tenant_id = ${tenantId} AND status != 'deleted'
        LIMIT 1
      `;
      existing = found.length ? found[0] : null;

      if (existing) {
        const permitted = _deps.access.canWriteDossier(actor, existing);
        if (!permitted.ok) return res.status(permitted.status).json({ error: permitted.error });
      } else if (actor.kind === "customer") {
        // The customer's dossier is gone; never let a customer mint a new one.
        return res.status(404).json({ error: "dossier_not_found" });
      }
    }

    const isCustomer = actor.kind === "customer";

    // Ensure the Postgres tenants row exists (slug is NOT NULL). The tenant id
    // here is the VERIFIED one from the credential — the historical hole was
    // that it came from the request body, letting any caller create tenants.
    await sql`
      INSERT INTO tenants (id, name, slug)
      VALUES (${tenantId}, ${tenantId}, ${tenantId})
      ON CONFLICT (id) DO NOTHING
    `;

    let rows = [];
    if (existing) {
      // Update-in-place, scoped to this tenant so one tenant can never
      // overwrite another's row by guessing/replaying an id.
      rows = await sql`
        UPDATE entity_dossiers
        SET
          company_name = ${company.name},
          country_code = ${company.code || null},
          country_name = ${company.countryName || null},
          entity_type = ${entityType || null},
          ownership_type = ${ownershipType || null},

          total_fields = ${coverage?.totalResearchFields || null},
          verified_fields = ${coverage?.verifiedFields || null},
          probable_fields = ${coverage?.probableFields || null},
          indicative_fields = ${coverage?.indicativeFields || null},
          missing_fields = ${coverage?.missingFieldCount || null},
          fill_rate = ${coverage?.fillRate != null ? Math.round(coverage.fillRate * 100) : null},
          verified_fill_rate = ${coverage?.verifiedFillRate != null ? Math.round(coverage.verifiedFillRate * 100) : null},

          included_fields = ${JSON.stringify(includedFields || [])},
          excluded_fields = ${JSON.stringify(excludedFields || [])},
          custom_questions = ${JSON.stringify(customQuestions || [])},

          verified_data = ${JSON.stringify(verifiedData || [])},
          probable_data = ${JSON.stringify(probableData || [])},
          indicative_data = ${JSON.stringify(indicativeData || [])},
          stakeholders = ${JSON.stringify(stakeholders || {})},
          required_documents = ${JSON.stringify(requiredDocuments || [])},

          research_cost_usd = ${costSummary?.totals?.totalCostUsd ?? null},
          research_tokens = ${costSummary?.totals?.totalTokens ?? null},
          research_model = ${costSummary?.model || null},
          raw_research = ${JSON.stringify(rawResearch || {})},

          seeded_by = ${seededByValue},
          search_attempts = ${searchAttemptsValue},

          owned_by = CASE WHEN ${isCustomer} THEN ${"customer"} ELSE owned_by END,
          last_customer_action_at = CASE WHEN ${isCustomer} THEN NOW() ELSE last_customer_action_at END,
          status = 'ready',
          saved_at = NOW()
        WHERE id = ${dossierId} AND tenant_id = ${tenantId}
        RETURNING id
      `;
    }

    if (!existing || rows.length === 0) {
      // Either the caller has no id yet (first save), or the id it sent
      // didn't match a row for this tenant (stale/foreign id) — insert fresh
      // rather than silently dropping the save.
      rows = await sql`
      INSERT INTO entity_dossiers (
        tenant_id,
        company_name,
        country_code,
        country_name,
        entity_type,
        ownership_type,

        total_fields,
        verified_fields,
        probable_fields,
        indicative_fields,
        missing_fields,
        fill_rate,
        verified_fill_rate,

        included_fields,
        excluded_fields,
        custom_questions,

        verified_data,
        probable_data,
        indicative_data,
        stakeholders,
        required_documents,

        research_cost_usd,
        research_tokens,
        research_model,
        raw_research,

        seeded_by,
        search_attempts,

        status,
        saved_at
      )
      VALUES (
        ${tenantId},
        ${company.name},
        ${company.code || null},
        ${company.countryName || null},
        ${entityType || null},
        ${ownershipType || null},

        ${coverage?.totalResearchFields || null},
        ${coverage?.verifiedFields || null},
        ${coverage?.probableFields || null},
        ${coverage?.indicativeFields || null},
        ${coverage?.missingFieldCount || null},
        ${coverage?.fillRate != null ? Math.round(coverage.fillRate * 100) : null},
        ${coverage?.verifiedFillRate != null ? Math.round(coverage.verifiedFillRate * 100) : null},

        ${JSON.stringify(includedFields || [])},
        ${JSON.stringify(excludedFields || [])},
        ${JSON.stringify(customQuestions || [])},

        ${JSON.stringify(verifiedData || [])},
        ${JSON.stringify(probableData || [])},
        ${JSON.stringify(indicativeData || [])},
        ${JSON.stringify(stakeholders || {})},
        ${JSON.stringify(requiredDocuments || [])},

        ${costSummary?.totals?.totalCostUsd ?? null},
        ${costSummary?.totals?.totalTokens ?? null},
        ${costSummary?.model || null},
        ${JSON.stringify(rawResearch || {})},

        ${seededByValue},
        ${searchAttemptsValue},

        'ready',
        NOW()
      )
      RETURNING id
      `;
    }

    const savedId = rows[0].id;
    console.log(`[save-dossier] ✅ Dossier ${savedId} saved for ${company.name} (${tenantId})`);

    return res.status(200).json({ success: true, dossierId: savedId });
  } catch (err) {
    console.error("[save-dossier] ❌", err.message);
    return res.status(200).json({ success: false, dossierId: null, warning: "save_failed" });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
