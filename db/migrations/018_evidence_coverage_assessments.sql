-- Evidence Platform Stage A4b: immutable coverage, completeness and conflict assessment.
-- Forward-only and additive. Migrations 010-017 remain unchanged.

CREATE TABLE IF NOT EXISTS evidence_fact_typed_set_assertions (
  fact_id UUID PRIMARY KEY REFERENCES evidence_facts(id),
  assertion_schema_version TEXT NOT NULL,
  set_concept TEXT NOT NULL,
  empty_state TEXT NOT NULL CHECK (empty_state IN ('established_empty', 'non_empty', 'unknown')),
  completeness_state TEXT NOT NULL CHECK (completeness_state IN ('complete', 'incomplete', 'unknown')),
  explicit_member_count INTEGER CHECK (explicit_member_count IS NULL OR explicit_member_count >= 0),
  temporal_state TEXT NOT NULL CHECK (temporal_state IN ('current', 'ceased', 'historical', 'unknown')),
  effective_from DATE,
  effective_to DATE,
  source_effective_date DATE,
  source_specific_metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(source_specific_metadata) = 'object'),
  mapping_method TEXT NOT NULL CHECK (mapping_method IN ('direct_source', 'deterministic_source_mapping', 'provider_structured')),
  mapper_id TEXT NOT NULL,
  mapper_version TEXT NOT NULL,
  mapper_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  CHECK (empty_state <> 'established_empty' OR explicit_member_count IS NULL OR explicit_member_count = 0),
  CHECK (empty_state <> 'non_empty' OR explicit_member_count IS NULL OR explicit_member_count > 0)
);

CREATE INDEX IF NOT EXISTS idx_evidence_typed_set_concept
  ON evidence_fact_typed_set_assertions (set_concept, completeness_state, temporal_state, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_a4a_evaluation_fact_identity
  ON evidence_fact_need_evaluations (id, fact_id);

CREATE TABLE IF NOT EXISTS evidence_coverage_assessment_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  information_need_id UUID NOT NULL REFERENCES evidence_requirement_information_needs(id),
  specification_version TEXT NOT NULL,
  specification_snapshot JSONB NOT NULL CHECK (jsonb_typeof(specification_snapshot) = 'object'),
  comparator_profile TEXT NOT NULL,
  comparator_version TEXT NOT NULL,
  assessed_at TIMESTAMPTZ NOT NULL,
  coverage_state TEXT NOT NULL CHECK (coverage_state IN ('covered', 'partially_covered', 'uncovered', 'indeterminate')),
  completeness_state TEXT NOT NULL CHECK (completeness_state IN ('complete', 'incomplete', 'indeterminate', 'not_applicable')),
  disagreement_state TEXT NOT NULL CHECK (disagreement_state IN ('none', 'present', 'indeterminate', 'not_applicable')),
  temporal_state TEXT NOT NULL CHECK (temporal_state IN ('applicable', 'partially_applicable', 'not_applicable', 'indeterminate')),
  empty_set_state TEXT NOT NULL CHECK (empty_set_state IN ('established_empty', 'not_established', 'indeterminate', 'not_applicable')),
  input_sufficiency TEXT NOT NULL CHECK (input_sufficiency IN ('sufficient', 'insufficient')),
  reason_codes JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(reason_codes) = 'array'),
  limitations JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(limitations) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_coverage_assessment_need
  ON evidence_coverage_assessment_runs (information_need_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_coverage_assessment_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_run_id UUID NOT NULL REFERENCES evidence_coverage_assessment_runs(id),
  a4a_evaluation_id UUID NOT NULL REFERENCES evidence_fact_need_evaluations(id),
  fact_id UUID NOT NULL REFERENCES evidence_facts(id),
  contribution_role TEXT NOT NULL CHECK (contribution_role IN ('covering', 'partial', 'non_covering', 'indeterminate', 'set_assertion')),
  evaluation_result TEXT NOT NULL CHECK (evaluation_result IN ('addresses', 'partially_addresses', 'ambiguous', 'insufficient', 'does_not_address')),
  reason_codes JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(reason_codes) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (a4a_evaluation_id, fact_id) REFERENCES evidence_fact_need_evaluations(id, fact_id),
  UNIQUE (assessment_run_id, a4a_evaluation_id, fact_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_coverage_candidate_fact
  ON evidence_coverage_assessment_candidates (fact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_coverage_comparison_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_run_id UUID NOT NULL REFERENCES evidence_coverage_assessment_runs(id),
  evaluation_a_id UUID NOT NULL REFERENCES evidence_fact_need_evaluations(id),
  fact_a_id UUID NOT NULL REFERENCES evidence_facts(id),
  evaluation_b_id UUID NOT NULL REFERENCES evidence_fact_need_evaluations(id),
  fact_b_id UUID NOT NULL REFERENCES evidence_facts(id),
  comparator_id TEXT NOT NULL,
  comparator_version TEXT NOT NULL,
  comparable BOOLEAN NOT NULL,
  relationship TEXT NOT NULL CHECK (relationship IN ('agrees', 'compatible_overlap', 'disagrees', 'indeterminate')),
  reason_code TEXT NOT NULL,
  comparison_basis JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(comparison_basis) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (evaluation_a_id, fact_a_id) REFERENCES evidence_fact_need_evaluations(id, fact_id),
  FOREIGN KEY (evaluation_b_id, fact_b_id) REFERENCES evidence_fact_need_evaluations(id, fact_id),
  CHECK (fact_a_id <> fact_b_id),
  UNIQUE (assessment_run_id, evaluation_a_id, evaluation_b_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_coverage_findings_run
  ON evidence_coverage_comparison_findings (assessment_run_id, created_at);
