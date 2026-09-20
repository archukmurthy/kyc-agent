-- Evidence Consumer Readiness R2: durable targeted-interpretation operations.
-- Forward-only and additive. Migrations 010-014 remain unchanged.

CREATE TABLE IF NOT EXISTS evidence_interpretation_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  context_id UUID NOT NULL REFERENCES evidence_contexts(id),
  caller_scope TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  request_manifest JSONB NOT NULL,
  correlation JSONB NOT NULL DEFAULT '{}'::JSONB,
  trusted_caller_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL,
  extraction_run_id UUID REFERENCES evidence_extraction_runs(id),
  result_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  failure_code TEXT,
  failure_message TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, context_id, caller_scope, operation_key),
  CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CHECK (status IN ('in_progress', 'completed', 'failed')),
  CHECK ((status = 'in_progress' AND completed_at IS NULL)
      OR (status = 'completed' AND completed_at IS NOT NULL AND extraction_run_id IS NOT NULL)
      OR (status = 'failed' AND completed_at IS NOT NULL AND failure_code IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_evidence_interpretation_operations_context
  ON evidence_interpretation_operations (tenant_id, context_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_interpretation_operations_run
  ON evidence_interpretation_operations (extraction_run_id)
  WHERE extraction_run_id IS NOT NULL;
