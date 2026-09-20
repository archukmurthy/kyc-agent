-- Evidence Platform Stage A2: producer-neutral collection operations.
-- Forward-only and additive; existing A1 acquisitions remain valid.

CREATE TABLE IF NOT EXISTS evidence_collection_operations (
  id UUID PRIMARY KEY,
  producer TEXT NOT NULL,
  producer_request_key TEXT NOT NULL,
  subject_reference_id UUID REFERENCES evidence_subject_references(id),
  collection_coordinates JSONB NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  failure_reason TEXT,
  producer_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (producer, producer_request_key),
  CHECK (mode IN ('live', 'fixture')),
  CHECK (status IN ('pending', 'running', 'successful', 'partial', 'failed', 'inconclusive'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_collection_operations_subject_created
  ON evidence_collection_operations (subject_reference_id, created_at DESC);

ALTER TABLE evidence_acquisitions
  ADD COLUMN IF NOT EXISTS collection_operation_id UUID REFERENCES evidence_collection_operations(id);

CREATE INDEX IF NOT EXISTS idx_evidence_acquisitions_collection
  ON evidence_acquisitions (collection_operation_id, created_at);
