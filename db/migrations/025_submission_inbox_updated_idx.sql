-- 025_submission_inbox_updated_idx.sql
-- claimPending's stale-processing reclaim branch filters on
-- (status = 'processing' AND updated_at < ...), which idx_submission_inbox_status
-- (status, created_at) does not cover. Add the matching index.
CREATE INDEX IF NOT EXISTS idx_submission_inbox_status_updated
  ON submission_inbox (status, updated_at);
