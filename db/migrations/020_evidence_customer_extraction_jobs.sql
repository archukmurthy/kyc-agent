-- Durable customer ownership-chart extraction jobs.
-- Additive Evidence orchestration for the UBO POC; does not replace A1-A3.

CREATE UNIQUE INDEX IF NOT EXISTS uq_evidence_context_external_reference
  ON evidence_contexts (tenant_id, context_type, external_context_reference)
  WHERE external_context_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS evidence_customer_extraction_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  context_id UUID NOT NULL REFERENCES evidence_contexts(id),
  artifact_id UUID NOT NULL REFERENCES evidence_artifacts(id),
  artifact_sha256 VARCHAR(64) NOT NULL,
  cache_key VARCHAR(64) NOT NULL,
  demo_case_id TEXT NOT NULL,
  company JSONB NOT NULL,
  evidence_handoff JSONB,
  profile_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  instruction_version TEXT NOT NULL,
  verification_strategy_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_version TEXT NOT NULL,
  state TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  correlation_id TEXT NOT NULL,
  last_reason_code TEXT,
  last_reason_message TEXT,
  upstream_status INTEGER,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, context_id, cache_key),
  CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (cache_key ~ '^[0-9a-f]{64}$'),
  CHECK (state IN ('QUEUED', 'RUNNING', 'RETRYING', 'COMPLETE', 'PARTIAL', 'FAILED')),
  CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 10),
  CHECK ((state IN ('COMPLETE', 'PARTIAL', 'FAILED') AND completed_at IS NOT NULL)
      OR (state IN ('QUEUED', 'RUNNING', 'RETRYING') AND completed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_evidence_customer_jobs_ready
  ON evidence_customer_extraction_jobs (state, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_evidence_customer_jobs_artifact
  ON evidence_customer_extraction_jobs (artifact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_customer_jobs_correlation
  ON evidence_customer_extraction_jobs (correlation_id);
