-- 020_idv_lifecycle_events.sql
-- Phase 2.5 sub-step 6: append-only IDV operational lifecycle history.
--
-- IDV domain history (session created, hosted flow opened, provider result
-- received, webhook received, retry, abandoned, completed, technical failure) —
-- NOT a competing Evidence system. Timestamps are kept DISTINCT and are never
-- conflated: occurred_at is the provider/event time (may be missing and stays
-- missing), received_at is when WE received it, recorded_at is when we wrote the
-- row. Non-PII only.
CREATE TABLE IF NOT EXISTS idv_lifecycle_events (
  id                 BIGSERIAL PRIMARY KEY,
  attempt_id         TEXT NOT NULL,
  event_type         TEXT NOT NULL,
  occurred_at        TIMESTAMPTZ,                       -- provider/event time (nullable, missing stays missing)
  received_at        TIMESTAMPTZ,                       -- when WE received it
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),-- when we wrote this row
  provider_reference TEXT,
  detail             JSONB
);

CREATE INDEX IF NOT EXISTS idx_idv_lifecycle_attempt ON idv_lifecycle_events (attempt_id);
