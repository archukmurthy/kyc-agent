-- Evidence Platform Stage A1: core domain + extraction lineage.
-- Forward-only, additive, and independent of legacy KYC evidence tables.
-- Apply with: node db/apply.js db/migrations/010_evidence_platform_a1.sql

CREATE TABLE IF NOT EXISTS evidence_subject_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL,
  identifier_scheme TEXT NOT NULL,
  jurisdiction VARCHAR(10),
  identifier_value TEXT NOT NULL,
  display_name TEXT,
  external_system TEXT,
  external_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subject_type, identifier_scheme, jurisdiction, identifier_value)
);

CREATE TABLE IF NOT EXISTS evidence_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  context_type TEXT NOT NULL,
  external_context_reference TEXT,
  subject_reference_id UUID NOT NULL REFERENCES evidence_subject_references(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_contexts_tenant
  ON evidence_contexts (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context_id UUID NOT NULL REFERENCES evidence_contexts(id),
  subject_reference_id UUID NOT NULL REFERENCES evidence_subject_references(id),
  requirement_key TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('open', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_requirements_context
  ON evidence_requirements (context_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_requirement_information_needs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID NOT NULL REFERENCES evidence_requirements(id),
  schema_reference TEXT NOT NULL,
  schema_version_reference TEXT,
  tenant_config_version INTEGER,
  schema_field_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (requirement_id, schema_reference, schema_field_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_information_needs_requirement
  ON evidence_requirement_information_needs (requirement_id);

CREATE TABLE IF NOT EXISTS evidence_acquisitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context_id UUID NOT NULL REFERENCES evidence_contexts(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  subject_reference_id UUID NOT NULL REFERENCES evidence_subject_references(id),
  source_type TEXT NOT NULL,
  source_provider TEXT,
  acquisition_method TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  outcome TEXT NOT NULL,
  outcome_reason TEXT,
  source_locator TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  producer_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (outcome IN ('successful', 'failed', 'inconclusive')),
  CHECK (outcome = 'successful' OR outcome_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_evidence_acquisitions_context_created
  ON evidence_acquisitions (context_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_acquisitions_subject_created
  ON evidence_acquisitions (subject_reference_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acquisition_id UUID NOT NULL REFERENCES evidence_acquisitions(id),
  subject_reference_id UUID NOT NULL REFERENCES evidence_subject_references(id),
  evidence_type TEXT NOT NULL,
  title TEXT NOT NULL,
  access_class TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (access_class IN ('public', 'context_restricted'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_assets_acquisition
  ON evidence_assets (acquisition_id);

CREATE INDEX IF NOT EXISTS idx_evidence_assets_subject_observed
  ON evidence_assets (subject_reference_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS evidence_asset_access_scopes (
  asset_id UUID NOT NULL REFERENCES evidence_assets(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  context_id UUID REFERENCES evidence_contexts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (asset_id, tenant_id, context_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_asset_scopes_tenant_context
  ON evidence_asset_access_scopes (tenant_id, context_id);

CREATE TABLE IF NOT EXISTS evidence_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES evidence_assets(id),
  representation_type TEXT NOT NULL,
  media_type TEXT,
  original_name TEXT,
  storage_provider TEXT,
  storage_key TEXT,
  storage_reference TEXT,
  fixture_content BYTEA,
  size_bytes BIGINT NOT NULL,
  fingerprint_algorithm TEXT NOT NULL DEFAULT 'sha256',
  fingerprint_value VARCHAR(64) NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  artifact_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, asset_id),
  CHECK (fingerprint_algorithm = 'sha256'),
  CHECK (fingerprint_value ~ '^[0-9a-f]{64}$'),
  CHECK (fixture_content IS NOT NULL OR storage_key IS NOT NULL OR storage_reference IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_evidence_artifacts_asset
  ON evidence_artifacts (asset_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_evidence_artifacts_fingerprint
  ON evidence_artifacts (fingerprint_algorithm, fingerprint_value);

CREATE TABLE IF NOT EXISTS evidence_requirement_assets (
  requirement_id UUID NOT NULL REFERENCES evidence_requirements(id),
  asset_id UUID NOT NULL REFERENCES evidence_assets(id),
  associated_context_id UUID NOT NULL REFERENCES evidence_contexts(id),
  associated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (requirement_id, asset_id, associated_context_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_requirement_assets_asset
  ON evidence_requirement_assets (asset_id);

CREATE TABLE IF NOT EXISTS evidence_extraction_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES evidence_assets(id),
  artifact_id UUID NOT NULL,
  extractor_type TEXT NOT NULL,
  extractor_name TEXT NOT NULL,
  extractor_version TEXT,
  schema_reference TEXT NOT NULL,
  schema_version_reference TEXT,
  tenant_config_version INTEGER,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  run_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (artifact_id, asset_id) REFERENCES evidence_artifacts(id, asset_id),
  CHECK (status IN ('completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_extraction_runs_artifact
  ON evidence_extraction_runs (artifact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_extracted_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_run_id UUID NOT NULL REFERENCES evidence_extraction_runs(id),
  schema_field_id TEXT NOT NULL,
  extracted_value JSONB NOT NULL,
  confidence NUMERIC,
  raw_representation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_extracted_values_run
  ON evidence_extracted_values (extraction_run_id);

CREATE INDEX IF NOT EXISTS idx_evidence_extracted_values_field
  ON evidence_extracted_values (schema_field_id);
