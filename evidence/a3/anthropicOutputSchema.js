"use strict";

const ANTHROPIC_R4_INSTRUCTION_REFERENCE = "evidence-r4-live-v4-typed-relations-shallow";

function strictObject(properties, required = Object.keys(properties), description) {
  return { type: "object", ...(description ? { description } : {}), properties, required, additionalProperties: false };
}

const typedRelationship = strictObject({
  fact_index: { type: "integer", description: "Zero-based index of the related item in facts." },
  direction_established: { type: "boolean" },
  relationship_type: { type: "string", enum: [
    "ECONOMIC_OWNERSHIP", "VOTING_RIGHTS", "APPOINTMENT_RIGHTS", "REMOVAL_RIGHTS",
    "FORMAL_DECISION_RIGHTS", "SIGNIFICANT_INFLUENCE_OR_CONTROL", "DIRECTOR_OF", "OFFICER_OF",
    "AUTHORIZED_SIGNATORY_FOR", "CONTROL_OVER", "SETTLOR_OF", "TRUSTEE_OF", "PROTECTOR_OF",
    "BENEFICIARY_OF", "NOMINEE_FOR", "ACTS_ON_BEHALF_OF", "OTHER",
  ] },
  subject_party_type: { type: "string", enum: ["natural_person", "legal_entity", "trust_or_legal_arrangement", "unknown_or_other"] },
  subject_json: { type: "string", description: "JSON object containing source name or description plus optional jurisdiction, identifiers and qualifiers." },
  object_party_type: { type: "string", enum: ["natural_person", "legal_entity", "trust_or_legal_arrangement", "unknown_or_other"] },
  object_json: { type: "string", description: "JSON object containing source name or description plus optional jurisdiction, identifiers and qualifiers." },
  value_kind: { type: "string", enum: ["EXACT", "RANGE", "QUALITATIVE", "UNKNOWN"] },
  measurement_type: { type: "string", enum: ["percentage", "count_of_total", "absolute_quantity", "qualitative", "none"] },
  exact_value: { type: "number", description: "For EXACT percentage values use percentage points: 75% is 75, never 0.75, 7500, basis points, or text. Use 0 when irrelevant." },
  range_lower: { type: "number" }, range_upper: { type: "number" },
  lower_inclusive: { type: "boolean" }, upper_inclusive: { type: "boolean" },
  numerator: { type: "number" }, denominator: { type: "number" },
  qualitative_value: { type: "string", description: "Required source-supported wording for QUALITATIVE relationships; otherwise empty." },
  unit: { type: "string" },
  temporal_state: { type: "string", enum: ["current", "ceased", "historical", "unknown"] },
  temporal_json: { type: "string", description: "JSON object with optional effective_from, effective_to, source_effective_date and precision." },
  source_specific_metadata_json: { type: "string", description: "A JSON object encoded as text; use {} when no source-specific metadata applies." },
  qualifications_json: { type: "string", description: "A JSON array of qualification strings; use [] when absent." },
}, undefined, "Shallow Anthropic transport row. The adapter reconstructs the provider-neutral R4 candidate before deterministic Evidence validation.");

const supportLocator = strictObject({
  fact_index: { type: "integer", description: "Zero-based index of the supported item in facts." },
  artifact_id: { type: "string" },
  locator_type: { type: "string", enum: ["json", "html", "pdf", "image"] },
  locator_json: { type: "string", description: "JSON object containing the media-specific path/page/region, excerpt or description, locator method and qualification. Never fabricate image coordinates." },
});

const fact = strictObject({
  concept: { type: "string" },
  value_json: { type: "string", description: "The complete Fact value encoded as one valid JSON value, preserving strings, numbers, booleans, arrays and objects." },
  raw: { type: "string", description: "Source wording, or an empty string only when no truthful textual rendering exists." },
  requested: { type: "boolean" },
  value_found: { type: "boolean" },
  semantic_role: { type: "string", enum: ["business_fact", "provenance_metadata"] },
  sampled: { type: "boolean" },
  supporting_artifact_ids_json: { type: "string", description: "JSON array of supporting preserved Artifact IDs." },
  semanticAmbiguity: { type: "boolean" },
  ambiguous: { type: "boolean" },
});

const ANTHROPIC_EVIDENCE_OUTPUT_SCHEMA = strictObject({
  facts: { type: "array", items: fact },
  support_locators: { type: "array", items: supportLocator },
  typed_relationships: { type: "array", items: typedRelationship },
  requested_concept_outcomes: { type: "array", items: strictObject({ concept: { type: "string" }, status: { type: "string", enum: ["found", "not_found", "not_evaluated"] } }) },
  completeness: strictObject({
    state: { type: "string", enum: ["complete", "incomplete"] },
    limitations: { type: "array", items: { type: "string" } },
    source_record_count: { type: "integer", description: "Use -1 when the source total is not known." },
    represented_record_count: { type: "integer", description: "Use -1 when the represented total is not known." },
  }),
  support: strictObject({
    state: { type: "string", enum: ["supported", "supported_with_qualification", "needs_verification", "not_supported"] },
    limitations: { type: "array", items: { type: "string" } },
  }),
});

module.exports = { ANTHROPIC_EVIDENCE_OUTPUT_SCHEMA, ANTHROPIC_R4_INSTRUCTION_REFERENCE };
