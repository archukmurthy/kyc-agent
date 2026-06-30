-- Immutable audit snapshots for UBO discovery. Apply with:
-- node db/apply.js db/migrations/009_ubo_investigations.sql
CREATE TABLE IF NOT EXISTS ubo_investigations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  entity_identity_hash VARCHAR(64) NOT NULL,
  entity_name TEXT NOT NULL,
  jurisdiction VARCHAR(10),
  registration_number TEXT,
  status VARCHAR(32) NOT NULL,
  cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  force_refresh BOOLEAN NOT NULL DEFAULT FALSE,
  cached_at TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  source_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_events JSONB NOT NULL DEFAULT '[]'::jsonb,
  investigation_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  ownership_graph JSONB,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolutions JSONB NOT NULL DEFAULT '[]'::jsonb,
  determination JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_information JSONB NOT NULL DEFAULT '[]'::jsonb,
  budget JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ubo_investigations_identity_created ON ubo_investigations (tenant_id, entity_identity_hash, created_at DESC);
