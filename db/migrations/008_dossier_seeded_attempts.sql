-- Migration 008: self-serve re-research support on entity_dossiers
-- Created: 2026-06-26
--
-- Adds two columns for the front-door "wrong company / wrong type" self-serve
-- re-research slice. Multi-statement; apply with db/apply.js:
--   node db/apply.js db/migrations/008_dossier_seeded_attempts.sql
-- Idempotent (ADD COLUMN IF NOT EXISTS) — safe to re-run.
--
--  * seeded_by      — who triggered the search that produced this dossier:
--                     'analyst' (the pre-boarding flow) or 'customer' (self-serve
--                     re-research). DATA on the record, not a lifecycle state
--                     (see dossierLifecycle/states.js C4). Defaults to 'analyst'
--                     so existing rows read as analyst-seeded.
--  * search_attempts — server-authoritative count of searches run against this
--                     dossier. Drives the two-retry cap so it cannot be trivially
--                     reset client-side. Seeded to 1 on first save (one search has
--                     run by the time a dossier exists); incremented server-side
--                     on each customer re-search (api/search-attempt.js).

ALTER TABLE entity_dossiers
  ADD COLUMN IF NOT EXISTS seeded_by VARCHAR(32) NOT NULL DEFAULT 'analyst';

ALTER TABLE entity_dossiers
  ADD COLUMN IF NOT EXISTS search_attempts INTEGER NOT NULL DEFAULT 0;
