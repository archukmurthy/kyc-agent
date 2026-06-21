-- Research result cache: serves previously-fetched company research from
-- Postgres instead of re-calling the Anthropic API. Cache-first with a 30-day
-- TTL; the UI's "Force Refresh" toggle bypasses it. Keyed on a normalised
-- company_name|jurisdiction|entity_type string (see lib/researchCache.js).
--
-- Apply with:  node db/apply.js db/migrations/006_research_cache.sql

CREATE TABLE IF NOT EXISTS research_cache (
  id              SERIAL PRIMARY KEY,
  cache_key       TEXT NOT NULL UNIQUE,   -- company_name|jurisdiction|entity_type (lowercased, trimmed)
  company_name    TEXT NOT NULL,
  jurisdiction    TEXT,
  entity_type     TEXT,
  research_result JSONB NOT NULL,         -- full research result object as returned by the API
  model_version   TEXT,                   -- e.g. "claude-sonnet-4-6"
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  hit_count       INTEGER NOT NULL DEFAULT 0,  -- how many times this cache entry has been served
  last_hit_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_research_cache_key ON research_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_research_cache_expires ON research_cache(expires_at);
