-- 015_idv_webhook_events.sql
-- Idempotency ledger for Didit webhook deliveries. A repeated delivery (Didit
-- retries) collides on event_id and is skipped. Append-only.

CREATE TABLE IF NOT EXISTS idv_webhook_events (
  event_id    TEXT PRIMARY KEY,
  attempt_id  TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
