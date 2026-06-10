// Persists a pre-boarding entity dossier → Neon `entity_dossiers`.
//
// CommonJS (module.exports), not `export default`, so src/setupProxy.js can
// require() it for local `npm start` (mirrors api/submit.js, api/track-event.js).
// Always returns 200 — a save failure must never block the analyst.

const { neon } = require("@neondatabase/serverless");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    tenantId,
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
  } = req.body || {};

  if (!tenantId || !company?.name) {
    return res.status(400).json({ error: "tenantId and company.name required" });
  }

  if (!process.env.DATABASE_URL) {
    console.warn("[save-dossier] No DATABASE_URL");
    return res.status(200).json({ success: false, dossierId: null, warning: "Database not configured" });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Ensure tenant exists (slug is NOT NULL on this table).
    await sql`
      INSERT INTO tenants (id, name, slug)
      VALUES (${tenantId}, ${tenantId}, ${tenantId})
      ON CONFLICT (id) DO NOTHING
    `;

    const rows = await sql`
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

        'ready',
        NOW()
      )
      RETURNING id
    `;

    const dossierId = rows[0].id;
    console.log(`[save-dossier] ✅ Dossier ${dossierId} saved for ${company.name} (${tenantId})`);

    return res.status(200).json({ success: true, dossierId });
  } catch (err) {
    console.error("[save-dossier] ❌", err.message);
    return res.status(200).json({ success: false, dossierId: null, warning: err.message });
  }
};
