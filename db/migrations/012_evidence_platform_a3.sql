-- Evidence Platform Stage A3: interpretation, discovered facts, derivation, and verification lineage.
-- Forward-only and additive. Extends A1/A2 without changing legacy KYC tables.
-- Apply only to an authorized disposable Evidence database during verification.

ALTER TABLE evidence_extraction_runs
  ADD COLUMN IF NOT EXISTS execution_mode TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS model_identifier TEXT,
  ADD COLUMN IF NOT EXISTS instruction_reference TEXT,
  ADD COLUMN IF NOT EXISTS extraction_context JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS support_assessment JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE evidence_extraction_runs
  DROP CONSTRAINT IF EXISTS evidence_extraction_runs_execution_mode_check;

ALTER TABLE evidence_extraction_runs
  ADD CONSTRAINT evidence_extraction_runs_execution_mode_check
  CHECK (execution_mode IS NULL OR execution_mode IN ('deterministic', 'ai'));

CREATE TABLE IF NOT EXISTS evidence_extraction_run_artifacts (
  extraction_run_id UUID NOT NULL REFERENCES evidence_extraction_runs(id),
  artifact_id UUID NOT NULL REFERENCES evidence_artifacts(id),
  input_role TEXT NOT NULL DEFAULT 'primary',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (extraction_run_id, artifact_id, input_role)
);

CREATE TABLE IF NOT EXISTS evidence_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_run_id UUID NOT NULL REFERENCES evidence_extraction_runs(id),
  artifact_id UUID NOT NULL REFERENCES evidence_artifacts(id),
  information_need_id UUID REFERENCES evidence_requirement_information_needs(id),
  schema_field_id TEXT,
  semantic_concept_id TEXT NOT NULL,
  request_status TEXT NOT NULL,
  grounding_type TEXT NOT NULL,
  fact_value JSONB NOT NULL,
  raw_representation TEXT,
  support_state TEXT NOT NULL,
  support_signals JSONB NOT NULL DEFAULT '{}'::JSONB,
  source_policy_context JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (request_status IN ('requested', 'discovered')),
  CHECK (grounding_type IN ('direct', 'derived')),
  CHECK (support_state IN ('supported', 'supported_with_qualification', 'needs_verification', 'not_supported')),
  CHECK (
    (request_status = 'requested' AND (information_need_id IS NOT NULL OR schema_field_id IS NOT NULL))
    OR
    (request_status = 'discovered' AND information_need_id IS NULL AND schema_field_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_evidence_facts_run
  ON evidence_facts (extraction_run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_evidence_facts_artifact
  ON evidence_facts (artifact_id, created_at);

CREATE INDEX IF NOT EXISTS idx_evidence_facts_concept
  ON evidence_facts (semantic_concept_id, created_at);

CREATE TABLE IF NOT EXISTS evidence_fact_derivations (
  derived_fact_id UUID NOT NULL REFERENCES evidence_facts(id),
  input_fact_id UUID NOT NULL REFERENCES evidence_facts(id),
  transformation_id TEXT NOT NULL,
  transformation_version TEXT,
  transformation_reference TEXT,
  derived_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (derived_fact_id, input_fact_id, transformation_id)
);

CREATE TABLE IF NOT EXISTS evidence_verification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_extraction_run_id UUID NOT NULL REFERENCES evidence_extraction_runs(id),
  target_fact_id UUID REFERENCES evidence_facts(id),
  verification_extraction_run_id UUID NOT NULL REFERENCES evidence_extraction_runs(id),
  outcome TEXT NOT NULL,
  performed_at TIMESTAMPTZ NOT NULL,
  verification_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (target_extraction_run_id <> verification_extraction_run_id),
  CHECK (outcome IN ('agreement', 'disagreement', 'inconclusive'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_verification_target
  ON evidence_verification_attempts (target_extraction_run_id, target_fact_id, performed_at);

CREATE INDEX IF NOT EXISTS idx_evidence_verification_run
  ON evidence_verification_attempts (verification_extraction_run_id);
