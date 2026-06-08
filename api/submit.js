// Live customer onboarding submission → Neon Postgres.
//
// Persists one onboarding_sessions row (with full per-phase cost breakdown),
// upserts the client, and writes individual field_values rows. The write is
// best-effort: any DB failure returns HTTP 200 with a warning so the customer
// is never blocked at the Declaration step.
//
// NOTE: column names below are aligned to the ACTUAL live schema
// (db/migrate.sql + migration 002):
//   - clients has no updated_at column → not referenced in the upsert
//   - field_values uses field_key / source_type (not field_id / source)

// CommonJS (module.exports) rather than ESM `export default` so
// src/setupProxy.js can require() it for local dev — mirrors api/config.js,
// api/benchmark.js, and api/doc-search.js. Vercel supports both forms.
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
    journeyType,
    fieldValues,
    stakeholders,
    documents,
    costSummary,
    coverage,
    declaration,
  } = req.body;

  if (!tenantId || !company?.name) {
    return res.status(400).json({
      error:
        "Missing required fields: tenantId and company.name are required",
    });
  }

  if (!process.env.DATABASE_URL) {
    console.error("[api/submit] No DATABASE_URL");
    return res.status(200).json({
      success: false,
      warning:
        "Database not configured — submission logged to console only",
    });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    // 1. Ensure tenant row exists
    await sql`
      INSERT INTO tenants (id, name, slug)
      VALUES (${tenantId}, ${tenantId}, ${tenantId})
      ON CONFLICT (id) DO NOTHING
    `;

    // 2. Upsert client record (no updated_at column on this table)
    const clientRows = await sql`
      INSERT INTO clients (
        tenant_id,
        legal_name,
        country_code,
        entity_type,
        ownership_type
      )
      VALUES (
        ${tenantId},
        ${company.name},
        ${company.code || null},
        ${entityType || null},
        ${ownershipType || null}
      )
      ON CONFLICT (tenant_id, legal_name, country_code)
      DO UPDATE SET
        entity_type = EXCLUDED.entity_type,
        ownership_type = EXCLUDED.ownership_type
      RETURNING id
    `;

    const clientId = clientRows[0].id;

    // 3. Create onboarding session with full cost breakdown
    const cs = costSummary;
    const cov = coverage;

    const sessionRows = await sql`
      INSERT INTO onboarding_sessions (
        client_id,
        tenant_id,
        schema_key,
        status,
        source,
        journey_type,
        ownership_type,

        total_tokens,
        cost_usd,

        doc_search_input_tokens,
        doc_search_output_tokens,
        doc_search_cost_usd,

        research_p1_input_tokens,
        research_p1_output_tokens,
        research_p1_cost_usd,
        research_p1_fields_found,

        research_p2_input_tokens,
        research_p2_output_tokens,
        research_p2_cost_usd,
        research_p2_fields_found,
        research_p2_ran,

        doc_extract_input_tokens,
        doc_extract_output_tokens,
        doc_extract_cost_usd,

        cost_breakdown,

        fields_prefilled,
        fields_total,
        fill_rate,
        verified_fill_rate,

        raw_result,
        completed_at
      )
      VALUES (
        ${clientId},
        ${tenantId},
        ${(entityType || "") + ":" + (company.code || "")},
        'submitted',
        'customer',
        ${journeyType || null},
        ${ownershipType || null},

        ${cs?.totals?.totalTokens || null},
        ${cs?.totals?.totalCostUsd || null},

        ${cs?.breakdown?.docSearch?.inputTokens || null},
        ${cs?.breakdown?.docSearch?.outputTokens || null},
        ${cs?.breakdown?.docSearch?.costUsd || null},

        ${cs?.breakdown?.researchPass1?.inputTokens || null},
        ${cs?.breakdown?.researchPass1?.outputTokens || null},
        ${cs?.breakdown?.researchPass1?.costUsd || null},
        ${cs?.breakdown?.researchPass1?.fieldsFound || null},

        ${cs?.breakdown?.researchPass2?.inputTokens || null},
        ${cs?.breakdown?.researchPass2?.outputTokens || null},
        ${cs?.breakdown?.researchPass2?.costUsd || null},
        ${cs?.breakdown?.researchPass2?.fieldsFound || null},
        ${cs?.breakdown?.researchPass2?.ran || false},

        ${cs?.breakdown?.docExtraction?.inputTokens || null},
        ${cs?.breakdown?.docExtraction?.outputTokens || null},
        ${cs?.breakdown?.docExtraction?.costUsd || null},

        ${cs ? JSON.stringify(cs) : null},

        ${cov?.populatedFields || null},
        ${cov?.totalResearchFields || null},
        ${cov?.fillRate != null ? Math.round(cov.fillRate * 100) : null},
        ${cov?.verifiedFillRate != null ? Math.round(cov.verifiedFillRate * 100) : null},

        ${JSON.stringify({
          fieldValues: fieldValues || {},
          stakeholders: stakeholders || {},
          documents: documents || [],
          declaration: declaration || {},
          costSummary: cs || null,
          coverage: cov || null,
        })},

        NOW()
      )
      RETURNING id
    `;

    const sessionId = sessionRows[0].id;

    // 4. Write individual field values (field_key / source_type per live schema)
    const allFields = { ...(fieldValues || {}) };

    const fieldEntries = Object.entries(allFields).filter(
      ([, v]) => v !== null && v !== undefined && v !== ""
    );

    for (const [fieldKey, value] of fieldEntries) {
      const stringValue =
        typeof value === "object" ? JSON.stringify(value) : String(value);

      try {
        await sql`
          INSERT INTO field_values (
            session_id,
            field_key,
            value,
            source_type
          )
          VALUES (
            ${sessionId},
            ${fieldKey},
            ${stringValue},
            'customer'
          )
          ON CONFLICT DO NOTHING
        `;
      } catch (fieldErr) {
        // Non-fatal — log and continue
        console.warn(
          `[api/submit] field_values insert failed for ${fieldKey}:`,
          fieldErr.message
        );
      }
    }

    console.log(
      `[api/submit] ✅ Session ${sessionId} saved for ${company.name} ` +
        `(tenant: ${tenantId}) tokens: ${cs?.totals?.totalTokens || 0} ` +
        `cost: $${cs?.totals?.totalCostUsd?.toFixed(6) || "0.000000"}`
    );

    return res.status(200).json({
      success: true,
      sessionId,
      clientId,
    });
  } catch (err) {
    console.error("[api/submit] ❌ DB error:", err);

    // Return 200 so the customer is never blocked even if DB write fails
    return res.status(200).json({
      success: false,
      sessionId: null,
      warning: "DB write failed: " + err.message,
    });
  }
}
