"use strict";

const ASSERTION_SCHEMA_VERSION = "evidence-typed-set-v1";
const EMPTY = Object.freeze(["established_empty", "non_empty", "unknown"]);
const COMPLETENESS = Object.freeze(["complete", "incomplete", "unknown"]);
const TEMPORAL = Object.freeze(["current", "ceased", "historical", "unknown"]);
const MAPPING = Object.freeze(["direct_source", "deterministic_source_mapping", "provider_structured"]);

function validateTypedSetAssertion(input, context = {}) {
  const fail = (message) => { const error = new Error(message); error.code = "typed_set_assertion_invalid"; throw error; };
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Typed set assertion must be an object");
  const text = (value, label) => { if (typeof value !== "string" || !value.trim()) fail(`${label} is required`); return value.trim(); };
  const emptyState = text(input.emptyState, "emptyState"), completenessState = text(input.completenessState, "completenessState"), temporalState = text(input.temporalState || "unknown", "temporalState"), mappingMethod = text(context.mappingMethod || input.mappingMethod, "mappingMethod");
  if (!EMPTY.includes(emptyState) || !COMPLETENESS.includes(completenessState) || !TEMPORAL.includes(temporalState) || !MAPPING.includes(mappingMethod)) fail("Typed set assertion contains an unsupported state");
  const count = input.explicitMemberCount == null ? null : input.explicitMemberCount; if (count !== null && (!Number.isInteger(count) || count < 0)) fail("explicitMemberCount must be a non-negative integer");
  if (emptyState === "established_empty" && count !== null && count !== 0) fail("established_empty cannot have a non-zero member count");
  if (emptyState === "non_empty" && count !== null && count === 0) fail("non_empty cannot have a zero member count");
  const dates = ["effectiveFrom", "effectiveTo", "sourceEffectiveDate"]; for (const key of dates) if (input[key] && (typeof input[key] !== "string" || Number.isNaN(Date.parse(input[key])))) fail(`${key} must be a valid date`);
  if (input.effectiveFrom && input.effectiveTo && input.effectiveTo < input.effectiveFrom) fail("effectiveTo cannot precede effectiveFrom");
  const metadata = input.sourceSpecificMetadata || {}; if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || JSON.stringify(metadata).length > 12000) fail("sourceSpecificMetadata must be a bounded object");
  return { factId: text(context.factId || input.factId, "factId"), assertionSchemaVersion: ASSERTION_SCHEMA_VERSION, setConcept: text(input.setConcept, "setConcept"), emptyState, completenessState, explicitMemberCount: count, temporalState, effectiveFrom: input.effectiveFrom || null, effectiveTo: input.effectiveTo || null, sourceEffectiveDate: input.sourceEffectiveDate || null, sourceSpecificMetadata: structuredClone(metadata), mappingMethod, mapperId: text(context.mapperId || input.mapperId, "mapperId"), mapperVersion: text(context.mapperVersion || input.mapperVersion, "mapperVersion"), mapperReference: context.mapperReference || input.mapperReference || null, createdAt: context.createdAt || input.createdAt || new Date().toISOString() };
}

function mapCompaniesHouseNoRegistrablePsc({ inputFact, extractionRunId, createdAt, idFor }) {
  const state = inputFact?.sourceSpecificState;
  if (state !== "no_individual_or_entity_with_significant_control" || inputFact?.acquisitionStatus !== "successful") return { facts: [], typedSetAssertions: [], derivations: [], limitations: ["Source state does not establish a complete empty registrable-PSC set"] };
  const factId = idFor(); const fact = { id: factId, extractionRunId, artifactId: inputFact.artifactId, informationNeedId: null, schemaFieldId: null, semanticConceptId: "registrable_psc_set_state", requestStatus: "discovered", groundingType: "derived", factValue: "no registrable person with significant control", rawRepresentation: inputFact.rawRepresentation, supportState: inputFact.supportState, supportSignals: { deterministicMapping: { mapperId: "companies-house-psc-empty-set", mapperVersion: "1", sourceFactId: inputFact.id } }, sourcePolicyContext: {}, createdAt };
  const assertion = validateTypedSetAssertion({ setConcept: "registrable_psc", emptyState: "established_empty", completenessState: "complete", explicitMemberCount: 0, temporalState: "current", sourceSpecificMetadata: { sourceState: state } }, { factId, mappingMethod: "deterministic_source_mapping", mapperId: "companies-house-psc-empty-set", mapperVersion: "1", mapperReference: "evidence:a4b/companies-house-psc-empty-set-v1", createdAt });
  return { facts: [fact], typedSetAssertions: [assertion], derivations: [{ derivedFactId: factId, inputFactId: inputFact.id, transformationId: "companies-house-psc-empty-set", transformationVersion: "1", transformationReference: "evidence:a4b/companies-house-psc-empty-set-v1", derivedAt: createdAt, createdAt }], limitations: [] };
}

module.exports = { ASSERTION_SCHEMA_VERSION, mapCompaniesHouseNoRegistrablePsc, validateTypedSetAssertion };
