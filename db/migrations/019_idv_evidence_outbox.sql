-- 019_idv_evidence_outbox.sql
-- Phase 2.5 sub-step 5: Evidence outbox seam.
--
-- Append-only outbox of Evidence envelopes. An envelope is REFERENCES +
-- PROVENANCE ONLY (Vault reference, external-evidence refs, observations,
-- provider-decision refs, IDs, timestamps) — never plaintext identity, never
-- biometrics. Nothing consumes this table yet: no Evidence rows are created and
-- the Evidence Platform is not called until the Evidence Control Room approves
-- the external-custody + Vault-reference contract (BACKLOG EVID-1).
CREATE TABLE IF NOT EXISTS idv_evidence_outbox (
  id              TEXT PRIMARY KEY,
  attempt_id      TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,   -- dedupes re-publishes of the same result
  envelope        JSONB NOT NULL,         -- references + provenance only
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending until a future consumer (EVID-1)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idv_evidence_outbox_attempt ON idv_evidence_outbox (attempt_id);
