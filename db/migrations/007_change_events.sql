-- Change Intelligence Layer — append-only event store. Apply with:
--   node db/apply.js db/migrations/007_change_events.sql
--
-- ONE change = ONE immutable row. There is no UPDATE and no DELETE path:
--   * correcting a prior event  = INSERT a new row with `supersedes` -> old id
--   * reverting to the AI value = INSERT a new row (change_type reflects revert)
-- The "current" value of a field is DERIVED at read time (latest row not
-- referenced by any other row's `supersedes`), never a stored mutable column.
--
-- Column names + enum vocab are mirrored in src/changeIntelligence/events/schema.js
-- (single source of truth for the DAL). Keep the two in sync.
CREATE TABLE IF NOT EXISTS change_events (
  id              BIGSERIAL PRIMARY KEY,
  submission_id   TEXT NOT NULL,
  dossier_id      TEXT,                    -- nullable: structural disputes can predate a submission
  field_id        TEXT NOT NULL,
  field_class     TEXT NOT NULL,           -- engine enum: director|ubo|address|factualId|pep|structural|generic

  -- the diff
  change_type     TEXT NOT NULL,           -- add|remove|changed (deriveChangeType output)
  before_value    JSONB,                   -- AI / presented value (null for 'add')
  after_value     JSONB,                   -- final customer value (null for 'remove')

  -- provenance of the original (presented) value
  source_type     TEXT,                    -- registry|website|document|web
  source_provider TEXT,                    -- 'Companies House' | 'ACRA' | 'Nium' | 'Document Extraction' | ...
  source_tier     SMALLINT,                -- 1|2|3
  verifiability   TEXT,                    -- structured_registry|document|unverified (frozen engine enum)

  -- customer's claims (these are CLAIMS, not facts — recorded as given)
  customer_intent          TEXT,           -- ai_correction|genuine_update|different_entity|null
  customer_registry_claim  TEXT,           -- reflected|not_reflected|unknown
  registry_recheck_result  TEXT,           -- reflected|not_reflected|not_checked|unavailable (filled later, nullable now)

  -- engine output (recorded verbatim, this row is the audit of the decision)
  workflow         TEXT NOT NULL,          -- engine WORKFLOW enum incl. 'UNDECIDED'
  doc_type         TEXT,
  edd_flag         BOOLEAN NOT NULL DEFAULT false,
  escalation       BOOLEAN NOT NULL DEFAULT false,
  escalation_reason TEXT,
  decided          BOOLEAN NOT NULL DEFAULT true,   -- false = engine returned UNDECIDED, surfaced not buried
  matched_rule     TEXT,                            -- engine's rule id, for audit

  jurisdiction    TEXT,

  -- append-only lineage
  supersedes      BIGINT REFERENCES change_events(id),  -- this event replaces that one
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_change_events_submission ON change_events(submission_id);
CREATE INDEX IF NOT EXISTS idx_change_events_field      ON change_events(submission_id, field_id);
CREATE INDEX IF NOT EXISTS idx_change_events_undecided  ON change_events(decided) WHERE decided = false;
CREATE INDEX IF NOT EXISTS idx_change_events_escalation ON change_events(escalation) WHERE escalation = true;
