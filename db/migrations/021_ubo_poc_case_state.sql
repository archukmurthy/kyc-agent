-- Durable UBO POC case aggregate.
-- The current projection is mutable; all submitted business actions remain in
-- append-only event/version tables. Evidence document bytes remain owned by
-- Evidence and are referenced by Artifact/extraction job identifiers only.

CREATE TABLE IF NOT EXISTS ubo_poc_cases (
  case_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  company JSONB NOT NULL,
  current_stage TEXT NOT NULL DEFAULT 'COMPANY_DETAILS',
  research_release_state TEXT,
  latest_extraction_job_id UUID REFERENCES evidence_customer_extraction_jobs(id),
  latest_artifact_id UUID REFERENCES evidence_artifacts(id),
  current_assessment_id TEXT,
  current_projection JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ubo_poc_case_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id TEXT NOT NULL REFERENCES ubo_poc_cases(case_id),
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, event_type, idempotency_key)
);

CREATE TABLE IF NOT EXISTS ubo_poc_fact_requirements (
  case_id TEXT NOT NULL REFERENCES ubo_poc_cases(case_id),
  requirement_key TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  current_status TEXT NOT NULL,
  first_recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (case_id, requirement_key)
);

CREATE TABLE IF NOT EXISTS ubo_poc_questions (
  case_id TEXT NOT NULL REFERENCES ubo_poc_cases(case_id),
  question_key TEXT NOT NULL,
  fact_requirement_key TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  current_status TEXT NOT NULL,
  first_recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (case_id, question_key),
  FOREIGN KEY (case_id, fact_requirement_key)
    REFERENCES ubo_poc_fact_requirements(case_id, requirement_key)
);

CREATE TABLE IF NOT EXISTS ubo_poc_question_answers (
  answer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id TEXT NOT NULL,
  question_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  answer JSONB NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'CUSTOMER',
  answered_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (case_id, question_key)
    REFERENCES ubo_poc_questions(case_id, question_key),
  UNIQUE (case_id, question_key, idempotency_key)
);

CREATE TABLE IF NOT EXISTS ubo_poc_evidence_requirements (
  case_id TEXT NOT NULL REFERENCES ubo_poc_cases(case_id),
  evidence_requirement_key TEXT NOT NULL,
  fact_requirement_key TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  current_status TEXT NOT NULL,
  artifact_id UUID REFERENCES evidence_artifacts(id),
  first_recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (case_id, evidence_requirement_key),
  FOREIGN KEY (case_id, fact_requirement_key)
    REFERENCES ubo_poc_fact_requirements(case_id, requirement_key)
);

CREATE TABLE IF NOT EXISTS ubo_poc_assessment_versions (
  assessment_id TEXT NOT NULL,
  case_id TEXT NOT NULL REFERENCES ubo_poc_cases(case_id),
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  input_state_version TEXT NOT NULL,
  evidence_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  assessment JSONB NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ,
  PRIMARY KEY (case_id, assessment_id),
  UNIQUE (case_id, input_state_version)
);

CREATE TABLE IF NOT EXISTS ubo_poc_verification_requirements (
  case_id TEXT NOT NULL REFERENCES ubo_poc_cases(case_id),
  assessment_id TEXT NOT NULL,
  person_key TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  current_status TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (case_id, assessment_id, person_key),
  FOREIGN KEY (case_id, assessment_id) REFERENCES ubo_poc_assessment_versions(case_id, assessment_id)
);

CREATE TABLE IF NOT EXISTS ubo_poc_verification_events (
  verification_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id TEXT NOT NULL REFERENCES ubo_poc_cases(case_id),
  assessment_id TEXT NOT NULL,
  person_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  verification_mode TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  UNIQUE (case_id, event_type, idempotency_key),
  FOREIGN KEY (case_id, assessment_id) REFERENCES ubo_poc_assessment_versions(case_id, assessment_id),
  CHECK (verification_mode IN ('DEMO', 'LIVE'))
);

CREATE INDEX IF NOT EXISTS idx_ubo_poc_case_events_case_time
  ON ubo_poc_case_events (case_id, occurred_at, event_id);

CREATE INDEX IF NOT EXISTS idx_ubo_poc_answers_case_time
  ON ubo_poc_question_answers (case_id, answered_at, answer_id);

CREATE INDEX IF NOT EXISTS idx_ubo_poc_assessments_case_time
  ON ubo_poc_assessment_versions (case_id, calculated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ubo_poc_verification_events_case_time
  ON ubo_poc_verification_events (case_id, occurred_at, verification_event_id);
