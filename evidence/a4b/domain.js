"use strict";

const NEED_SHAPES = Object.freeze(["scalar", "collection"]);
const VALUE_SHAPES = Object.freeze(["text", "number", "percentage", "structured_address", "typed_relationship", "typed_set", "other"]);
const TEMPORAL_SCOPES = Object.freeze(["any", "current", "as_of", "historical"]);
const COMPLETENESS_REQUIREMENTS = Object.freeze(["none", "complete_set"]);
const COVERAGE_STATES = Object.freeze(["covered", "partially_covered", "uncovered", "indeterminate"]);
const COMPLETENESS_STATES = Object.freeze(["complete", "incomplete", "indeterminate", "not_applicable"]);
const DISAGREEMENT_STATES = Object.freeze(["none", "present", "indeterminate", "not_applicable"]);
const TEMPORAL_OUTCOMES = Object.freeze(["applicable", "partially_applicable", "not_applicable", "indeterminate"]);
const EMPTY_STATES = Object.freeze(["established_empty", "not_established", "indeterminate", "not_applicable"]);
const INPUT_STATES = Object.freeze(["sufficient", "insufficient"]);
const ALLOWED_KEYS = new Set(["specificationVersion", "needShape", "expectedValueShape", "comparisonProfile", "collection", "temporalScope", "asOf", "partyAssociationContext", "candidateEligibilityContext", "externalPolicyReferences"]);

class SpecificationValidationError extends Error { constructor(message) { super(message); this.code = "assessment_specification_invalid"; this.statusCode = 400; } }
function plain(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function bounded(value, label, max = 16000) { if (value === undefined || value === null) return null; if (JSON.stringify(value).length > max) throw new SpecificationValidationError(`${label} exceeds its bounded allowance`); return structuredClone(value); }
function requiredText(value, label, max = 200) { if (typeof value !== "string" || !value.trim()) throw new SpecificationValidationError(`${label} is required`); if (value.trim().length > max) throw new SpecificationValidationError(`${label} is too long`); return value.trim(); }
function optionalInteger(value, label) { if (value === undefined || value === null || value === "") return null; if (!Number.isInteger(value) || value < 0) throw new SpecificationValidationError(`${label} must be a non-negative integer`); return value; }
function rejectExecutablePolicy(value, path = "specification") { if (plain(value)) for (const [key, child] of Object.entries(value)) { if (/prompt|script|code|expression|executable|instruction/i.test(key)) throw new SpecificationValidationError(`${path}.${key} is not permitted; executable policy and prompts are outside A4b`); rejectExecutablePolicy(child, `${path}.${key}`); } else if (Array.isArray(value)) value.forEach((child, i) => rejectExecutablePolicy(child, `${path}[${i}]`)); }
function onlyKeys(value, allowed, label) { for (const key of Object.keys(value || {})) if (!allowed.includes(key)) throw new SpecificationValidationError(`Unsupported ${label} field: ${key}`); }
function canonicalize(value) { if (Array.isArray(value)) return value.map(canonicalize); if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])); return value; }

function validateSpecification(input) {
  if (!plain(input)) throw new SpecificationValidationError("Assessment Specification must be an object");
  for (const key of Object.keys(input)) if (!ALLOWED_KEYS.has(key)) throw new SpecificationValidationError(`Unsupported Assessment Specification field: ${key}`);
  rejectExecutablePolicy(input);
  const specificationVersion = requiredText(input.specificationVersion, "specificationVersion");
  const needShape = requiredText(input.needShape, "needShape", 40); if (!NEED_SHAPES.includes(needShape)) throw new SpecificationValidationError("needShape must be scalar or collection");
  const expectedValueShape = input.expectedValueShape == null ? null : requiredText(input.expectedValueShape, "expectedValueShape", 80); if (expectedValueShape && !VALUE_SHAPES.includes(expectedValueShape)) throw new SpecificationValidationError("expectedValueShape is outside the bounded Evidence vocabulary");
  if (!plain(input.comparisonProfile)) throw new SpecificationValidationError("comparisonProfile must name a versioned comparator");
  onlyKeys(input.comparisonProfile, ["name", "version"], "comparisonProfile");
  const comparisonProfile = { name: requiredText(input.comparisonProfile.name, "comparisonProfile.name"), version: requiredText(input.comparisonProfile.version, "comparisonProfile.version", 80) };
  const temporalScope = requiredText(input.temporalScope, "temporalScope", 40); if (!TEMPORAL_SCOPES.includes(temporalScope)) throw new SpecificationValidationError("temporalScope is not supported");
  const asOf = input.asOf == null ? null : requiredText(input.asOf, "asOf", 80); if (temporalScope === "as_of" && (!asOf || Number.isNaN(Date.parse(asOf)))) throw new SpecificationValidationError("asOf must be a valid date or timestamp for as_of assessment");
  let collection = null;
  if (needShape === "collection") {
    const supplied = input.collection || {}; if (!plain(supplied)) throw new SpecificationValidationError("collection must be an object");
    onlyKeys(supplied, ["completenessRequirement", "cardinality"], "collection");
    const completenessRequirement = supplied.completenessRequirement || "none"; if (!COMPLETENESS_REQUIREMENTS.includes(completenessRequirement)) throw new SpecificationValidationError("collection.completenessRequirement is not supported");
    const cardinalityInput = supplied.cardinality || {}; if (!plain(cardinalityInput)) throw new SpecificationValidationError("collection.cardinality must be an object");
    onlyKeys(cardinalityInput, ["minimum", "maximum", "exact"], "collection.cardinality");
    const cardinality = { minimum: optionalInteger(cardinalityInput.minimum, "collection.cardinality.minimum"), maximum: optionalInteger(cardinalityInput.maximum, "collection.cardinality.maximum"), exact: optionalInteger(cardinalityInput.exact, "collection.cardinality.exact") };
    if (cardinality.minimum !== null && cardinality.maximum !== null && cardinality.minimum > cardinality.maximum) throw new SpecificationValidationError("collection cardinality minimum cannot exceed maximum");
    if (cardinality.exact !== null && ((cardinality.minimum !== null && cardinality.exact < cardinality.minimum) || (cardinality.maximum !== null && cardinality.exact > cardinality.maximum))) throw new SpecificationValidationError("collection exact cardinality conflicts with its bounds");
    collection = { completenessRequirement, cardinality };
  } else if (input.collection != null) throw new SpecificationValidationError("collection semantics apply only to collection needs");
  const partyAssociationContext = bounded(input.partyAssociationContext, "partyAssociationContext") || { associations: [] };
  const candidateEligibilityContext = bounded(input.candidateEligibilityContext, "candidateEligibilityContext");
  const externalPolicyReferences = bounded(input.externalPolicyReferences, "externalPolicyReferences") || [];
  if (!plain(partyAssociationContext) || !Array.isArray(partyAssociationContext.associations || [])) throw new SpecificationValidationError("partyAssociationContext.associations must be an array");
  onlyKeys(partyAssociationContext, ["version", "associations"], "partyAssociationContext");
  partyAssociationContext.associations.forEach((association, index) => { if (!plain(association)) throw new SpecificationValidationError(`partyAssociationContext.associations[${index}] must be an object`); onlyKeys(association, ["leftIdentifiers", "rightIdentifiers"], `partyAssociationContext.associations[${index}]`); for (const side of ["leftIdentifiers", "rightIdentifiers"]) if (!Array.isArray(association[side]) || !association[side].length || association[side].some((item) => typeof item !== "string" || !item.trim() || item.length > 300)) throw new SpecificationValidationError(`partyAssociationContext.associations[${index}].${side} must contain bounded stable identifier references`); });
  if (candidateEligibilityContext && !plain(candidateEligibilityContext)) throw new SpecificationValidationError("candidateEligibilityContext must be an object");
  if (candidateEligibilityContext) { onlyKeys(candidateEligibilityContext, ["required", "version", "contextReference", "decisions"], "candidateEligibilityContext"); if (typeof candidateEligibilityContext.required !== "boolean") throw new SpecificationValidationError("candidateEligibilityContext.required must be boolean"); if (!Array.isArray(candidateEligibilityContext.decisions || [])) throw new SpecificationValidationError("candidateEligibilityContext.decisions must be an array"); for (const [index, decision] of (candidateEligibilityContext.decisions || []).entries()) { if (!plain(decision)) throw new SpecificationValidationError(`candidateEligibilityContext.decisions[${index}] must be an object`); onlyKeys(decision, ["evaluationId", "factId", "eligible", "reasonCode"], `candidateEligibilityContext.decisions[${index}]`); if ((!decision.evaluationId && !decision.factId) || typeof decision.eligible !== "boolean") throw new SpecificationValidationError(`candidateEligibilityContext.decisions[${index}] requires an evaluationId or factId and boolean eligible`); } }
  if (!Array.isArray(externalPolicyReferences)) throw new SpecificationValidationError("externalPolicyReferences must be an array of opaque references");
  if (externalPolicyReferences.length > 50 || externalPolicyReferences.some((item) => typeof item !== "string" || !item.trim() || item.length > 500)) throw new SpecificationValidationError("externalPolicyReferences must contain only bounded opaque text references");
  return canonicalize({ specificationVersion, needShape, expectedValueShape, comparisonProfile, collection, temporalScope, asOf, partyAssociationContext, candidateEligibilityContext, externalPolicyReferences });
}

function validateAssessmentBundle(bundle) {
  if (!bundle?.run?.id || !bundle.run.informationNeedId) throw new Error("Assessment run identity and Information Need are required");
  validateSpecification(bundle.run.specificationSnapshot);
  if (!COVERAGE_STATES.includes(bundle.run.coverageState) || !COMPLETENESS_STATES.includes(bundle.run.completenessState) || !DISAGREEMENT_STATES.includes(bundle.run.disagreementState) || !TEMPORAL_OUTCOMES.includes(bundle.run.temporalState) || !EMPTY_STATES.includes(bundle.run.emptySetState) || !INPUT_STATES.includes(bundle.run.inputSufficiency)) throw new Error("Assessment run contains an invalid outcome state");
  const candidates = bundle.candidates || []; if (!candidates.length) throw new Error("Assessment requires an explicit immutable candidate set");
  if (new Set(candidates.map((item) => item.a4aEvaluationId)).size !== candidates.length) throw new Error("An A4a evaluation may appear only once per assessment");
  if (candidates.some((item) => item.assessmentRunId !== bundle.run.id || !item.factId)) throw new Error("Candidate lineage must point to this assessment and an immutable Fact");
  if ((bundle.findings || []).some((item) => item.assessmentRunId !== bundle.run.id)) throw new Error("Comparison finding must belong to its assessment");
  return bundle;
}

module.exports = { COMPLETENESS_STATES, COVERAGE_STATES, DISAGREEMENT_STATES, EMPTY_STATES, INPUT_STATES, NEED_SHAPES, SpecificationValidationError, TEMPORAL_OUTCOMES, TEMPORAL_SCOPES, VALUE_SHAPES, canonicalize, validateAssessmentBundle, validateSpecification };
