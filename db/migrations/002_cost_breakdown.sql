-- Migration 002: per-phase cost breakdown
-- Added: 2026-06-08
--
-- One statement only. The neon HTTP driver (used by db/migrate.js) runs a
-- single SQL command per request, so every column lives inside this one
-- ALTER TABLE. raw_result is included with IF NOT EXISTS as a safety net —
-- the benchmark write path (lib/persist.js) already writes to it, but a
-- freshly-migrated DB may not have it yet.

ALTER TABLE onboarding_sessions
  ADD COLUMN IF NOT EXISTS doc_search_input_tokens    INTEGER,
  ADD COLUMN IF NOT EXISTS doc_search_output_tokens   INTEGER,
  ADD COLUMN IF NOT EXISTS doc_search_cost_usd        NUMERIC(10,6),

  ADD COLUMN IF NOT EXISTS research_p1_input_tokens   INTEGER,
  ADD COLUMN IF NOT EXISTS research_p1_output_tokens  INTEGER,
  ADD COLUMN IF NOT EXISTS research_p1_cost_usd        NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS research_p1_fields_found   INTEGER,

  ADD COLUMN IF NOT EXISTS research_p2_input_tokens   INTEGER,
  ADD COLUMN IF NOT EXISTS research_p2_output_tokens  INTEGER,
  ADD COLUMN IF NOT EXISTS research_p2_cost_usd        NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS research_p2_fields_found   INTEGER,
  ADD COLUMN IF NOT EXISTS research_p2_ran            BOOLEAN DEFAULT FALSE,

  ADD COLUMN IF NOT EXISTS doc_extract_input_tokens   INTEGER,
  ADD COLUMN IF NOT EXISTS doc_extract_output_tokens  INTEGER,
  ADD COLUMN IF NOT EXISTS doc_extract_cost_usd        NUMERIC(10,6),

  ADD COLUMN IF NOT EXISTS cost_breakdown             JSONB,

  ADD COLUMN IF NOT EXISTS ownership_type             VARCHAR(64),
  ADD COLUMN IF NOT EXISTS journey_type               VARCHAR(32),
  ADD COLUMN IF NOT EXISTS fields_prefilled           INTEGER,
  ADD COLUMN IF NOT EXISTS fields_total               INTEGER,
  ADD COLUMN IF NOT EXISTS fill_rate                  NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS verified_fill_rate         NUMERIC(5,2),

  ADD COLUMN IF NOT EXISTS raw_result                 JSONB;
