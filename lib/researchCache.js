// Research result cache (cache-first with 30-day TTL).
//
// Company research is expensive: every run hits the Anthropic API. This module
// lets api/research.js serve a previously-fetched result for the same company
// straight from Neon Postgres at zero API cost. The UI's "Force Refresh" toggle
// bypasses the cache when fresh data is needed.
//
// Backed by the research_cache table (db/migrations/006_research_cache.sql).
// Every exported function may throw; callers MUST treat a cache failure as a
// miss and fall through to the live API — never block a research run because the
// cache is unavailable.
//
// ESM to match api/research.js, the only consumer. The Neon client is built
// lazily (not at module load) so a missing DATABASE_URL surfaces as a contained,
// catchable error instead of crashing the research endpoint at import time.

import { neon } from '@neondatabase/serverless';

function getSql() {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error('DATABASE_URL not set');
  return neon(conn);
}

/**
 * Build a deterministic cache key from search inputs.
 * Lowercased and trimmed so "Stripe UK" and "stripe uk" hit the same entry.
 */
export function buildCacheKey(companyName, jurisdiction, entityType) {
  const parts = [
    (companyName || '').toLowerCase().trim(),
    (jurisdiction || '').toLowerCase().trim(),
    (entityType || '').toLowerCase().trim(),
  ];
  return parts.join('|');
}

/**
 * Look up a cached research result.
 * Returns the cached result object if found and not expired, otherwise null.
 */
export async function getCachedResearch(companyName, jurisdiction, entityType) {
  const sql = getSql();
  const key = buildCacheKey(companyName, jurisdiction, entityType);
  const rows = await sql`
    SELECT research_result, fetched_at, expires_at, hit_count
    FROM research_cache
    WHERE cache_key = ${key}
      AND expires_at > NOW()
    LIMIT 1
  `;
  if (rows.length === 0) return null;

  // Increment hit counter (fire and forget — don't await)
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

/**
 * Save a research result to cache.
 * Upserts so re-runs on the same key update the entry rather than failing.
 */
export async function saveResearchToCache(companyName, jurisdiction, entityType, result, modelVersion) {
  const sql = getSql();
  const key = buildCacheKey(companyName, jurisdiction, entityType);
  await sql`
    INSERT INTO research_cache (cache_key, company_name, jurisdiction, entity_type, research_result, model_version, fetched_at, expires_at, hit_count)
    VALUES (
      ${key},
      ${companyName},
      ${jurisdiction || null},
      ${entityType || null},
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
