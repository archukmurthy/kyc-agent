-- 023_idv_identity_events.sql
-- Phase E3: immutable identity events. Provider extraction, applicant
-- confirmation, applicant correction, and applicant-supplied gap information are
-- kept as SEPARATE, append-only events (the contract requires them distinct and
-- immutable). Rows carry NO plaintext values — they reference the Vault version
-- that holds the value, plus non-PII metadata only.
CREATE TABLE IF NOT EXISTS idv_identity_events (
  id                        BIGSERIAL PRIMARY KEY,
  attempt_id                TEXT NOT NULL,
  secure_identity_reference TEXT,
  event_type                TEXT NOT NULL CHECK (event_type IN (
                              'extraction_presented',
                              'applicant_confirmed',
                              'applicant_corrected',
                              'applicant_gap_supplied')),
  attribute_concept         TEXT,
  vault_version             INTEGER,          -- points at the Vault attribute version, not the value
  actor                     TEXT,             -- 'applicant' | 'system' | reviewer id
  detail                    JSONB,            -- non-PII metadata only
  occurred_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_idv_identity_events_attempt ON idv_identity_events (attempt_id, occurred_at);
