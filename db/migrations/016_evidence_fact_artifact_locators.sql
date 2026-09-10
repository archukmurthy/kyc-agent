-- Evidence Consumer Readiness R3: immutable locations beneath Fact-to-Artifact support.
-- Forward-only and additive. Migrations 010-015 remain unchanged.

CREATE TABLE IF NOT EXISTS evidence_fact_artifact_locators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id UUID NOT NULL,
  artifact_id UUID NOT NULL,
  locator_ordinal INTEGER NOT NULL CHECK (locator_ordinal >= 1),
  locator_kind TEXT NOT NULL CHECK (locator_kind IN ('json', 'html', 'pdf', 'image')),
  json_path TEXT,
  dom_reference TEXT,
  page_start INTEGER CHECK (page_start IS NULL OR page_start >= 1),
  page_end INTEGER CHECK (page_end IS NULL OR page_end >= page_start),
  support_excerpt TEXT,
  support_description TEXT,
  region JSONB,
  locator_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (fact_id, artifact_id)
    REFERENCES evidence_fact_artifact_support(fact_id, artifact_id),
  UNIQUE (fact_id, artifact_id, locator_ordinal),
  CHECK (support_excerpt IS NOT NULL OR support_description IS NOT NULL),
  CHECK (
    (locator_kind = 'pdf' AND page_start IS NOT NULL AND page_end IS NOT NULL)
    OR (locator_kind <> 'pdf' AND page_start IS NULL AND page_end IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_evidence_fact_artifact_locators_artifact
  ON evidence_fact_artifact_locators (artifact_id, fact_id);
