-- 017_idv_evidence_refactor.sql
-- Phase 2.5 sub-step 3: move extracted identity PII out of ordinary tables.
--
-- idv_verification_attempts.verification_result now holds ONLY the non-PII
-- canonical bundle (observations, provider decision, external-evidence refs,
-- timestamps). The extracted identity PII lives in the Vault; this column
-- stores the opaque reference to it, never plaintext.
ALTER TABLE idv_verification_attempts
  ADD COLUMN IF NOT EXISTS secure_identity_reference TEXT;

-- Data minimization: the full ComplyCube screening payload carried match PII
-- and scores. We keep only outcome + categories (non-PII). Drop the raw result.
ALTER TABLE idv_screening_checks
  DROP COLUMN IF EXISTS result;
