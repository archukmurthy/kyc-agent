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
// Every UPDATE first appends the current row to entity_dossier_versions (migration 027).
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
    saveReason,
    creationKey,
  } = req.body || {};

  // Self-serve re-research metadata. `seeded_by` records who triggered the
  // search that produced this dossier: 'customer' (self-serve re-research) vs
  // the default 'analyst'. The customer's re-search COUNT is server-owned
  // (api/search-attempt.js → customer_searches) and never written here.
  const seededByValue = seededBy === "customer" ? "customer" : "analyst";

  // One key per analyst research run (Part 4): a retried first save with the
  // same key returns the existing dossier instead of inserting a duplicate.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const creationKeyValue = typeof creationKey === "string" && UUID_RE.test(creationKey) ? creationKey.toLowerCase() : null;

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

    // Why this version is being replaced — whitelisted, never free text.
    const SAVE_REASONS = ["customer_correction", "analyst_update", "customer_update"];
    const reason = SAVE_REASONS.includes(saveReason) ? saveReason : isCustomer ? "customer_update" : "analyst_update";

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
      // overwrite another's row by guessing/replaying an id. The
      // `(${isCustomer} OR owned_by <> 'customer')` clause RE-CHECKS
      // ownership at write time: the permission check above ran against a
      // SELECT taken moments earlier, and an analyst's write can otherwise
      // race a concurrent customer write that flips owned_by in between
      // (TOCTOU) — the analyst's UPDATE would then silently land on a
      // dossier the customer has just taken over.

      // One atomic statement: snapshot the row as it is NOW into the
      // append-only history, then update it. The versions INSERT is a
      // data-modifying CTE — Postgres executes it exactly once even though
      // the outer UPDATE never references `snap` — and it shares the exact
      // same id/tenant/ownership re-check as the UPDATE below, so a write
      // that will be refused normally leaves no history row. Under READ
      // COMMITTED the UPDATE re-checks the latest row version while the
      // INSERT read the statement snapshot, so an ownership flip landing in
      // that instant can still leave one harmless extra history row with a
      // 403 (never an update without a snapshot). A concurrent save can compute the same next
      // version number and hit entity_dossier_versions' UNIQUE(dossier_id,
      // version) (23505); that's handled by the retry below.
      const runSnapshotAndUpdate = () => sql`
        WITH snap AS (
          INSERT INTO entity_dossier_versions (dossier_id, tenant_id, version, snapshot, created_by, reason)
          SELECT
            d.id,
            d.tenant_id,
            COALESCE((SELECT MAX(v.version) FROM entity_dossier_versions v WHERE v.dossier_id = d.id), 0) + 1,
            to_jsonb(d),
            ${actor.kind},
            ${reason}
          FROM entity_dossiers d
          WHERE d.id = ${dossierId} AND d.tenant_id = ${tenantId} AND (${isCustomer} OR d.owned_by <> 'customer')
          RETURNING version
        )
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

          -- Analyst-authored: a customer's link landing never restores these,
          -- so a customer save keeps the stored values instead of wiping them.
          included_fields = CASE WHEN ${isCustomer} THEN included_fields ELSE ${JSON.stringify(includedFields || [])} END,
          excluded_fields = CASE WHEN ${isCustomer} THEN excluded_fields ELSE ${JSON.stringify(excludedFields || [])} END,
          custom_questions = CASE WHEN ${isCustomer} THEN custom_questions ELSE ${JSON.stringify(customQuestions || [])} END,

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

          owned_by = CASE WHEN ${isCustomer} THEN ${"customer"} ELSE owned_by END,
          last_customer_action_at = CASE WHEN ${isCustomer} THEN NOW() ELSE last_customer_action_at END,
          status = 'ready',
          saved_at = NOW()
        WHERE id = ${dossierId} AND tenant_id = ${tenantId} AND (${isCustomer} OR owned_by <> 'customer')
        RETURNING id
      `;

      try {
        rows = await runSnapshotAndUpdate();
      } catch (err) {
        if (err.code !== "23505") throw err;
        // A concurrent save took the same next version number; retry once.
        try {
          rows = await runSnapshotAndUpdate();
        } catch (err2) {
          if (err2.code !== "23505") throw err2;
          return res.status(200).json({ success: false, dossierId: null, warning: "save_conflict" });
        }
      }

      if (rows.length === 0) {
        // The permission check above found the row, but the UPDATE matched
        // none — owned_by flipped to 'customer' between the SELECT and this
        // write. Fail closed: never fall through to the INSERT branch below,
        // which would silently create a duplicate dossier row instead of
        // reporting the lock.
        return res.status(isCustomer ? 404 : 403).json(
          isCustomer ? { error: "dossier_not_found" } : { error: "dossier_locked" }
        );
      }
    }

    if (!existing) {
      // The caller has no id yet (first save), or the id it sent didn't
      // match a row for this tenant (stale/foreign id) — insert fresh rather
      // than silently dropping the save.
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
        creation_key,

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
        ${creationKeyValue},

        'ready',
        NOW()
      )
      ON CONFLICT (tenant_id, creation_key) WHERE creation_key IS NOT NULL
      DO UPDATE SET creation_key = EXCLUDED.creation_key
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
