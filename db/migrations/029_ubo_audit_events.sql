-- UBO-33: the case's append-only audit ledger (docs/ubo/AUDIT-LEDGER-PLAN.md).
-- Event time, receipt time and recording time are kept apart; one correlation
-- id travels with the request.

CREATE TABLE IF NOT EXISTS ubo_audit_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('CUSTOMER', 'ANALYST', 'SYSTEM')),
  actor_id TEXT,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_at TIMESTAMPTZ,
  correlation_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  related_assertion_id TEXT,
  related_artifact_id TEXT,
  related_assessment_id TEXT,
  related_question_id TEXT,
  reason_code TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  retain_until TIMESTAMPTZ NOT NULL,
  dedupe_key TEXT NOT NULL,
  UNIQUE (tenant_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS ubo_audit_events_case_idx ON ubo_audit_events (tenant_id, case_id, recorded_at);

-- Append-only in the database: an UPDATE, DELETE or TRUNCATE is refused with an
-- error, except a DELETE in a transaction that has set ubo.audit_purge = 'on',
-- which only the trial purge does (db/tenantPurge.js). A trigger rather than
-- rules: INSERT ... ON CONFLICT cannot be used on a table with rules.
CREATE OR REPLACE FUNCTION ubo_audit_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('ubo.audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ubo_audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ubo_audit_events_append_only ON ubo_audit_events;

CREATE TRIGGER ubo_audit_events_append_only BEFORE UPDATE OR DELETE ON ubo_audit_events
  FOR EACH ROW EXECUTE FUNCTION ubo_audit_events_append_only();

DROP TRIGGER IF EXISTS ubo_audit_events_no_truncate ON ubo_audit_events;

CREATE TRIGGER ubo_audit_events_no_truncate BEFORE TRUNCATE ON ubo_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION ubo_audit_events_append_only();
