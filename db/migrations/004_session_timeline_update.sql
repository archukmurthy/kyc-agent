-- Migration 004: session_timeline — event-tracking columns
-- Added: 2026-06-10
--
-- Enables api/track-event.js to log agent-selection / journey events.
-- RECONCILED against the live session_timeline (id, session_id NOT NULL + FK,
-- event_type, metadata JSONB, occurred_at):
--   * session_id is dropped from NOT NULL — landing-page events have no session
--     yet (the FK still allows NULL, so no constraint is dropped).
--   * event_data JSONB added (the legacy JSONB col is named `metadata`; the
--     tracking handler/scripts use event_data).
--   * tenant_id added.
--   * occurred_at already exists; ADD ... IF NOT EXISTS is a harmless no-op.
--
-- One ALTER TABLE statement (multiple actions) so it runs under db/migrate.js,
-- which sends one SQL command per file. Idempotent.

ALTER TABLE session_timeline
  ADD COLUMN IF NOT EXISTS tenant_id   VARCHAR(64),
  ADD COLUMN IF NOT EXISTS event_data  JSONB,
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ DEFAULT NOW(),
  ALTER COLUMN session_id DROP NOT NULL;
