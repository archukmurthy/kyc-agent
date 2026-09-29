-- 021_idv_review_tasks.sql
-- Phase 8: record-only review / escalation / reportability tasks.
--
-- There is no human review queue yet (that UI is a later phase). Band outcomes
-- that need a human — unresolved_to_review, registry_error_asserted (light-touch),
-- and Band C escalations — are recorded here as open tasks. Nothing is
-- auto-actioned or auto-reported; a human picks these up later.
CREATE TABLE IF NOT EXISTS idv_review_tasks (
  id             TEXT PRIMARY KEY,
  attempt_id     TEXT NOT NULL,
  application_id TEXT,
  task_type      TEXT NOT NULL CHECK (task_type IN ('review', 'escalation', 'reportability_assessment')),
  outcome_type   TEXT,
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'open',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idv_review_tasks_attempt ON idv_review_tasks (attempt_id);
CREATE INDEX IF NOT EXISTS idx_idv_review_tasks_application ON idv_review_tasks (application_id);
