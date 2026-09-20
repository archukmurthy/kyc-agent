"use strict";

const { randomUUID } = require("node:crypto");
const { validateTypedRelationshipCandidate } = require("./domain");

const PSC_MAPPER_ID = "companies-house-psc-nature-of-control";
const PSC_MAPPER_VERSION = "1";
const NON_RELATIONAL_PSC_STATES = Object.freeze([
  "no-individual-or-entity-with-signficant-control",
  "steps-to-find-psc-not-yet-completed",
  "psc-exists-but-not-identified",
  "psc-details-not-confirmed",
  "restrictions-notice-issued-to-psc",
]);

function band(code) {
  const match = String(code).match(/-(25|50|75)-to-(50|75|100)-percent(?:-|$)/);
  return match ? { kind: "RANGE", measurementType: "percentage", lower: Number(match[1]), lowerInclusive: false, upper: Number(match[2]), upperInclusive: true } : null;
}

function mappingsForCode(code) {
  const normalized = String(code || "").trim().toLowerCase();
  if (!normalized || NON_RELATIONAL_PSC_STATES.some((state) => normalized.includes(state)) || /exempt|unavailable|no-registrable-psc/.test(normalized)) return [];
  const bounded = band(normalized);
  if (/^ownership-of-shares-/.test(normalized) && bounded) return [{ relationshipType: "ECONOMIC_OWNERSHIP", value: bounded }];
  if (/^voting-rights-/.test(normalized) && bounded) return [{ relationshipType: "VOTING_RIGHTS", value: bounded }];
  if (/right-to-appoint-and-remove-directors/.test(normalized)) return [
    { relationshipType: "APPOINTMENT_RIGHTS", value: { kind: "UNKNOWN", measurementType: "none" } },
    { relationshipType: "REMOVAL_RIGHTS", value: { kind: "UNKNOWN", measurementType: "none" } },
  ];
  if (/significant-influence-or-control/.test(normalized)) return [{ relationshipType: "SIGNIFICANT_INFLUENCE_OR_CONTROL", value: { kind: "QUALITATIVE", measurementType: "qualitative", value: "significant influence or control" } }];
  return [];
}

function mapCompaniesHousePscNatureOfControl({ inputFact, natureOfControlCode, subject, object, extractionRunId, temporal = { state: "unknown" }, createdAt = new Date().toISOString(), idFor = () => randomUUID() }) {
  if (!inputFact?.id || !inputFact.artifactId) throw new Error("An immutable input Fact with Artifact lineage is required");
  if (!extractionRunId) throw new Error("A deterministic mapping Extraction Run is required");
  const mappings = mappingsForCode(natureOfControlCode);
  if (!mappings.length) return { facts: [], typedRelationships: [], derivations: [], limitations: [`Companies House PSC code ${String(natureOfControlCode || "(missing)")} was non-relational or not unambiguously mapped`] };
  const facts = [], typedRelationships = [], derivations = [], limitations = [];
  for (const mapping of mappings) {
    const factId = idFor();
    const checked = validateTypedRelationshipCandidate({
      directionEstablished: true, relationshipType: mapping.relationshipType, subject, object, value: mapping.value, temporal,
      sourceSpecificMetadata: { producer: "companies_house", sourceField: "natures_of_control", originalRelationshipLabel: natureOfControlCode },
      qualifications: [],
    }, { factId, mappingMethod: "deterministic_source_mapping", mapperId: PSC_MAPPER_ID, mapperVersion: PSC_MAPPER_VERSION, mapperReference: "Companies House PSC nature-of-control deterministic mapping", createdAt });
    if (!checked.relationship) { limitations.push(...checked.limitations); continue; }
    const supportingArtifactIds = [...new Set(inputFact.supportingArtifactIds || [inputFact.artifactId])];
    facts.push({
      id: factId, extractionRunId, artifactId: supportingArtifactIds[0], supportingArtifactIds,
      informationNeedId: null, schemaFieldId: null,
      semanticConceptId: `${mapping.relationshipType.toLowerCase()}_relationship`, requestStatus: "discovered", groundingType: "derived",
      factValue: { relationshipType: mapping.relationshipType, subject: checked.relationship.subjectSnapshot, object: checked.relationship.objectSnapshot, valueKind: checked.relationship.valueKind, measurementType: checked.relationship.measurementType },
      rawRepresentation: inputFact.rawRepresentation || String(natureOfControlCode), supportState: inputFact.supportState,
      supportSignals: { ...(inputFact.supportSignals || {}), transformationId: PSC_MAPPER_ID, transformationVersion: PSC_MAPPER_VERSION, sourceCodePreserved: true },
      supportLocators: structuredClone(inputFact.supportLocators || []), sourcePolicyContext: structuredClone(inputFact.sourcePolicyContext || {}), createdAt,
    });
    typedRelationships.push(checked.relationship);
    derivations.push({ derivedFactId: factId, inputFactId: inputFact.id, transformationId: PSC_MAPPER_ID, transformationVersion: PSC_MAPPER_VERSION, transformationReference: "Companies House PSC nature-of-control deterministic mapping", derivedAt: createdAt, createdAt });
  }
  return { facts, typedRelationships, derivations, limitations };
}

module.exports = { NON_RELATIONAL_PSC_STATES, PSC_MAPPER_ID, PSC_MAPPER_VERSION, band, mapCompaniesHousePscNatureOfControl, mappingsForCode };
