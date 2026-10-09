// Research result cache (cache-first with 30-day TTL).
//
// Company research is expensive: every run hits the Anthropic API. This module
// lets api/research.js serve a previously-fetched result for the same request
// straight from Neon Postgres at zero API cost. The UI's "Force Refresh" toggle
// bypasses the cache when fresh data is needed.
//
// Backed by the research_cache table (db/migrations/006_research_cache.sql).
// Every exported function may throw; callers MUST treat a cache failure as a
// miss and fall through to the live API - never block a research run because
// the cache is unavailable.
//
// The key covers everything that changes the prompt or its answer: tenant
// (each tenant has its own schema), company, jurisdiction, country name,
// entity type, ownership type and registration number.
//
// CommonJS so api/research.js and the node tests can require it. The Neon
// client is built lazily so a missing DATABASE_URL is a catchable error.

const { neon } = require("@neondatabase/serverless");

let _deps = { neon };

function getSql() {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  return _deps.neon(conn);
}

function buildCacheKey({ tenant, companyName, jurisdiction, countryName, entityType, ownershipType, registrationNumber } = {}) {
  const folded = (part) => String(part || "").toLowerCase().trim();
  // Entity and ownership type are case-sensitive schema ids ("FI" and "fi"
  // resolve different schemas), so they are trimmed but never lowercased -
  // otherwise a miscased request could cache a wrong-schema result under the
  // real key.
  const exact = (part) => String(part || "").trim();
  return [
    folded(tenant),
    folded(companyName),
    folded(jurisdiction),
    folded(countryName),
    exact(entityType),
    exact(ownershipType),
    folded(registrationNumber),
  ].join("|");
}

async function getCachedResearch(parts) {
  const sql = getSql();
  const key = buildCacheKey(parts);
  const rows = await sql`
    SELECT research_result, fetched_at, expires_at, hit_count
    FROM research_cache
    WHERE cache_key = ${key}
      AND expires_at > NOW()
    LIMIT 1
  `;
  if (rows.length === 0) return null;

  // Increment hit counter (fire and forget - don't await).
  sql`
    UPDATE research_cache
    SET hit_count = hit_count + 1, last_hit_at = NOW()
    WHERE cache_key = ${key}
  `.catch(() => {});

  return {
    ...rows[0].research_result,
    _fromCache: true,
    _cachedAt: rows[0].fetched_at,
    _cacheHits: rows[0].hit_count + 1,
  };
}

async function saveResearchToCache(parts, result, modelVersion) {
  const sql = getSql();
  const key = buildCacheKey(parts);
  await sql`
    INSERT INTO research_cache (cache_key, company_name, jurisdiction, entity_type, research_result, model_version, fetched_at, expires_at, hit_count)
    VALUES (
      ${key},
      ${parts.companyName},
      ${parts.jurisdiction || null},
      ${parts.entityType || null},
      ${JSON.stringify(result)},
      ${modelVersion || null},
      NOW(),
      NOW() + INTERVAL '30 days',
      0
    )
    ON CONFLICT (cache_key) DO UPDATE SET
      research_result = EXCLUDED.research_result,
      model_version   = EXCLUDED.model_version,
      fetched_at      = NOW(),
      expires_at      = NOW() + INTERVAL '30 days',
      hit_count       = 0,
      last_hit_at     = NULL
  `;
}

module.exports = { buildCacheKey, getCachedResearch, saveResearchToCache };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
