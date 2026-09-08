-- 016_idv_screening.sql
-- Sanctions/PEP/adverse-media screening results, bound to a verification attempt.
-- One row per screening check (e.g. document name and CH name may each be
-- screened). Outcome is append-only in spirit; result JSONB keeps the provider
-- payload server-side only.

CREATE TABLE IF NOT EXISTS idv_screening_checks (
  id                   TEXT PRIMARY KEY,
  attempt_id           TEXT NOT NULL,
  provider             TEXT NOT NULL DEFAULT 'complycube',
  complycube_client_id TEXT,
  complycube_check_id  TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',
  outcome              TEXT,
  categories           JSONB,
  result               JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idv_screening_attempt ON idv_screening_checks (attempt_id);
CREATE INDEX IF NOT EXISTS idx_idv_screening_check ON idv_screening_checks (complycube_check_id);
