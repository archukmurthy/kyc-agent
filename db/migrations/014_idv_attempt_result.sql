-- 014_idv_attempt_result.sql
-- Store the document-extracted verification result (server-side only; never
-- returned wholesale to the browser) and the last provider-event timestamp
-- (for event ordering / stale-event rejection) on an attempt. Additive.

ALTER TABLE idv_verification_attempts ADD COLUMN IF NOT EXISTS verification_result JSONB;
ALTER TABLE idv_verification_attempts ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;
