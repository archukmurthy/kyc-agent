-- Module-local IDV schema. This is intentionally not a repository-global
-- db/migrations sequence number: Evidence owns the parallel global numbers.
-- At integration time, either run this idempotent module migration separately
-- or assign the then-current global migration number without changing its SQL.

CREATE TABLE IF NOT EXISTS idv_sessions (
  internal_idv_session_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  customer_context_id text NOT NULL,
  subject_person_id text,
  provider text NOT NULL,
  provider_session_id text NOT NULL,
  provider_report_id text,
  canonical_status text NOT NULL,
  original_provider_status text,
  secure_identity_reference uuid,
  session_data jsonb NOT NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, internal_idv_session_id),
  UNIQUE (provider, provider_session_id)
);

CREATE INDEX IF NOT EXISTS idv_sessions_tenant_subject_idx ON idv_sessions (tenant_id, subject_person_id);
CREATE INDEX IF NOT EXISTS idv_sessions_tenant_status_idx ON idv_sessions (tenant_id, canonical_status, created_at);

CREATE TABLE IF NOT EXISTS idv_results (
  internal_idv_session_id uuid PRIMARY KEY REFERENCES idv_sessions(internal_idv_session_id),
  tenant_id text NOT NULL,
  result_data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idv_webhook_receipts (
  provider text NOT NULL,
  event_id text NOT NULL,
  state text NOT NULL,
  tenant_id text,
  internal_idv_session_id uuid,
  received_at timestamptz NOT NULL,
  completed_at timestamptz,
  attempts integer NOT NULL DEFAULT 1,
  error_code text,
  reconciliation text,
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE IF NOT EXISTS idv_lifecycle_events (
  event_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  internal_idv_session_id uuid NOT NULL REFERENCES idv_sessions(internal_idv_session_id),
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idv_events_session_time_idx ON idv_lifecycle_events (tenant_id, internal_idv_session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idv_events_type_time_idx ON idv_lifecycle_events (event_type, occurred_at);

CREATE TABLE IF NOT EXISTS idv_cost_ledger (
  cost_entry_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  internal_idv_session_id uuid NOT NULL REFERENCES idv_sessions(internal_idv_session_id),
  provider text NOT NULL,
  workflow text,
  module text,
  billing_trigger text,
  amount numeric(18,6),
  currency text NOT NULL,
  cost_basis text NOT NULL CHECK (cost_basis IN ('ESTIMATED','ACTUAL_CONFIRMED')),
  pricing_source text,
  pricing_version text,
  incurred_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idv_cost_ledger_session_idx ON idv_cost_ledger (tenant_id, internal_idv_session_id);

CREATE TABLE IF NOT EXISTS idv_poc_ground_truth (
  ground_truth_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  internal_idv_session_id uuid NOT NULL REFERENCES idv_sessions(internal_idv_session_id),
  test_case_id text NOT NULL,
  genuine_user_label boolean,
  label_source text,
  valid_technical_opportunity boolean,
  comparison_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_by_actor_id text NOT NULL,
  recorded_at timestamptz NOT NULL,
  UNIQUE (tenant_id, internal_idv_session_id)
);

CREATE TABLE IF NOT EXISTS idv_secure_identity_records (
  identity_reference uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  internal_idv_session_id uuid NOT NULL,
  classification text NOT NULL,
  retention_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  deletion_status text NOT NULL CHECK (deletion_status IN ('ACTIVE','SCHEDULED','DELETED')),
  deletion_scheduled_at timestamptz,
  deleted_at timestamptz,
  deletion_reason_code text,
  legal_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, internal_idv_session_id),
  UNIQUE (tenant_id, identity_reference),
  FOREIGN KEY (tenant_id, internal_idv_session_id)
    REFERENCES idv_sessions(tenant_id, internal_idv_session_id)
);

CREATE TABLE IF NOT EXISTS idv_encrypted_identity_attributes (
  identity_reference uuid NOT NULL,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  attribute_id uuid NOT NULL,
  attribute_concept text NOT NULL,
  classification text NOT NULL,
  envelope_version integer NOT NULL,
  encryption_algorithm text NOT NULL,
  ciphertext text NOT NULL,
  nonce text NOT NULL,
  authentication_tag text NOT NULL,
  wrapped_dek jsonb NOT NULL,
  kms_provider text NOT NULL,
  kms_key_id text NOT NULL,
  kms_key_version text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, identity_reference, attribute_id),
  FOREIGN KEY (tenant_id, identity_reference)
    REFERENCES idv_secure_identity_records(tenant_id, identity_reference)
);

CREATE INDEX IF NOT EXISTS idv_identity_attributes_concept_idx
  ON idv_encrypted_identity_attributes (tenant_id, identity_reference, attribute_concept);

CREATE TABLE IF NOT EXISTS idv_encrypted_customer_responses (
  identity_reference uuid NOT NULL,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  response_id uuid NOT NULL,
  attribute_id uuid NOT NULL,
  attribute_concept text NOT NULL,
  action text NOT NULL CHECK (action IN ('CONFIRMED','CORRECTED','REJECTED')),
  classification text NOT NULL,
  envelope_version integer NOT NULL,
  encryption_algorithm text NOT NULL,
  ciphertext text NOT NULL,
  nonce text NOT NULL,
  authentication_tag text NOT NULL,
  wrapped_dek jsonb NOT NULL,
  kms_provider text NOT NULL,
  kms_key_id text NOT NULL,
  kms_key_version text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, identity_reference, response_id),
  FOREIGN KEY (tenant_id, identity_reference)
    REFERENCES idv_secure_identity_records(tenant_id, identity_reference)
);

CREATE TABLE IF NOT EXISTS idv_identity_access_audit (
  audit_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  actor_id text NOT NULL,
  purpose text NOT NULL,
  action text NOT NULL,
  field_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome text NOT NULL CHECK (outcome IN ('ALLOWED','DENIED','FAILED')),
  outcome_detail text,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idv_identity_audit_tenant_subject_idx
  ON idv_identity_access_audit (tenant_id, subject_id, occurred_at);

-- Protected rows are tenant-isolated even when an application query omits a
-- tenant predicate. current_setting(..., true) returns NULL when context is
-- missing, making each policy default-deny.
ALTER TABLE idv_secure_identity_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE idv_secure_identity_records FORCE ROW LEVEL SECURITY;
ALTER TABLE idv_encrypted_identity_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE idv_encrypted_identity_attributes FORCE ROW LEVEL SECURITY;
ALTER TABLE idv_encrypted_customer_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE idv_encrypted_customer_responses FORCE ROW LEVEL SECURITY;
ALTER TABLE idv_identity_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE idv_identity_access_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS idv_secure_identity_tenant_policy ON idv_secure_identity_records;
CREATE POLICY idv_secure_identity_tenant_policy ON idv_secure_identity_records
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''));

DROP POLICY IF EXISTS idv_identity_attributes_tenant_policy ON idv_encrypted_identity_attributes;
CREATE POLICY idv_identity_attributes_tenant_policy ON idv_encrypted_identity_attributes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''));

DROP POLICY IF EXISTS idv_customer_responses_tenant_policy ON idv_encrypted_customer_responses;
CREATE POLICY idv_customer_responses_tenant_policy ON idv_encrypted_customer_responses
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''));

DROP POLICY IF EXISTS idv_identity_audit_tenant_policy ON idv_identity_access_audit;
CREATE POLICY idv_identity_audit_tenant_policy ON idv_identity_access_audit
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''));

-- Deployment requirement: the production application role must not own these
-- tables, be a superuser, or have BYPASSRLS. Grants are environment-specific.
