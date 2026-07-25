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
const { deriveScalarProvenance } = require("../src/utils/fieldProvenance");

// ─────────────────────────────────────────────────────────────────────────────
// Journey-model persistence (migration 003 tables). ADDITIVE — runs alongside
// the legacy session-table writes and is fully non-fatal: any failure here is
// caught and logged, and never changes the customer's submit response.
//
// Populates five NOW tables from the payload api/submit already receives:
//   journeys · completion_choice · declaration · api_usage · field_provenance
//
// Event log + Vercel Blob document path are a LATER increment (not done here).
//
// KNOWN PAYLOAD GAP: the submit POST body carries `fieldValues` (final values)
// but NOT `fieldMetadata`, so per-SCALAR-field agent_value / customer_action /
// confidence / source are not transmitted today. Rich provenance (agent_value,
// customer_action kept/unchecked/edited, source tier/url, retrieved_at) IS
// available for STAKEHOLDERS (each carries full_name_original + source*), and is
// written. Wiring fieldMetadata into the POST is a follow-on frontend change.
// ─────────────────────────────────────────────────────────────────────────────

// Accept only a syntactically valid IPv4/IPv6 literal for the inet column.
function isInetLiteral(s) {
  if (typeof s !== "string") return false;
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[0-9a-fA-F:]+:[0-9a-fA-F:]*$/;
  return ipv4.test(s) || ipv6.test(s);
}

// journeyType (e.g. "ai_only", "ai_documents") → completion_choice.method enum.
function mapMethod(journeyType) {
  const j = String(journeyType || "").toLowerCase();
  if (j.includes("doc")) return "documents_plus_ai";
  if (j.includes("self") || j.includes("manual")) return "self_complete";
  return "pure_ai";
}

// Best-effort default layer for SCALAR fields (the body doesn't carry per-field
// provenance). self/manual journeys → customer layer; otherwise AI layer.
function mapLayerFromJourney(journeyType) {
  const j = String(journeyType || "").toLowerCase();
  if (j.includes("self") || j.includes("manual")) return "L4_customer";
  return "L3_ai";
}

// Only pass through a value the timestamptz column can parse; else null.
function toTimestamp(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : v;
}

// Writes the five journey-model tables. Returns the journey_id, or null on
// failure. Idempotent: the journey is keyed to the legacy session id (unique),
// child tables upsert on journey_id or delete-then-insert per journey.
async function persistJourneyModel(sql, d) {
  // 1. Journey — one per legacy onboarding_sessions row (bridge via session_id)
  const journeyRows = await sql`
    INSERT INTO journeys (
      tenant_id, session_id, entity_type, jurisdiction, segment, current_step, status, updated_at
    )
    VALUES (
      ${d.tenantId},
      ${d.sessionId},
      ${d.entityType || "unknown"},
      ${d.company?.code || "unknown"},
      ${d.ownershipType || null},
      'declaration',
      'completed',
      now()
    )
    ON CONFLICT (session_id) DO UPDATE SET
      entity_type  = EXCLUDED.entity_type,
      jurisdiction = EXCLUDED.jurisdiction,
      segment      = EXCLUDED.segment,
      current_step = EXCLUDED.current_step,
      status       = EXCLUDED.status,
      updated_at   = now()
    RETURNING journey_id
  `;
  const journeyId = journeyRows[0].journey_id;

  const cs = d.costSummary || null;
  const chosenAt = toTimestamp(d.submittedAt) || new Date().toISOString();

  // 2. Completion choice
  await sql`
    INSERT INTO completion_choice (journey_id, method, agent_mode, chosen_at)
    VALUES (${journeyId}, ${mapMethod(d.journeyType)}, ${null}, ${chosenAt})
    ON CONFLICT (journey_id) DO UPDATE SET
      method = EXCLUDED.method, chosen_at = EXCLUDED.chosen_at
  `;

  // 3. Declaration — pulled out of the declaration JSON block
  const dec = d.declaration || {};
  const consentAt =
    toTimestamp(dec.agreedAt) || toTimestamp(dec.certifiedAt) ||
    toTimestamp(dec.timestamp) || chosenAt;
  const consentGiven = !!(dec.agreedAt || dec.certifiedAt || dec.timestamp);
  await sql`
    INSERT INTO declaration (
      journey_id, declaration_version, consent_given, consent_at,
      ip_address, user_agent, geolocation, timezone, signed_at
    )
    VALUES (
      ${journeyId},
      ${dec.declarationVersion || "v1"},
      ${consentGiven},
      ${consentAt},
      ${isInetLiteral(dec.ipAddress) ? dec.ipAddress : null},
      ${dec.userAgent || null},
      ${null},
      ${dec.timezone || null},
      ${toTimestamp(d.submittedAt) || consentAt}
    )
    ON CONFLICT (journey_id) DO UPDATE SET
      declaration_version = EXCLUDED.declaration_version,
      consent_given = EXCLUDED.consent_given,
      consent_at    = EXCLUDED.consent_at,
      ip_address    = EXCLUDED.ip_address,
      user_agent    = EXCLUDED.user_agent,
      timezone      = EXCLUDED.timezone,
      signed_at     = EXCLUDED.signed_at
  `;

  // 4. api_usage — one row per cost phase. Cost is RECOMPUTED from the pricing
  // table (by pricing_version), not taken from the payload's hardcoded figure.
  await sql`DELETE FROM api_usage WHERE journey_id = ${journeyId}`;
  if (cs && cs.breakdown) {
    const model = cs.model || null;
    let priceRow = null;
    if (model) {
      const pr = await sql`
        SELECT pricing_version, input_per_mtok, output_per_mtok
        FROM pricing WHERE model = ${model}
        ORDER BY effective_from DESC LIMIT 1
      `;
      priceRow = pr[0] || null;
    }
    const phases = [
      ["doc_search", "research", cs.breakdown.docSearch],
      ["research_pass_1", "research", cs.breakdown.researchPass1],
      ["research_pass_2", "research", cs.breakdown.researchPass2],
      ["doc_extraction", "confirm", cs.breakdown.docExtraction],
    ];
    for (const [action, step, ph] of phases) {
      if (!ph) continue;
      const inTok = ph.inputTokens || 0;
      const outTok = ph.outputTokens || 0;
      let cost = null;
      let pv = null;
      if (priceRow) {
        cost =
          (inTok / 1e6) * Number(priceRow.input_per_mtok) +
          (outTok / 1e6) * Number(priceRow.output_per_mtok);
        pv = priceRow.pricing_version;
      }
      try {
        await sql`
          INSERT INTO api_usage (
            journey_id, step, action, model, input_tokens, output_tokens,
            cache_read_tokens, cache_write_tokens, cost, pricing_version,
            latency_ms, success
          )
          VALUES (
            ${journeyId}, ${step}, ${action}, ${model || "unknown"},
            ${inTok}, ${outTok}, ${null}, ${null}, ${cost}, ${pv}, ${null}, ${true}
          )
        `;
      } catch (e) {
        console.warn(`[api/submit] api_usage insert failed (${action}):`, e.message);
      }
    }
  }

  // 5. field_provenance — never overwrite agent_value. Baseline rows from scalar
  // fields (layer heuristic; the body lacks per-field metadata) + rich rows from
  // stakeholders (which DO carry agent_value via full_name_original + source*).
  await sql`DELETE FROM field_provenance WHERE journey_id = ${journeyId}`;
  const stake = d.stakeholders || {};
  const scalarLayer = mapLayerFromJourney(d.journeyType);
  // Applicant identity fields get their own rich provenance rows below (with
  // agent_value + accepted/overridden/provided action), so skip them here to
  // avoid duplicate field_provenance rows for the same field_name.
  const applicantProv = Array.isArray(d.applicantProvenance) ? d.applicantProvenance : [];
  const applicantFieldNames = new Set(applicantProv.map((p) => p.fieldId));

  // Per-field provenance trail from the client, keyed by field id. Scalars used
  // to write no agent_value at all, which made change_events.before_value the
  // ONLY durable record of a corrected scalar's original registry value — a
  // single point of failure for the one thing that must never be lost. With the
  // trail transmitted, scalars now carry the same agent_value / customer_value /
  // customer_action discipline the stakeholder and applicant rows already use.
  const metaByField = new Map();
  for (const m of Array.isArray(d.fieldMetadata) ? d.fieldMetadata : []) {
    if (m && m.fieldId) metaByField.set(m.fieldId, m);
  }

  for (const [k, v] of Object.entries(d.fieldValues || {})) {
    if (v === null || v === undefined || v === "") continue;
    if (stake[k]) continue; // handled as stakeholder rows below
    if (applicantFieldNames.has(k)) continue; // handled as applicant rows below
    const val = typeof v === "object" ? JSON.stringify(v) : String(v);
    const meta = metaByField.get(k);
    // agent_value is ALWAYS the AI/registry original, never the customer's
    // value — see src/utils/fieldProvenance.js for the rule and its tests.
    const { agentValue, customerAction } = deriveScalarProvenance(meta);
    try {
      await sql`
        INSERT INTO field_provenance (
          journey_id, field_name, final_value, customer_value, layer, model_version,
          agent_value, customer_action, source_tier, source_identity
        )
        VALUES (
          ${journeyId}, ${k}, ${val}, ${val}, ${scalarLayer},
          ${scalarLayer === "L3_ai" ? cs?.model || null : null},
          ${agentValue}, ${customerAction},
          ${(meta && (meta.agentSourceTier || meta.sourceTier)) || null},
          ${(meta && (meta.agentSource || meta.source)) || null}
        )
      `;
    } catch (e) {
      console.warn(`[api/submit] field_provenance scalar insert failed (${k}):`, e.message);
    }
  }

  for (const [field, list] of Object.entries(stake)) {
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      const finalVal = s.is_company ? s.businessName || "" : s.full_name || "";
      const agentVal = s.full_name_original || (s.customer_added ? null : finalVal);
      let action = "kept";
      if (s.customer_rejected) action = "unchecked";
      else if (s.customer_added) action = "edited";
      else if (s.full_name_original && s.full_name_original !== finalVal) action = "edited";
      const layer = s.customer_added ? "L4_customer" : "L3_ai";
      try {
        await sql`
          INSERT INTO field_provenance (
            journey_id, field_name, final_value, layer, source_tier, source_identity,
            source_url, retrieved_at, model_version, agent_value, customer_action, customer_value
          )
          VALUES (
            ${journeyId}, ${field + "." + (s.id || "unknown")}, ${finalVal}, ${layer},
            ${s.sourceTier || null}, ${s.source || null}, ${s.sourceUrl || null},
            ${toTimestamp(s.fetchedAt)}, ${layer === "L3_ai" ? cs?.model || null : null},
            ${agentVal}, ${action}, ${finalVal}
          )
        `;
      } catch (e) {
        console.warn(`[api/submit] field_provenance stakeholder insert failed (${field}):`, e.message);
      }
    }
  }

  // Applicant identity provenance — rich rows carrying agent_value + the
  // customer's action (accepted / overridden / provided). Mapped onto the real
  // (journey-keyed) field_provenance columns: field_name, agent_value,
  // customer_value/final_value, customer_action, source_identity, source_tier,
  // retrieved_at. layer = L3_ai when an agent value was shown, else L4_customer.
  for (const prov of applicantProv) {
    const layer = prov.agentValue ? "L3_ai" : "L4_customer";
    try {
      await sql`
        INSERT INTO field_provenance (
          journey_id, field_name, final_value, customer_value, layer,
          source_tier, source_identity, retrieved_at, agent_value, customer_action,
          model_version
        )
        VALUES (
          ${journeyId}, ${prov.fieldId}, ${prov.customerValue || null}, ${prov.customerValue || null}, ${layer},
          ${prov.sourceTier || null}, ${prov.source || null}, ${toTimestamp(prov.retrievedAt)},
          ${prov.agentValue || null}, ${prov.customerAction || "provided"},
          ${layer === "L3_ai" ? cs?.model || null : null}
        )
      `;
    } catch (e) {
      console.warn(`[api/submit] field_provenance applicant insert failed (${prov.fieldId}):`, e.message);
    }
  }

  return journeyId;
}

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
    // Per-field provenance trail. Must be destructured here AND forwarded to
    // persistJourneyModel below — that call passes an explicitly-constructed
    // object, so a key missing from either place silently becomes undefined and
    // every scalar's agent_value falls back to NULL.
    fieldMetadata,
    stakeholders,
    documents,
    costSummary,
    coverage,
    declaration,
    applicant,
    applicantProvenance,
    applicantOverrides,
    submittedAt,
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
          applicant: applicant || null,
          applicantProvenance: applicantProvenance || [],
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

    // 4b. Write applicant override events to session_timeline (audit trail).
    // Session-keyed and independent of the journey-model write, so overrides are
    // captured even if journey persistence fails. Non-fatal per event.
    const overrides = Array.isArray(applicantOverrides) ? applicantOverrides : [];
    for (const ov of overrides) {
      try {
        await sql`
          INSERT INTO session_timeline (
            session_id, event_type, event_data, tenant_id, occurred_at
          )
          VALUES (
            ${sessionId},
            'applicant_field_overridden',
            ${JSON.stringify({
              fieldId: ov.fieldId,
              fieldLabel: ov.fieldLabel,
              agentValue: ov.agentValue,
              customerValue: ov.customerValue,
              source: ov.source,
              sourceTier: ov.sourceTier,
              overriddenAt: ov.overriddenAt,
            })},
            ${tenantId},
            NOW()
          )
        `;
      } catch (evErr) {
        console.warn(
          `[api/submit] override event write failed for ${ov.fieldId}:`,
          evErr.message
        );
      }
    }

    if (overrides.length > 0) {
      console.log(
        `[api/submit] ⚠ Applicant overrode ${overrides.length} pre-filled field(s) ` +
          `for session ${sessionId}:`,
        overrides
          .map((o) => `${o.fieldId}: "${o.agentValue}" → "${o.customerValue}"`)
          .join(", ")
      );
    }

    console.log(
      `[api/submit] ✅ Session ${sessionId} saved for ${company.name} ` +
        `(tenant: ${tenantId}) tokens: ${cs?.totals?.totalTokens || 0} ` +
        `cost: $${cs?.totals?.totalCostUsd?.toFixed(6) || "0.000000"}`
    );

    // 5. ADDITIVE journey-model persistence (migration 003 tables). Fully
    // non-fatal — a failure here must never change the customer's response.
    let journeyId = null;
    try {
      journeyId = await persistJourneyModel(sql, {
        tenantId,
        company,
        entityType,
        ownershipType,
        journeyType,
        fieldValues,
        fieldMetadata,
        stakeholders,
        costSummary: cs,
        coverage: cov,
        declaration,
        applicantProvenance,
        sessionId,
        submittedAt,
      });
      console.log(`[api/submit] ✅ Journey-model persisted — journey ${journeyId}`);
    } catch (journeyErr) {
      console.error(
        "[api/submit] ⚠ journey-model persistence failed (non-fatal):",
        journeyErr.message
      );
    }

    return res.status(200).json({
      success: true,
      sessionId,
      clientId,
      journeyId,
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
};

// Exported for testing (idempotency / unit checks). Not used by the request
// path, which calls persistJourneyModel internally.
module.exports.persistJourneyModel = persistJourneyModel;
