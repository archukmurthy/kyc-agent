"use strict";

const { neon } = require("@neondatabase/serverless");
const { identity } = require("./uboPersistence");
const { withTimeout } = require("./boundedAsync");

const DATABASE_AUDIT_TIMEOUT_MS = Number(process.env.UBO_DATABASE_AUDIT_TIMEOUT_MS || 2500);

async function persistUboInvestigation({ tenantId, input, cacheHit, forceRefresh, result, timeoutMs = DATABASE_AUDIT_TIMEOUT_MS }) {
  if (!process.env.DATABASE_URL) return { persisted: false, reason: "DATABASE_URL not configured" };
  try {
    const sql = neon(process.env.DATABASE_URL);
    await withTimeout(() => sql`
      INSERT INTO ubo_investigations (
        tenant_id, entity_identity_hash, entity_name, jurisdiction, registration_number,
        status, cache_hit, force_refresh, cached_at, valid_until, source_config,
        search_events, investigation_log, ownership_graph, evidence, resolutions,
        determination, missing_information, budget
      ) VALUES (
        ${tenantId}, ${identity(input)}, ${input.entityName}, ${input.jurisdiction}, ${input.registrationNumber || null},
        ${result.status}, ${cacheHit}, ${forceRefresh}, ${result.cache?.cachedAt || null}, ${result.cache?.validUntil || null}, ${JSON.stringify({ sources: ["web_research"]})},
        ${JSON.stringify(result.searchEvents || [])}, ${JSON.stringify(result.investigationLog || [])}, ${JSON.stringify(result.ownershipGraph || {})}, ${JSON.stringify(result.evidence || [])}, ${JSON.stringify(result.resolutions || [])},
        ${JSON.stringify({ ubos: result.ubos || [], explanations: result.explanations || []})}, ${JSON.stringify(result.missingInformation || [])}, ${JSON.stringify(result.budget || {})}
      )
    `, { label: "UBO database audit persistence", timeoutMs });
    return { persisted: true };
  } catch (error) {
    console.warn("[uboDatabaseAudit]", error.message);
    return { persisted: false, reason: error.message };
  }
}

module.exports = { persistUboInvestigation };
