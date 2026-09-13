-- 024_submission_inbox.sql
-- Durable capture-and-queue for customer submissions. The bundle lands here
-- FIRST (idempotent on submissionId) before any structured write, so a submission
-- is never lost; a worker finalizes pending rows into the 11 domain tables via one
-- all-or-nothing transaction. status: pending -> processing -> done | failed.
CREATE TABLE IF NOT EXISTS submission_inbox (
  id            TEXT PRIMARY KEY,               -- = submissionId (client-minted UUID)
  tenant_id     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  payload       JSONB NOT NULL,                 -- the exact /api/submit body
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  session_id    TEXT,                           -- set when finalize succeeds (audit link)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ
);

-- Worker claim scan: pending/failed rows under the retry ceiling, oldest first.
CREATE INDEX IF NOT EXISTS idx_submission_inbox_status
  ON submission_inbox (status, created_at);

-- Idempotency anchor for the finalize transaction: one session per submission.
ALTER TABLE onboarding_sessions
  ADD COLUMN IF NOT EXISTS submission_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_sessions_submission_id
  ON onboarding_sessions (submission_id)
  WHERE submission_id IS NOT NULL;
