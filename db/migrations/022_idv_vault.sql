-- 022_idv_vault.sql
-- Phase E2: durable, encrypted PII Vault (behind api/idv-match/identityVault.js).
--
-- Sensitive extracted identity attributes are envelope-encrypted (AES-256-GCM,
-- per-item DEK wrapped by the managed key provider) and stored here, addressed
-- by an opaque secure_identity_reference. Ordinary IDV tables keep only that
-- reference. Attributes are append-only/versioned (a correction adds a new
-- version; the original is preserved). Every authorized read is audited.
CREATE TABLE IF NOT EXISTS idv_vault_records (
  secure_identity_reference TEXT PRIMARY KEY,
  session_id                TEXT NOT NULL,
  tenant_id                 TEXT,
  subject_id                TEXT,
  retention_metadata        JSONB,
  deletion_status           TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_idv_vault_records_session ON idv_vault_records (session_id);

CREATE TABLE IF NOT EXISTS idv_vault_attributes (
  id                        BIGSERIAL PRIMARY KEY,
  secure_identity_reference TEXT NOT NULL REFERENCES idv_vault_records (secure_identity_reference),
  attribute_id              TEXT NOT NULL,
  attribute_concept         TEXT NOT NULL,
  -- envelope-encrypted value (no plaintext anywhere in this row)
  ciphertext                TEXT NOT NULL,
  nonce                     TEXT NOT NULL,
  auth_tag                  TEXT NOT NULL,
  wrapped_dek               JSONB NOT NULL,
  envelope_version          INTEGER NOT NULL DEFAULT 1,
  version                   INTEGER NOT NULL DEFAULT 1,   -- append-only; higher = newer
  superseded               BOOLEAN NOT NULL DEFAULT false,
  source                    TEXT NOT NULL DEFAULT 'IDV_PROVIDER_EXTRACTION', -- or applicant confirmation/correction
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_idv_vault_attr_ref ON idv_vault_attributes (secure_identity_reference, attribute_concept);

-- Append-only audit of every authorized read/reveal of Vault attributes.
CREATE TABLE IF NOT EXISTS idv_vault_access_audit (
  id                        BIGSERIAL PRIMARY KEY,
  secure_identity_reference TEXT NOT NULL,
  actor_id                  TEXT,
  purpose                   TEXT,
  fields                    JSONB,
  outcome                   TEXT NOT NULL,   -- released | denied | not_found
  at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_idv_vault_audit_ref ON idv_vault_access_audit (secure_identity_reference, at);
