-- Evidence Platform Stage A4a: immutable Fact-to-Information-Need evaluation.
-- Forward-only and additive. Migrations 010-013 remain unchanged.

CREATE TABLE IF NOT EXISTS evidence_need_evaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  information_need_id UUID NOT NULL REFERENCES evidence_requirement_information_needs(id),
  evaluation_method TEXT NOT NULL,
  evaluator_name TEXT NOT NULL,
  evaluator_version TEXT,
  provider TEXT,
  model_identifier TEXT,
  instruction_reference TEXT,
  evaluation_context JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  evaluated_at TIMESTAMPTZ,
  limitations JSONB NOT NULL DEFAULT '[]'::JSONB,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (evaluation_method IN ('exact_typed', 'normalized_text', 'semantic')),
  CHECK (status IN ('completed', 'failed')),
  CHECK ((status = 'completed' AND completed_at IS NOT NULL AND evaluated_at IS NOT NULL)
      OR (status = 'failed' AND error_code IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_evidence_need_evaluation_runs_need
  ON evidence_need_evaluation_runs (information_need_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_fact_need_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_run_id UUID NOT NULL REFERENCES evidence_need_evaluation_runs(id),
  fact_id UUID NOT NULL REFERENCES evidence_facts(id),
  result TEXT NOT NULL,
  reason TEXT NOT NULL,
  qualification JSONB NOT NULL DEFAULT '{}'::JSONB,
  comparison_inputs JSONB NOT NULL,
  normalization_id TEXT,
  normalization_version TEXT,
  normalization_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (evaluation_run_id, fact_id),
  CHECK (result IN ('addresses', 'partially_addresses', 'ambiguous', 'insufficient', 'does_not_address'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_fact_need_evaluations_fact
  ON evidence_fact_need_evaluations (fact_id, created_at DESC);
