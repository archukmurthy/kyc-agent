-- 027_customer_corrections.sql
-- Part 3: customer correction -> re-research.
-- Additive and idempotent.

-- Server-owned count of re-searches the CUSTOMER has run on this dossier
-- (cap 2). The analyst's original search is not counted. The legacy
-- search_attempts column (migration 008) is left untouched and no longer written.
ALTER TABLE entity_dossiers
  ADD COLUMN IF NOT EXISTS customer_searches INTEGER NOT NULL DEFAULT 0;

-- Append-only history: every dossier row is copied here before it is
-- overwritten, so the analyst's original and every customer revision stay
-- recoverable. No endpoint updates or deletes these rows.
CREATE TABLE IF NOT EXISTS entity_dossier_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id  UUID NOT NULL,
  tenant_id   VARCHAR(64) NOT NULL,
  version     INTEGER NOT NULL,
  snapshot    JSONB NOT NULL,
  created_by  TEXT NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dossier_id, version)
);

-- Which dossier (if any) a submitted application came from.
ALTER TABLE onboarding_sessions
  ADD COLUMN IF NOT EXISTS dossier_id TEXT;

CREATE INDEX IF NOT EXISTS onboarding_sessions_dossier_id_idx
  ON onboarding_sessions (dossier_id);
