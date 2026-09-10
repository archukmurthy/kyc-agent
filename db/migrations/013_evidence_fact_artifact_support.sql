-- Evidence Platform Stage A3: immutable Fact-to-Artifact support lineage.
-- Forward-only and additive. Migration 012 remains unchanged.

CREATE TABLE IF NOT EXISTS evidence_fact_artifact_support (
  fact_id UUID NOT NULL REFERENCES evidence_facts(id),
  artifact_id UUID NOT NULL REFERENCES evidence_artifacts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (fact_id, artifact_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_fact_artifact_support_artifact
  ON evidence_fact_artifact_support (artifact_id, fact_id);
