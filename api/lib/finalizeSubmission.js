// api/lib/finalizeSubmission.js
"use strict";

// All-or-nothing persistence of one customer submission into the 11 domain tables.
// Runs on a pooled client inside a single BEGIN/COMMIT so the record is never
// half-written. Idempotent on payload.submissionId: onboarding_sessions upserts on
// submission_id and every child table is DELETE-by-parent-then-INSERT, so the
// worker can retry safely without duplicating. Throws on ANY failure after
// ROLLBACK - the caller keeps the inbox row pending for a later retry.
const { getPool } = require("./neonPool");
const { deriveScalarProvenance } = require("../../src/utils/fieldProvenance");

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

async function finalizeSubmission(payload, deps = {}) {
  const {
    submissionId, tenantId, company, entityType, ownershipType, journeyType,
    fieldValues, fieldMetadata, stakeholders, stakeholderAttributes,
    amendmentDocuments, confirmMetrics, documents, costSummary, coverage,
    declaration, applicant, applicantProvenance, applicantOverrides, submittedAt,
    dossierId,
  } = payload;

  if (!submissionId) throw new Error("finalizeSubmission: submissionId is required");
  if (!tenantId || !company || !company.name) {
    throw new Error("finalizeSubmission: tenantId and company.name are required");
  }

  const cs = costSummary || null;
  const cov = coverage || null;

  const pool = deps.pool || getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Ensure tenant row exists - port api/submit.js:424-428
    await client.query(
      `INSERT INTO tenants (id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, tenantId, tenantId]
    );

    // 2. Upsert client record (no updated_at column on this table)
    //    - port api/submit.js:431-453
    const clientResult = await client.query(
      `INSERT INTO clients (
        tenant_id, legal_name, country_code, entity_type, ownership_type
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id, legal_name, country_code)
      DO UPDATE SET
        entity_type = EXCLUDED.entity_type,
        ownership_type = EXCLUDED.ownership_type
      RETURNING id`,
      [tenantId, company.name, company.code || null, entityType || null, ownershipType || null]
    );
    const clientId = clientResult.rows[0].id;

    // 3. Create onboarding session with full cost breakdown, keyed idempotently
    //    on submission_id - port api/submit.js:459-564 (+ submission_id column
    //    and ON CONFLICT (submission_id) upsert so re-finalize returns the SAME id)
    const sessionResult = await client.query(
      `INSERT INTO onboarding_sessions ( submission_id,
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
        dossier_id,
        completed_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        'submitted',
        'customer',
        $5,
        $6,

        $7,
        $8,

        $9,
        $10,
        $11,

        $12,
        $13,
        $14,
        $15,

        $16,
        $17,
        $18,
        $19,
        $20,

        $21,
        $22,
        $23,

        $24,

        $25,
        $26,
        $27,
        $28,

        $29,
        $30,
        NOW()
      )
      ON CONFLICT (submission_id) WHERE submission_id IS NOT NULL DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = EXCLUDED.completed_at
      RETURNING id`,
      [
        submissionId,
        clientId,
        tenantId,
        (entityType || "") + ":" + (company.code || ""),
        journeyType || null,
        ownershipType || null,

        cs?.totals?.totalTokens || null,
        cs?.totals?.totalCostUsd || null,

        cs?.breakdown?.docSearch?.inputTokens || null,
        cs?.breakdown?.docSearch?.outputTokens || null,
        cs?.breakdown?.docSearch?.costUsd || null,

        cs?.breakdown?.researchPass1?.inputTokens || null,
        cs?.breakdown?.researchPass1?.outputTokens || null,
        cs?.breakdown?.researchPass1?.costUsd || null,
        cs?.breakdown?.researchPass1?.fieldsFound || null,

        cs?.breakdown?.researchPass2?.inputTokens || null,
        cs?.breakdown?.researchPass2?.outputTokens || null,
        cs?.breakdown?.researchPass2?.costUsd || null,
        cs?.breakdown?.researchPass2?.fieldsFound || null,
        cs?.breakdown?.researchPass2?.ran || false,

        cs?.breakdown?.docExtraction?.inputTokens || null,
        cs?.breakdown?.docExtraction?.outputTokens || null,
        cs?.breakdown?.docExtraction?.costUsd || null,

        cs ? JSON.stringify(cs) : null,

        cov?.populatedFields || null,
        cov?.totalResearchFields || null,
        cov?.fillRate != null ? Math.round(cov.fillRate * 100) : null,
        cov?.verifiedFillRate != null ? Math.round(cov.verifiedFillRate * 100) : null,

        JSON.stringify({
          fieldValues: fieldValues || {},
          stakeholders: stakeholders || {},
          documents: documents || [],
          declaration: declaration || {},
          costSummary: cs || null,
          coverage: cov || null,
          applicant: applicant || null,
          applicantProvenance: applicantProvenance || [],
          confirmMetrics: confirmMetrics || null,
          amendmentDocuments: amendmentDocuments || [],
        }),

        dossierId || null,
      ]
    );
    const sessionId = sessionResult.rows[0].id;

    // A verified customer submission (api/submit.js checked the link token)
    // makes the dossier customer-owned: from now on the analyst may only read it.
    if (dossierId) {
      await client.query(
        `UPDATE entity_dossiers
         SET owned_by = 'customer', last_customer_action_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND status != 'deleted'`,
        [dossierId, tenantId]
      );
    }

    // 4. Write individual field values (DELETE-then-insert so a re-run rewrites)
    //    - port api/submit.js:566-600
    await client.query(`DELETE FROM field_values WHERE session_id = $1`, [sessionId]);
    const allFields = { ...(fieldValues || {}) };
    const fieldEntries = Object.entries(allFields).filter(
      ([, v]) => v !== null && v !== undefined && v !== ""
    );
    for (const [fieldKey, value] of fieldEntries) {
      const stringValue =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      await client.query(
        `INSERT INTO field_values (
          session_id, field_key, value, source_type
        )
        VALUES ($1, $2, $3, 'customer')
        ON CONFLICT DO NOTHING`,
        [sessionId, fieldKey, stringValue]
      );
    }

    // 4b. Applicant override events to session_timeline (audit trail).
    //     DELETE-then-insert so a re-run rewrites - port api/submit.js:602-644
    await client.query(
      `DELETE FROM session_timeline WHERE session_id = $1 AND event_type = 'applicant_field_overridden'`,
      [sessionId]
    );
    const overrides = Array.isArray(applicantOverrides) ? applicantOverrides : [];
    for (const ov of overrides) {
      await client.query(
        `INSERT INTO session_timeline (
          session_id, event_type, event_data, tenant_id, occurred_at
        )
        VALUES ($1, 'applicant_field_overridden', $2, $3, NOW())`,
        [
          sessionId,
          JSON.stringify({
            fieldId: ov.fieldId,
            fieldLabel: ov.fieldLabel,
            agentValue: ov.agentValue,
            customerValue: ov.customerValue,
            source: ov.source,
            sourceTier: ov.sourceTier,
            overriddenAt: ov.overriddenAt,
          }),
          tenantId,
        ]
      );
    }

    // 5. Journey-model writes (migration 003 tables) - port api/submit.js:71-368
    const journeyId = await persistJourneyModel(client, {
      tenantId,
      company,
      entityType,
      ownershipType,
      journeyType,
      fieldValues,
      fieldMetadata,
      stakeholders,
      stakeholderAttributes,
      amendmentDocuments,
      costSummary: cs,
      coverage: cov,
      declaration,
      applicantProvenance,
      sessionId,
      submittedAt,
    });

    await client.query("COMMIT");
    return { sessionId, clientId, journeyId };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { /* ignore rollback error */ }
    throw err;
  } finally {
    client.release();
  }
}

// Writes the journey-model tables on the SAME pooled client / transaction.
// Returns the journey_id. Cost is recomputed from the pricing table; provenance
// rules are verbatim from api/submit.js - only the call form (client.query with
// $-placeholders) and the removal of per-insert try/catch swallows differ.
async function persistJourneyModel(client, d) {
  // 1. Journey - one per legacy onboarding_sessions row (bridge via session_id)
  const journeyResult = await client.query(
    `INSERT INTO journeys (
      tenant_id, session_id, entity_type, jurisdiction, segment, current_step, status, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, 'declaration', 'completed', now())
    ON CONFLICT (session_id) DO UPDATE SET
      entity_type  = EXCLUDED.entity_type,
      jurisdiction = EXCLUDED.jurisdiction,
      segment      = EXCLUDED.segment,
      current_step = EXCLUDED.current_step,
      status       = EXCLUDED.status,
      updated_at   = now()
    RETURNING journey_id`,
    [
      d.tenantId,
      d.sessionId,
      d.entityType || "unknown",
      d.company?.code || "unknown",
      d.ownershipType || null,
    ]
  );
  const journeyId = journeyResult.rows[0].journey_id;

  const cs = d.costSummary || null;
  const chosenAt = toTimestamp(d.submittedAt) || new Date().toISOString();

  // 2. Completion choice
  await client.query(
    `INSERT INTO completion_choice (journey_id, method, agent_mode, chosen_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (journey_id) DO UPDATE SET
      method = EXCLUDED.method, chosen_at = EXCLUDED.chosen_at`,
    [journeyId, mapMethod(d.journeyType), null, chosenAt]
  );

  // 3. Declaration - pulled out of the declaration JSON block
  const dec = d.declaration || {};
  const consentAt =
    toTimestamp(dec.agreedAt) || toTimestamp(dec.certifiedAt) ||
    toTimestamp(dec.timestamp) || chosenAt;
  const consentGiven = !!(dec.agreedAt || dec.certifiedAt || dec.timestamp);
  await client.query(
    `INSERT INTO declaration (
      journey_id, declaration_version, consent_given, consent_at,
      ip_address, user_agent, geolocation, timezone, signed_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (journey_id) DO UPDATE SET
      declaration_version = EXCLUDED.declaration_version,
      consent_given = EXCLUDED.consent_given,
      consent_at    = EXCLUDED.consent_at,
      ip_address    = EXCLUDED.ip_address,
      user_agent    = EXCLUDED.user_agent,
      timezone      = EXCLUDED.timezone,
      signed_at     = EXCLUDED.signed_at`,
    [
      journeyId,
      dec.declarationVersion || "v1",
      consentGiven,
      consentAt,
      isInetLiteral(dec.ipAddress) ? dec.ipAddress : null,
      dec.userAgent || null,
      null,
      dec.timezone || null,
      toTimestamp(d.submittedAt) || consentAt,
    ]
  );

  // 4. api_usage - one row per cost phase. Cost is RECOMPUTED from the pricing
  // table (by pricing_version), not taken from the payload's hardcoded figure.
  await client.query(`DELETE FROM api_usage WHERE journey_id = $1`, [journeyId]);
  if (cs && cs.breakdown) {
    const model = cs.model || null;
    let priceRow = null;
    if (model) {
      const pr = await client.query(
        `SELECT pricing_version, input_per_mtok, output_per_mtok
        FROM pricing WHERE model = $1
        ORDER BY effective_from DESC LIMIT 1`,
        [model]
      );
      priceRow = pr.rows[0] || null;
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
      await client.query(
        `INSERT INTO api_usage (
          journey_id, step, action, model, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, cost, pricing_version,
          latency_ms, success
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [journeyId, step, action, model || "unknown", inTok, outTok, null, null, cost, pv, null, true]
      );
    }
  }

  // 5. field_provenance - never overwrite agent_value. Baseline rows from scalar
  // fields (layer heuristic; the body lacks per-field metadata) + rich rows from
  // stakeholders (which DO carry agent_value via full_name_original + source*).
  await client.query(`DELETE FROM field_provenance WHERE journey_id = $1`, [journeyId]);
  const stake = d.stakeholders || {};
  const scalarLayer = mapLayerFromJourney(d.journeyType);
  // Applicant identity fields get their own rich provenance rows below (with
  // agent_value + accepted/overridden/provided action), so skip them here to
  // avoid duplicate field_provenance rows for the same field_name.
  const applicantProv = Array.isArray(d.applicantProvenance) ? d.applicantProvenance : [];
  const applicantFieldNames = new Set(applicantProv.map((p) => p.fieldId));

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
    // value - see src/utils/fieldProvenance.js for the rule and its tests.
    const { agentValue, customerAction } = deriveScalarProvenance(meta);
    await client.query(
      `INSERT INTO field_provenance (
        journey_id, field_name, final_value, customer_value, layer, model_version,
        agent_value, customer_action, source_tier, source_identity
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        journeyId, k, val, val, scalarLayer,
        scalarLayer === "L3_ai" ? cs?.model || null : null,
        agentValue, customerAction,
        (meta && (meta.agentSourceTier || meta.sourceTier)) || null,
        (meta && (meta.agentSource || meta.source)) || null,
      ]
    );
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
      await client.query(
        `INSERT INTO field_provenance (
          journey_id, field_name, final_value, layer, source_tier, source_identity,
          source_url, retrieved_at, model_version, agent_value, customer_action, customer_value
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          journeyId, field + "." + (s.id || "unknown"), finalVal, layer,
          s.sourceTier || null, s.source || null, s.sourceUrl || null,
          toTimestamp(s.fetchedAt), layer === "L3_ai" ? cs?.model || null : null,
          agentVal, action, finalVal,
        ]
      );
    }
  }

  // PER-ATTRIBUTE stakeholder provenance. field_name is
  // `<field>.<stakeholderId>.<attribute>`.
  for (const a of Array.isArray(d.stakeholderAttributes) ? d.stakeholderAttributes : []) {
    if (!a || !a.fieldId || !a.stakeholderId || !a.attribute) continue;
    // L4 when the value came from the customer, L3 when research supplied it.
    const layer = a.researchable && a.customerAction !== "edited" ? "L3_ai" : "L4_customer";
    await client.query(
      `INSERT INTO field_provenance (
        journey_id, field_name, final_value, customer_value, layer,
        source_tier, source_identity, source_url, retrieved_at,
        agent_value, customer_action, researchable, model_version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        journeyId,
        `${a.fieldId}.${a.stakeholderId}.${a.attribute}`,
        a.value ?? null, a.value ?? null, layer,
        a.sourceTier || null, a.source || null, a.sourceUrl || null,
        toTimestamp(a.fetchedAt),
        a.agentValue ?? null, a.customerAction || null, a.researchable === true,
        layer === "L3_ai" ? cs?.model || null : null,
      ]
    );
  }

  // Applicant identity provenance - rich rows carrying agent_value + the
  // customer's action (accepted / overridden / provided).
  for (const prov of applicantProv) {
    const layer = prov.agentValue ? "L3_ai" : "L4_customer";
    await client.query(
      `INSERT INTO field_provenance (
        journey_id, field_name, final_value, customer_value, layer,
        source_tier, source_identity, retrieved_at, agent_value, customer_action,
        model_version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        journeyId, prov.fieldId, prov.customerValue || null, prov.customerValue || null, layer,
        prov.sourceTier || null, prov.source || null, toTimestamp(prov.retrievedAt),
        prov.agentValue || null, prov.customerAction || "provided",
        layer === "L3_ai" ? cs?.model || null : null,
      ]
    );
  }

  // AMENDMENT DOCUMENTS - only SATISFIED requests are written. DELETE-then-insert
  // so a re-run rewrites, never duplicates.
  await client.query(`DELETE FROM documents WHERE journey_id = $1`, [journeyId]);
  for (const doc of Array.isArray(d.amendmentDocuments) ? d.amendmentDocuments : []) {
    if (!doc || !doc.satisfied || !doc.docType || !d.sessionId) continue;
    await client.query(
      `INSERT INTO documents (
        session_id, journey_id, document_type, storage_url, blob_key,
        original_name, uploaded_by, actor_type, source, step,
        processing_status, is_mandatory, uploaded_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, 'customer', 'customer', 'customer', 'confirm_amendment',
        'stored', $7, $8
      )`,
      [
        d.sessionId, journeyId, doc.docType, doc.blobUrl || null,
        doc.pathname || null, doc.filename || null,
        true, toTimestamp(doc.uploadedAt) || new Date().toISOString(),
      ]
    );
  }

  return journeyId;
}

module.exports = { finalizeSubmission };
