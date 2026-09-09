-- 018_idv_document_media.sql
-- Phase 2.5 sub-step 4: encrypted document-image store for the audit/review queue.
--
-- We store ONLY identity DOCUMENT images (front / back / portrait page) — never
-- selfies, liveness, or biometric media (Evidence doc forbids those; only an
-- external reference records that they existed at the provider). Bytes are
-- envelope-encrypted (AES-256-GCM, per-item DEK wrapped by the managed key
-- provider) BEFORE upload; this table holds ciphertext pointers + crypto
-- material + our own integrity hash, never plaintext bytes. Retrieval is
-- server-side authorized + audited and decrypts on read (not URL-possession).
CREATE TABLE IF NOT EXISTS idv_document_media (
  id                   TEXT PRIMARY KEY,
  attempt_id           TEXT NOT NULL,
  evidence_kind        TEXT NOT NULL,          -- front | back | portrait
  blob_key             TEXT NOT NULL,          -- opaque, unguessable object key
  content_type         TEXT,
  byte_size            INTEGER,                -- plaintext size (metadata only)
  sha256               TEXT NOT NULL,          -- our own hash over the plaintext bytes
  nonce                TEXT NOT NULL,          -- base64 GCM nonce
  auth_tag             TEXT NOT NULL,          -- base64 GCM auth tag
  wrapped_dek          JSONB NOT NULL,         -- KMS-wrapped data-encryption key envelope
  envelope_version     INTEGER NOT NULL DEFAULT 1,
  provider_reference   TEXT,                   -- provider-side media id (external custody)
  provider_captured_at TIMESTAMPTZ,            -- provider time (may be null)
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when WE received the bytes
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idv_media_attempt ON idv_document_media (attempt_id);
