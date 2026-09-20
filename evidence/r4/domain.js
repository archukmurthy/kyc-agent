"use strict";

const RELATIONSHIP_SCHEMA_VERSION = "evidence-relationship-v1";
const RELATIONSHIP_TYPES = Object.freeze([
  "ECONOMIC_OWNERSHIP", "VOTING_RIGHTS", "APPOINTMENT_RIGHTS", "REMOVAL_RIGHTS",
  "FORMAL_DECISION_RIGHTS", "SIGNIFICANT_INFLUENCE_OR_CONTROL", "DIRECTOR_OF",
  "OFFICER_OF", "AUTHORIZED_SIGNATORY_FOR", "CONTROL_OVER", "SETTLOR_OF",
  "TRUSTEE_OF", "PROTECTOR_OF", "BENEFICIARY_OF", "NOMINEE_FOR",
  "ACTS_ON_BEHALF_OF", "OTHER",
]);
const PARTY_TYPES = Object.freeze(["natural_person", "legal_entity", "trust_or_legal_arrangement", "unknown_or_other"]);
const VALUE_KINDS = Object.freeze(["EXACT", "RANGE", "QUALITATIVE", "UNKNOWN"]);
const MEASUREMENT_TYPES = Object.freeze(["percentage", "count_of_total", "absolute_quantity", "qualitative", "none"]);
const TEMPORAL_STATES = Object.freeze(["current", "ceased", "historical", "unknown"]);
const MAPPING_METHODS = Object.freeze(["provider_structured", "deterministic_source_mapping", "direct_source"]);
const MAX_TEXT = 1000;

class RelationshipValidationError extends Error {
  constructor(limitations) {
    super(`Typed relationship validation failed: ${limitations.join("; ")}`);
    this.code = "typed_relationship_invalid";
    this.limitations = limitations;
  }
}

function own(object, key) { return Object.prototype.hasOwnProperty.call(object || {}, key); }
function text(value, label, { required = false, max = MAX_TEXT } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new RelationshipValidationError([`${label} is required`]);
    return null;
  }
  if (typeof value !== "string") throw new RelationshipValidationError([`${label} must be text`]);
  const normalized = value.trim();
  if (!normalized && required) throw new RelationshipValidationError([`${label} is required`]);
  if (normalized.length > max) throw new RelationshipValidationError([`${label} exceeds ${max} characters`]);
  return normalized || null;
}
function finite(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new RelationshipValidationError([`${label} must be a finite number`]);
  return value;
}
function date(value, label) {
  const normalized = text(value, label);
  if (normalized === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) throw new RelationshipValidationError([`${label} must be an ISO calendar date`]);
  return normalized;
}
function boundedObject(value, label) {
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RelationshipValidationError([`${label} must be an object`]);
  if (JSON.stringify(value).length > 12000) throw new RelationshipValidationError([`${label} exceeds the bounded metadata allowance`]);
  return structuredClone(value);
}
function boundedArray(value, label) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new RelationshipValidationError([`${label} must be an array`]);
  if (value.length > 20 || JSON.stringify(value).length > 12000) throw new RelationshipValidationError([`${label} exceeds the bounded metadata allowance`]);
  return structuredClone(value);
}

function validateParty(input, label) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RelationshipValidationError([`${label} must be a party object`]);
  const partyType = text(input.partyType, `${label}.partyType`, { required: true, max: 80 });
  if (!PARTY_TYPES.includes(partyType)) throw new RelationshipValidationError([`${label}.partyType is not supported`]);
  const name = text(input.name, `${label}.name`);
  const description = text(input.description, `${label}.description`);
  if (!name && !description) throw new RelationshipValidationError([`${label} requires a source name or description`]);
  const jurisdiction = text(input.jurisdiction, `${label}.jurisdiction`, { max: 120 });
  const identifiers = boundedArray(input.identifiers, `${label}.identifiers`).map((identifier, index) => {
    if (!identifier || typeof identifier !== "object" || Array.isArray(identifier)) throw new RelationshipValidationError([`${label}.identifiers[${index}] must be an object`]);
    return { scheme: text(identifier.scheme, `${label}.identifiers[${index}].scheme`, { required: true, max: 200 }), value: text(identifier.value, `${label}.identifiers[${index}].value`, { required: true }), jurisdiction: text(identifier.jurisdiction, `${label}.identifiers[${index}].jurisdiction`, { max: 120 }) };
  });
  return { partyType, snapshot: { ...(name ? { name } : {}), ...(description ? { description } : {}), ...(jurisdiction ? { jurisdiction } : {}), ...(identifiers.length ? { identifiers } : {}), qualifiers: boundedObject(input.qualifiers, `${label}.qualifiers`) } };
}

function validateValue(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RelationshipValidationError(["value must be an object"]);
  const valueKind = text(input.kind, "value.kind", { required: true, max: 40 });
  const measurementType = text(input.measurementType, "value.measurementType", { required: true, max: 80 });
  if (!VALUE_KINDS.includes(valueKind)) throw new RelationshipValidationError(["value.kind is not supported"]);
  if (!MEASUREMENT_TYPES.includes(measurementType)) throw new RelationshipValidationError(["value.measurementType is not supported"]);
  const result = { valueKind, measurementType, exactValue: null, rangeLower: null, rangeUpper: null, lowerInclusive: null, upperInclusive: null, numerator: null, denominator: null, qualitativeValue: null, unit: text(input.unit, "value.unit", { max: 120 }) };
  if (valueKind === "EXACT") {
    if (measurementType === "percentage" || measurementType === "absolute_quantity") result.exactValue = finite(input.value, "value.value");
    else if (measurementType === "count_of_total") { result.numerator = finite(input.numerator, "value.numerator"); result.denominator = finite(input.denominator, "value.denominator"); }
    else throw new RelationshipValidationError(["EXACT requires percentage, count_of_total, or absolute_quantity"]);
    if (measurementType === "percentage" && (result.exactValue === null || result.exactValue < 0 || result.exactValue > 100)) throw new RelationshipValidationError(["percentage must be between 0 and 100"]);
    if (measurementType === "absolute_quantity" && result.exactValue === null) throw new RelationshipValidationError(["absolute_quantity requires value"]);
    if (measurementType === "count_of_total" && (result.numerator === null || result.denominator === null || result.numerator < 0 || result.denominator <= 0 || result.numerator > result.denominator)) throw new RelationshipValidationError(["count_of_total requires 0 <= numerator <= denominator and denominator > 0"]);
  } else if (valueKind === "RANGE") {
    if (!["percentage", "absolute_quantity"].includes(measurementType)) throw new RelationshipValidationError(["RANGE requires percentage or absolute_quantity"]);
    result.rangeLower = finite(input.lower, "value.lower"); result.rangeUpper = finite(input.upper, "value.upper");
    result.lowerInclusive = result.rangeLower === null ? null : input.lowerInclusive;
    result.upperInclusive = result.rangeUpper === null ? null : input.upperInclusive;
    if (result.rangeLower === null && result.rangeUpper === null) throw new RelationshipValidationError(["RANGE requires at least one bound"]);
    if (result.rangeLower !== null && typeof result.lowerInclusive !== "boolean") throw new RelationshipValidationError(["lowerInclusive is required when lower is supplied"]);
    if (result.rangeUpper !== null && typeof result.upperInclusive !== "boolean") throw new RelationshipValidationError(["upperInclusive is required when upper is supplied"]);
    if (result.rangeLower !== null && result.rangeUpper !== null && result.rangeLower > result.rangeUpper) throw new RelationshipValidationError(["range lower cannot exceed upper"]);
    if (measurementType === "percentage" && [result.rangeLower, result.rangeUpper].some((bound) => bound !== null && (bound < 0 || bound > 100))) throw new RelationshipValidationError(["percentage bounds must be between 0 and 100"]);
  } else if (valueKind === "QUALITATIVE") {
    if (measurementType !== "qualitative") throw new RelationshipValidationError(["QUALITATIVE requires qualitative measurementType"]);
    result.qualitativeValue = text(input.value, "value.value", { required: true });
  } else if (["value", "lower", "upper", "numerator", "denominator"].some((key) => own(input, key) && input[key] !== null && input[key] !== undefined)) {
    throw new RelationshipValidationError(["UNKNOWN must not contain a numeric or qualitative value"]);
  }
  return result;
}

function validateTemporal(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RelationshipValidationError(["temporal must be an object"]);
  const temporalState = text(input.state || "unknown", "temporal.state", { required: true, max: 40 });
  if (!TEMPORAL_STATES.includes(temporalState)) throw new RelationshipValidationError(["temporal.state is not supported"]);
  const effectiveFrom = date(input.effectiveFrom, "temporal.effectiveFrom"), effectiveTo = date(input.effectiveTo, "temporal.effectiveTo");
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) throw new RelationshipValidationError(["effectiveTo cannot precede effectiveFrom"]);
  return { temporalState, effectiveFrom, effectiveTo, sourceEffectiveDate: date(input.sourceEffectiveDate, "temporal.sourceEffectiveDate"), temporalPrecision: boundedObject(input.precision, "temporal.precision") };
}

function validateTypedRelationshipCandidate(candidate, context = {}) {
  try {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new RelationshipValidationError(["typed relationship candidate must be an object"]);
    if (candidate.directionEstablished !== true) throw new RelationshipValidationError(["subject-object direction was not explicitly established"]);
    const relationshipType = text(candidate.relationshipType, "relationshipType", { required: true, max: 100 });
    if (!RELATIONSHIP_TYPES.includes(relationshipType)) throw new RelationshipValidationError(["relationshipType is outside the controlled vocabulary"]);
    const subject = validateParty(candidate.subject, "subject"), object = validateParty(candidate.object, "object"), value = validateValue(candidate.value), temporal = validateTemporal(candidate.temporal || {});
    const sourceSpecificMetadata = boundedObject(candidate.sourceSpecificMetadata, "sourceSpecificMetadata");
    if (relationshipType === "OTHER" && !text(sourceSpecificMetadata.originalRelationshipLabel, "sourceSpecificMetadata.originalRelationshipLabel")) throw new RelationshipValidationError(["OTHER requires the understood original relationship label"]);
    const mappingMethod = text(context.mappingMethod || candidate.mappingMethod || "provider_structured", "mappingMethod", { required: true, max: 100 });
    if (!MAPPING_METHODS.includes(mappingMethod)) throw new RelationshipValidationError(["mappingMethod is not supported"]);
    return { relationship: {
      factId: text(context.factId, "factId", { required: true, max: 100 }), relationshipSchemaVersion: RELATIONSHIP_SCHEMA_VERSION, relationshipType,
      subjectPartyType: subject.partyType, subjectSnapshot: subject.snapshot, objectPartyType: object.partyType, objectSnapshot: object.snapshot,
      ...value, ...temporal, sourceSpecificMetadata,
      qualifications: boundedArray(candidate.qualifications, "qualifications").map((item, index) => text(item, `qualifications[${index}]`, { required: true })),
      mappingMethod,
      mapperId: text(context.mapperId || candidate.mapperId || "evidence-r4-typed-output-validator", "mapperId", { required: true, max: 300 }),
      mapperVersion: text(context.mapperVersion || candidate.mapperVersion || "1", "mapperVersion", { required: true, max: 100 }),
      mapperReference: text(context.mapperReference || candidate.mapperReference, "mapperReference"),
      createdAt: text(context.createdAt, "createdAt", { required: true, max: 100 }),
    }, limitations: [] };
  } catch (error) {
    if (error instanceof RelationshipValidationError) return { relationship: null, limitations: error.limitations };
    return { relationship: null, limitations: ["typed relationship candidate could not be validated"] };
  }
}

function validateTypedRelationshipLineage({ facts = [], typedRelationships = [], factArtifactSupports = [], factArtifactLocators = [] }) {
  if (!Array.isArray(typedRelationships)) throw new Error("typedRelationships must be an array");
  const factById = new Map(facts.map((fact) => [fact.id, fact])), seen = new Set();
  for (const relationship of typedRelationships) {
    if (seen.has(relationship.factId)) throw new Error(`Fact ${relationship.factId} has more than one typed relationship extension`);
    seen.add(relationship.factId);
    if (!factById.has(relationship.factId)) throw new Error(`typed relationship references missing Fact ${relationship.factId}`);
    const candidate = {
      directionEstablished: true, relationshipType: relationship.relationshipType,
      subject: { partyType: relationship.subjectPartyType, ...relationship.subjectSnapshot }, object: { partyType: relationship.objectPartyType, ...relationship.objectSnapshot },
      value: { kind: relationship.valueKind, measurementType: relationship.measurementType, value: relationship.valueKind === "QUALITATIVE" ? relationship.qualitativeValue : relationship.exactValue, lower: relationship.rangeLower, upper: relationship.rangeUpper, lowerInclusive: relationship.lowerInclusive, upperInclusive: relationship.upperInclusive, numerator: relationship.numerator, denominator: relationship.denominator, unit: relationship.unit },
      temporal: { state: relationship.temporalState, effectiveFrom: relationship.effectiveFrom, effectiveTo: relationship.effectiveTo, sourceEffectiveDate: relationship.sourceEffectiveDate, precision: relationship.temporalPrecision },
      sourceSpecificMetadata: relationship.sourceSpecificMetadata, qualifications: relationship.qualifications,
    };
    const checked = validateTypedRelationshipCandidate(candidate, { factId: relationship.factId, mappingMethod: relationship.mappingMethod, mapperId: relationship.mapperId, mapperVersion: relationship.mapperVersion, mapperReference: relationship.mapperReference, createdAt: relationship.createdAt });
    if (!checked.relationship) throw new Error(`typed relationship ${relationship.factId} is invalid: ${checked.limitations.join("; ")}`);
    const supports = factArtifactSupports.filter((support) => support.factId === relationship.factId);
    if (!supports.length) throw new Error(`typed relationship ${relationship.factId} requires Fact-to-Artifact support`);
    if (!factArtifactLocators.some((locator) => locator.factId === relationship.factId && supports.some((support) => support.artifactId === locator.artifactId))) throw new Error(`typed relationship ${relationship.factId} requires at least one R3 locator`);
  }
  return typedRelationships;
}

module.exports = { MAPPING_METHODS, MAX_TEXT, MEASUREMENT_TYPES, PARTY_TYPES, RELATIONSHIP_SCHEMA_VERSION, RELATIONSHIP_TYPES, RelationshipValidationError, TEMPORAL_STATES, VALUE_KINDS, validateParty, validateTemporal, validateTypedRelationshipCandidate, validateTypedRelationshipLineage, validateValue };
