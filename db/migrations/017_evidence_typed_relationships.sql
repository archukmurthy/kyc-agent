-- Evidence Consumer Readiness R4: typed source-relationship extensions.
-- Forward-only and additive. Migrations 010-016 remain unchanged.

CREATE TABLE IF NOT EXISTS evidence_fact_typed_relationships (
  fact_id UUID PRIMARY KEY REFERENCES evidence_facts(id),
  relationship_schema_version TEXT NOT NULL,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN (
    'ECONOMIC_OWNERSHIP',
    'VOTING_RIGHTS',
    'APPOINTMENT_RIGHTS',
    'REMOVAL_RIGHTS',
    'FORMAL_DECISION_RIGHTS',
    'SIGNIFICANT_INFLUENCE_OR_CONTROL',
    'DIRECTOR_OF',
    'OFFICER_OF',
    'AUTHORIZED_SIGNATORY_FOR',
    'CONTROL_OVER',
    'SETTLOR_OF',
    'TRUSTEE_OF',
    'PROTECTOR_OF',
    'BENEFICIARY_OF',
    'NOMINEE_FOR',
    'ACTS_ON_BEHALF_OF',
    'OTHER'
  )),
  subject_party_type TEXT NOT NULL CHECK (subject_party_type IN (
    'natural_person', 'legal_entity', 'trust_or_legal_arrangement', 'unknown_or_other'
  )),
  subject_snapshot JSONB NOT NULL CHECK (jsonb_typeof(subject_snapshot) = 'object'),
  object_party_type TEXT NOT NULL CHECK (object_party_type IN (
    'natural_person', 'legal_entity', 'trust_or_legal_arrangement', 'unknown_or_other'
  )),
  object_snapshot JSONB NOT NULL CHECK (jsonb_typeof(object_snapshot) = 'object'),
  value_kind TEXT NOT NULL CHECK (value_kind IN ('EXACT', 'RANGE', 'QUALITATIVE', 'UNKNOWN')),
  measurement_type TEXT NOT NULL CHECK (measurement_type IN (
    'percentage', 'count_of_total', 'absolute_quantity', 'qualitative', 'none'
  )),
  exact_value NUMERIC,
  range_lower NUMERIC,
  range_upper NUMERIC,
  lower_inclusive BOOLEAN,
  upper_inclusive BOOLEAN,
  numerator NUMERIC,
  denominator NUMERIC,
  qualitative_value TEXT,
  unit TEXT,
  temporal_state TEXT NOT NULL CHECK (temporal_state IN ('current', 'ceased', 'historical', 'unknown')),
  effective_from DATE,
  effective_to DATE,
  source_effective_date DATE,
  temporal_precision JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(temporal_precision) = 'object'),
  source_specific_metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(source_specific_metadata) = 'object'),
  qualifications JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(qualifications) = 'array'),
  mapping_method TEXT NOT NULL CHECK (mapping_method IN ('provider_structured', 'deterministic_source_mapping', 'direct_source')),
  mapper_id TEXT NOT NULL,
  mapper_version TEXT NOT NULL,
  mapper_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  CHECK (
    (value_kind = 'EXACT' AND measurement_type IN ('percentage', 'count_of_total', 'absolute_quantity'))
    OR (value_kind = 'RANGE' AND measurement_type IN ('percentage', 'absolute_quantity'))
    OR (value_kind = 'QUALITATIVE' AND measurement_type = 'qualitative')
    OR (value_kind = 'UNKNOWN')
  ),
  CHECK (value_kind <> 'EXACT' OR measurement_type <> 'percentage' OR (exact_value IS NOT NULL AND exact_value >= 0 AND exact_value <= 100)),
  CHECK (value_kind <> 'EXACT' OR measurement_type <> 'absolute_quantity' OR exact_value IS NOT NULL),
  CHECK (value_kind <> 'EXACT' OR measurement_type <> 'count_of_total' OR (numerator IS NOT NULL AND denominator IS NOT NULL AND numerator >= 0 AND denominator > 0 AND numerator <= denominator)),
  CHECK (value_kind <> 'RANGE' OR range_lower IS NOT NULL OR range_upper IS NOT NULL),
  CHECK (value_kind <> 'RANGE' OR range_lower IS NULL OR range_upper IS NULL OR range_lower <= range_upper),
  CHECK (value_kind <> 'RANGE' OR measurement_type <> 'percentage' OR ((range_lower IS NULL OR (range_lower >= 0 AND range_lower <= 100)) AND (range_upper IS NULL OR (range_upper >= 0 AND range_upper <= 100)))),
  CHECK (value_kind <> 'QUALITATIVE' OR (qualitative_value IS NOT NULL AND length(btrim(qualitative_value)) > 0)),
  CHECK (value_kind <> 'UNKNOWN' OR (exact_value IS NULL AND range_lower IS NULL AND range_upper IS NULL AND numerator IS NULL AND denominator IS NULL AND qualitative_value IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_evidence_typed_relationship_type
  ON evidence_fact_typed_relationships (relationship_type, temporal_state, created_at);

CREATE INDEX IF NOT EXISTS idx_evidence_typed_relationship_subject
  ON evidence_fact_typed_relationships (subject_party_type, created_at);

CREATE INDEX IF NOT EXISTS idx_evidence_typed_relationship_object
  ON evidence_fact_typed_relationships (object_party_type, created_at);
