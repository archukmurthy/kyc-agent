-- Migration 005: entity dossiers for the pre-boarding agent
-- Created: 2026-06-10
--
-- Multi-statement (CREATE TABLE + 2 indexes). The shared db/migrate.js runs one
-- statement per file (Neon HTTP driver limit), so apply with db/apply.js:
--   node db/apply.js db/migrations/005_entity_dossiers.sql
-- Idempotent (IF NOT EXISTS) — safe to re-run.

CREATE TABLE IF NOT EXISTS entity_dossiers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Entity identity
  tenant_id          VARCHAR(64) NOT NULL REFERENCES tenants(id),
  company_name       TEXT NOT NULL,
  country_code       VARCHAR(10),
  country_name       TEXT,
  entity_type        VARCHAR(64),
  ownership_type     VARCHAR(64),

  -- Coverage metrics
  total_fields       INTEGER,
  verified_fields    INTEGER,
  probable_fields    INTEGER,
  indicative_fields  INTEGER,
  missing_fields     INTEGER,
  fill_rate          NUMERIC(5,2),
  verified_fill_rate NUMERIC(5,2),

  -- What the analyst decided to request
  included_fields    JSONB,
  excluded_fields    JSONB,
  custom_questions   JSONB,

  -- Full intelligence data
  verified_data      JSONB,
  probable_data      JSONB,
  indicative_data    JSONB,
  stakeholders       JSONB,
  required_documents JSONB,

  -- Research metadata
  research_cost_usd  NUMERIC(10,6),
  research_tokens    INTEGER,
  research_model     VARCHAR(64),
  raw_research       JSONB,

  -- Status: draft | ready | onboarding_started
  status             VARCHAR(32) NOT NULL DEFAULT 'draft',

  -- Link to onboarding journey if "Prepare Onboarding" was clicked
  linked_journey_id  UUID,

  -- Timestamps
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  saved_at              TIMESTAMPTZ,
  onboarding_started_at TIMESTAMPTZ,

  -- Who generated it
  generated_by       VARCHAR(64) DEFAULT 'preboarding_agent'
);

CREATE INDEX IF NOT EXISTS idx_entity_dossiers_tenant_company
  ON entity_dossiers(tenant_id, company_name);

CREATE INDEX IF NOT EXISTS idx_entity_dossiers_generated_at
  ON entity_dossiers(generated_at DESC);
