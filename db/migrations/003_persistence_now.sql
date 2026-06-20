-- Migration 003: Persistence & Capture model — NOW tier (+ LATER stubs)
-- Added: 2026-06-09
--
-- Implements the "KYC Agent — Persistence & Capture Spec", NOW items only.
-- LATER tables are created as empty stubs (DDL only, no write paths) so future
-- migrations stay forward-only.
--
-- RECONCILED against the existing 10-table, session-centric schema:
--   * tenant_id is TEXT (the app's tenants are slugs like 'nium'), NOT uuid as
--     the spec literally wrote — uuid would break every insert. FK -> tenants(id).
--   * `documents` ALREADY EXISTS (session-based). Per the spec's explicit
--     "reconcile, don't greenfield" instruction it is ALTERed to add the
--     journey/blob columns rather than recreated. New cols are NULLABLE (the
--     spec's NOT NULL on sha256/blob_key is relaxed so existing rows survive;
--     the new blob write path always populates them).
--   * journeys.session_id (nullable) is an ADDED reconciliation bridge to the
--     legacy onboarding_sessions.id so old and new spines can be joined.
--   * `events` overlaps the legacy `session_timeline`, and `field_provenance`
--     overlaps `evidence_items`+`field_values`. The spec names new tables on
--     purpose (richer shape), so they are created new; legacy tables are left
--     untouched. Future consolidation is a LATER read concern.
--
-- This file is MULTI-statement. The shared db/migrate.js assumes one statement
-- per file (Neon HTTP driver limit), so apply it with db/apply.js which splits
-- on statement boundaries:  node db/apply.js db/migrations/003_persistence_now.sql
-- Every statement is idempotent (IF NOT EXISTS / ON CONFLICT) — safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- NOW: journey spine
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journeys (
  journey_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL REFERENCES tenants(id),
  session_id   uuid,                                   -- reconciliation bridge -> onboarding_sessions.id
  entity_type  text NOT NULL,
  jurisdiction text NOT NULL,
  segment      text,                                   -- FI / public / sole_trader
  current_step text,
  status       text NOT NULL DEFAULT 'in_progress',    -- in_progress | completed | abandoned
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One journey per legacy session: lets api/submit.js upsert a journey keyed to
-- onboarding_sessions.id, so re-persisting the same session doesn't duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_journeys_session_id ON journeys (session_id);

-- NOW: append-only event log (do NOT UPDATE/DELETE). Step progress / funnel /
-- abandonment are derived from step_enter / step_exit events.
CREATE TABLE IF NOT EXISTS events (
  event_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL,
  journey_id uuid NOT NULL REFERENCES journeys(journey_id),
  session_id uuid NOT NULL,
  actor_type text NOT NULL,                            -- customer | analyst | agent | system
  actor_id   text,
  step       text NOT NULL,
  event_type text NOT NULL,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_journey_created ON events (journey_id, created_at);

-- NOW: method choice at Step 2
CREATE TABLE IF NOT EXISTS completion_choice (
  journey_id uuid PRIMARY KEY REFERENCES journeys(journey_id),
  method     text NOT NULL,                            -- documents_plus_ai | pure_ai | self_complete
  agent_mode text,                                     -- demo | real (when documents_plus_ai)
  chosen_at  timestamptz NOT NULL DEFAULT now()
);

-- NOW: raw search substrate (verbatim "view search details" payload)
CREATE TABLE IF NOT EXISTS search_results (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(journey_id),
  raw_result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_results_journey ON search_results (journey_id);

-- NOW: per-data-point provenance (the centerpiece). Do NOT overwrite agent values.
CREATE TABLE IF NOT EXISTS field_provenance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id      uuid NOT NULL REFERENCES journeys(journey_id),
  field_name      text NOT NULL,
  final_value     text,
  layer           text NOT NULL,                       -- L1_deterministic | L2_doc_intel | L3_ai | L4_customer
  source_tier     text,                                -- official | company_owned | third_party
  source_identity text,
  source_url      text,
  source_doc_kind text,                                -- customer_uploaded | self_sourced
  retrieved_at    timestamptz,                         -- point-in-time
  snapshot_hash   text,
  model_version   text,                                -- point-in-time
  prompt_version  text,                                -- point-in-time
  confidence      numeric,                             -- point-in-time
  agent_value     text,                                -- original agent-derived value (never overwritten)
  customer_action text,                                -- kept | unchecked | edited
  customer_value  text,                                -- final after customer touch
  researchable    boolean,                             -- false = research attempted but empty
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_provenance_journey_field ON field_provenance (journey_id, field_name);

-- NOW: reconcile existing `documents` (session-based) -> add journey/blob columns.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS journey_id    uuid REFERENCES journeys(journey_id),
  ADD COLUMN IF NOT EXISTS step          text,          -- method_choice_upload | required_docs
  ADD COLUMN IF NOT EXISTS source        text,          -- customer | self_sourced
  ADD COLUMN IF NOT EXISTS actor_type    text,
  ADD COLUMN IF NOT EXISTS original_name text,
  ADD COLUMN IF NOT EXISTS mime_type     text,
  ADD COLUMN IF NOT EXISTS size_bytes    bigint,
  ADD COLUMN IF NOT EXISTS sha256        text,          -- integrity + dedupe (spec NOT NULL relaxed for legacy rows)
  ADD COLUMN IF NOT EXISTS blob_key      text;          -- Vercel Blob key (revocable handle), NOT the binary

CREATE INDEX IF NOT EXISTS idx_documents_journey ON documents (journey_id);

-- NOW: policy / license-combo decisions (reproducible)
CREATE TABLE IF NOT EXISTS policy_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id      uuid NOT NULL REFERENCES journeys(journey_id),
  ruleset_id      text NOT NULL,
  ruleset_version text NOT NULL,                        -- point-in-time
  inputs          jsonb NOT NULL,
  outputs         jsonb NOT NULL,
  decided_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_decisions_journey ON policy_decisions (journey_id);

-- NOW: declaration (lawful-basis + device context, point-in-time)
CREATE TABLE IF NOT EXISTS declaration (
  journey_id          uuid PRIMARY KEY REFERENCES journeys(journey_id),
  declaration_version text NOT NULL,
  consent_given       boolean NOT NULL,
  consent_at          timestamptz NOT NULL,
  ip_address          inet,
  user_agent          text,
  geolocation         text,
  timezone            text,
  signed_at           timestamptz NOT NULL DEFAULT now()
);

-- NOW: per-action token & cost (grab at API-call time; rollups are views)
CREATE TABLE IF NOT EXISTS api_usage (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id         uuid REFERENCES journeys(journey_id),
  step               text,
  action             text,
  model              text NOT NULL,
  input_tokens       integer,
  output_tokens      integer,
  cache_read_tokens  integer,
  cache_write_tokens integer,
  cost               numeric,
  pricing_version    text,
  latency_ms         integer,
  success            boolean,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_journey ON api_usage (journey_id);

-- NOW: versioned pricing (don't bake prices into code)
CREATE TABLE IF NOT EXISTS pricing (
  pricing_version     text NOT NULL,
  model               text NOT NULL,
  input_per_mtok      numeric,
  output_per_mtok     numeric,
  cache_read_per_mtok numeric,
  cache_write_per_mtok numeric,
  effective_from      timestamptz NOT NULL,
  PRIMARY KEY (pricing_version, model)
);

-- Seed pricing from the rates currently baked into code (src/App.js#API_PRICING
-- and lib/persist.js#estimateCostUsd): $3 / $15 per Mtok for Sonnet 4. Cache
-- rates left NULL (the app does not use prompt caching yet — no guessed values).
INSERT INTO pricing (pricing_version, model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, effective_from)
VALUES
  ('v1-2026-06', 'claude-sonnet-4-5',         3.0, 15.0, NULL, NULL, TIMESTAMPTZ '2026-06-01 00:00:00+00'),
  ('v1-2026-06', 'claude-sonnet-4-20250514',  3.0, 15.0, NULL, NULL, TIMESTAMPTZ '2026-06-01 00:00:00+00')
ON CONFLICT (pricing_version, model) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- LATER: stubs only — no write paths. Recomputable from the NOW substrate.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS screening_results (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id   uuid REFERENCES journeys(journey_id),
  list_name    text,
  list_version text,
  hits         jsonb,
  resolution   text,
  screened_at  timestamptz
);

CREATE TABLE IF NOT EXISTS risk_ratings (
  journey_id    uuid PRIMARY KEY REFERENCES journeys(journey_id),
  score         numeric,
  band          text,
  inputs        jsonb,
  model_version text,
  rated_at      timestamptz
);

CREATE TABLE IF NOT EXISTS retention_actions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id   uuid REFERENCES journeys(journey_id),
  action       text,                                   -- retain | erase | export
  reason       text,
  performed_by text,
  performed_at timestamptz
);
