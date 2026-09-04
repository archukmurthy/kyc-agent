"use strict";

const { normalizeText } = require("../a4a/normalization");
const COMPARATOR = Object.freeze({ id: "evidence_conservative_comparison", version: "1", reference: "evidence:a4b/conservative-comparison-v1" });

function identifiers(party = {}) { return Array.isArray(party.identifiers) ? party.identifiers.filter((item) => item?.scheme && item?.value) : []; }
function sameStableIdentifier(left, right) { const rightIds = identifiers(right); return identifiers(left).some((a) => rightIds.some((b) => normalizeText(a.scheme) === normalizeText(b.scheme) && normalizeText(a.value) === normalizeText(b.value) && normalizeText(a.jurisdiction || "") === normalizeText(b.jurisdiction || ""))); }
function explicitAssociation(left, right, context = {}) { return (context.associations || []).some((item) => { const a = new Set(item.leftIdentifiers || []), b = new Set(item.rightIdentifiers || []); return identifiers(left).some((id) => a.has(`${id.scheme}:${id.value}`)) && identifiers(right).some((id) => b.has(`${id.scheme}:${id.value}`)); }); }
function associateParty(left, right, context = {}) { if (sameStableIdentifier(left, right)) return { established: true, method: "stable_identifier", version: "1" }; if (explicitAssociation(left, right, context)) return { established: true, method: "caller_supplied", version: context.version || "unspecified" }; return { established: false, method: null, version: null }; }

function interval(relation) {
  if (relation.valueKind === "EXACT") { const value = relation.measurementType === "count_of_total" ? Number(relation.numerator) / Number(relation.denominator) : Number(relation.exactValue); return Number.isFinite(value) ? { lower: value, upper: value, lowerInclusive: true, upperInclusive: true } : null; }
  if (relation.valueKind !== "RANGE") return null;
  return { lower: relation.rangeLower == null ? -Infinity : Number(relation.rangeLower), upper: relation.rangeUpper == null ? Infinity : Number(relation.rangeUpper), lowerInclusive: relation.rangeLower == null ? false : !!relation.lowerInclusive, upperInclusive: relation.rangeUpper == null ? false : !!relation.upperInclusive };
}
function intervalsOverlap(a, b) { const lower = Math.max(a.lower, b.lower), upper = Math.min(a.upper, b.upper); if (lower < upper) return true; if (lower > upper) return false; const aAllows = (lower !== a.lower || a.lowerInclusive) && (lower !== a.upper || a.upperInclusive), bAllows = (lower !== b.lower || b.lowerInclusive) && (lower !== b.upper || b.upperInclusive); return aAllows && bAllows; }
function sameInterval(a, b) { return a.lower === b.lower && a.upper === b.upper && a.lowerInclusive === b.lowerInclusive && a.upperInclusive === b.upperInclusive; }

function applicableInterval(relation) { const from = relation.effectiveFrom ? Date.parse(relation.effectiveFrom) : -Infinity, to = relation.effectiveTo ? Date.parse(relation.effectiveTo) : Infinity; return { from, to }; }
function temporalCompatibility(left, right, specification) {
  const scope = specification.temporalScope;
  if (scope === "any") return { comparable: true, outcome: "applicable" };
  if (scope === "current") {
    if (left.temporalState === "current" && right.temporalState === "current") return { comparable: true, outcome: "applicable" };
    if (left.temporalState === "unknown" || right.temporalState === "unknown") return { comparable: false, outcome: "indeterminate", reason: "temporal_information_insufficient" };
    return { comparable: false, outcome: "not_applicable", reason: "non_overlapping_temporal_basis" };
  }
  if (scope === "as_of") {
    const point = Date.parse(specification.asOf); const applicable = (item) => { const intervalValue = applicableInterval(item); return point >= intervalValue.from && point <= intervalValue.to; };
    if (!Number.isFinite(point)) return { comparable: false, outcome: "indeterminate", reason: "temporal_information_insufficient" };
    if (applicable(left) && applicable(right)) return { comparable: true, outcome: "applicable" };
    if ([left, right].some((item) => item.temporalState === "unknown" && !item.effectiveFrom && !item.effectiveTo)) return { comparable: false, outcome: "indeterminate", reason: "temporal_information_insufficient" };
    return { comparable: false, outcome: "not_applicable", reason: "non_overlapping_temporal_basis" };
  }
  const a = applicableInterval(left), b = applicableInterval(right); if (Math.max(a.from, b.from) <= Math.min(a.to, b.to)) return { comparable: true, outcome: "applicable" };
  return { comparable: false, outcome: "not_applicable", reason: "non_overlapping_temporal_basis" };
}

function compareScalarValues(left, right, expectedValueShape) {
  if (expectedValueShape === "text" || (!expectedValueShape && typeof left === "string" && typeof right === "string")) return normalizeText(left) === normalizeText(right) ? { comparable: true, relationship: "agrees", reasonCode: "normalized_values_agree" } : { comparable: true, relationship: "disagrees", reasonCode: "normalized_values_disagree" };
  if (["number", "percentage"].includes(expectedValueShape) && Number.isFinite(Number(left)) && Number.isFinite(Number(right))) return Number(left) === Number(right) ? { comparable: true, relationship: "agrees", reasonCode: "typed_values_agree" } : { comparable: true, relationship: "disagrees", reasonCode: "typed_values_disagree" };
  return { comparable: false, relationship: "indeterminate", reasonCode: "comparison_context_missing" };
}

function compareTypedRelationships(left, right, specification) {
  if (!left || !right) return { comparable: false, relationship: "indeterminate", reasonCode: "typed_relationship_missing", temporalOutcome: "indeterminate" };
  if (left.relationshipType !== right.relationshipType || left.measurementType !== right.measurementType || normalizeText(left.unit || "") !== normalizeText(right.unit || "")) return { comparable: false, relationship: "indeterminate", reasonCode: "relationship_semantics_not_comparable", temporalOutcome: "indeterminate" };
  const subject = associateParty(left.subjectSnapshot, right.subjectSnapshot, specification.partyAssociationContext), object = associateParty(left.objectSnapshot, right.objectSnapshot, specification.partyAssociationContext);
  if (!subject.established || !object.established) return { comparable: false, relationship: "indeterminate", reasonCode: "identity_association_missing", temporalOutcome: "indeterminate", association: { subject, object } };
  const temporal = temporalCompatibility(left, right, specification); if (!temporal.comparable) return { comparable: false, relationship: "indeterminate", reasonCode: temporal.reason, temporalOutcome: temporal.outcome, association: { subject, object } };
  const a = interval(left), b = interval(right); if (!a || !b) return { comparable: false, relationship: "indeterminate", reasonCode: "value_shape_not_comparable", temporalOutcome: temporal.outcome, association: { subject, object } };
  const overlap = intervalsOverlap(a, b); return { comparable: true, relationship: overlap ? (sameInterval(a, b) ? "agrees" : "compatible_overlap") : "disagrees", reasonCode: overlap ? (sameInterval(a, b) ? "typed_intervals_agree" : "typed_intervals_overlap") : "typed_intervals_disjoint", temporalOutcome: temporal.outcome, association: { subject, object }, basis: { left: a, right: b } };
}

function compareCandidates(left, right, specification) {
  if (specification.expectedValueShape === "typed_relationship") return compareTypedRelationships(left.typedRelationship, right.typedRelationship, specification);
  if (specification.temporalScope !== "any") return { comparable: false, relationship: "indeterminate", reasonCode: "temporal_information_insufficient", temporalOutcome: "indeterminate" };
  return { ...compareScalarValues(left.factValue, right.factValue, specification.expectedValueShape), temporalOutcome: specification.temporalScope === "any" ? "applicable" : "indeterminate" };
}

module.exports = { COMPARATOR, associateParty, compareCandidates, compareScalarValues, compareTypedRelationships, interval, intervalsOverlap, temporalCompatibility };
