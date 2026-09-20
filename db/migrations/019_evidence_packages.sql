-- Evidence Platform Stage A5b: immutable Evidence Packages.
-- Forward-only and additive. Migrations 010-018 remain unchanged.

CREATE TABLE IF NOT EXISTS evidence_packages (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  context_id UUID NOT NULL REFERENCES evidence_contexts(id),
  subject_reference_id UUID NOT NULL REFERENCES evidence_subject_references(id),
  purpose_code TEXT NOT NULL CHECK (purpose_code IN (
    'internal_review',
    'regulatory_reconstruction',
    'investigative_response',
    'case_evidence_snapshot',
    'decision_support_snapshot',
    'other'
  )),
  purpose_label TEXT,
  as_of TIMESTAMPTZ NOT NULL,
  frozen_at TIMESTAMPTZ NOT NULL,
  frozen_by_actor_type TEXT NOT NULL,
  frozen_by_actor_id TEXT,
  caller_scope TEXT NOT NULL,
  freeze_operation_key TEXT NOT NULL,
  request_fingerprint VARCHAR(64) NOT NULL,
  a5a_availability_rules_version TEXT NOT NULL,
  manifest_version TEXT NOT NULL,
  canonicalization_version TEXT NOT NULL,
  canonical_manifest_bytes BYTEA NOT NULL,
  manifest_fingerprint_algorithm TEXT NOT NULL DEFAULT 'sha256',
  manifest_fingerprint_value VARCHAR(64) NOT NULL,
  limitations JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(limitations) = 'array'),
  derived_from_package_id UUID REFERENCES evidence_packages(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, context_id, caller_scope, freeze_operation_key),
  CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CHECK (manifest_fingerprint_algorithm = 'sha256'),
  CHECK (manifest_fingerprint_value ~ '^[0-9a-f]{64}$'),
  CHECK (as_of <= frozen_at),
  CHECK (purpose_code <> 'other' OR (purpose_label IS NOT NULL AND length(btrim(purpose_label)) BETWEEN 1 AND 160)),
  CHECK (purpose_label IS NULL OR length(purpose_label) <= 160),
  CHECK (derived_from_package_id IS NULL OR derived_from_package_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_packages_context_frozen
  ON evidence_packages (tenant_id, context_id, frozen_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_packages_subject_frozen
  ON evidence_packages (subject_reference_id, frozen_at DESC);

CREATE TABLE IF NOT EXISTS evidence_package_members (
  package_id UUID NOT NULL REFERENCES evidence_packages(id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
  member_type TEXT NOT NULL CHECK (member_type IN (
    'evidence_requirement', 'evidence_information_need', 'evidence_collection_operation',
    'evidence_acquisition', 'evidence_asset', 'evidence_artifact', 'evidence_requirement_asset',
    'evidence_extraction_run', 'evidence_extraction_run_artifact', 'evidence_extracted_value',
    'evidence_fact', 'evidence_fact_artifact_support', 'evidence_fact_artifact_locator',
    'evidence_fact_typed_relationship', 'evidence_fact_typed_set_assertion', 'evidence_fact_derivation',
    'evidence_verification_attempt', 'evidence_interpretation_operation', 'evidence_need_evaluation_run',
    'evidence_fact_need_evaluation', 'evidence_coverage_assessment_run',
    'evidence_coverage_assessment_candidate', 'evidence_coverage_comparison_finding'
  )),
  canonical_member_reference TEXT NOT NULL,
  canonical_member_key JSONB NOT NULL CHECK (jsonb_typeof(canonical_member_key) = 'object'),
  member_role TEXT NOT NULL,
  authorization_metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(authorization_metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (package_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_evidence_package_members_reference
  ON evidence_package_members (member_type, canonical_member_reference, package_id);
