"use strict";

const {
  assertArray,
  assertDataOnly,
  assertEnum,
  assertNonEmptyString,
  assertOptionalNonEmptyString,
  assertPlainObject,
  fail,
} = require("../internal/validation");
const { CANDIDATE_FACT_TYPE, RELATIONSHIP_TYPE } = require("./constants");
const { validateCandidatePartyReference } = require("./candidatePartyReference");
const { validateEvidenceReference } = require("./evidenceReference");
const { validatePercentageValue } = require("./percentageValue");

function validateFactEvidence(fact, path) {
  assertArray(fact.evidenceReferences, `${path}.evidenceReferences`);
  fact.evidenceReferences.forEach((reference, index) => {
    validateEvidenceReference(reference, `${path}.evidenceReferences[${index}]`);
  });
}

function validateRelationshipFact(fact, path) {
  validateCandidatePartyReference(fact.subject, `${path}.subject`);
  validateCandidatePartyReference(fact.object, `${path}.object`);
  assertEnum(fact.relationship, RELATIONSHIP_TYPE, `${path}.relationship`);

  if (fact.measurement !== undefined) {
    validatePercentageValue(fact.measurement, `${path}.measurement`);
  }

  if (fact.qualifiers !== undefined) {
    assertPlainObject(fact.qualifiers, `${path}.qualifiers`);
    assertDataOnly(fact.qualifiers, `${path}.qualifiers`);
  }
}

function validateEntityAttributeFact(fact, path) {
  validateCandidatePartyReference(fact.subject, `${path}.subject`);
  assertNonEmptyString(fact.attribute, `${path}.attribute`);
  if (!Object.prototype.hasOwnProperty.call(fact, "value")) {
    fail(`${path}.value is required`);
  }
  assertDataOnly(fact.value, `${path}.value`);
}

function validateCandidateFact(fact, path = "candidateFact") {
  assertPlainObject(fact, path);
  assertOptionalNonEmptyString(fact.factId, `${path}.factId`);
  assertEnum(fact.type, CANDIDATE_FACT_TYPE, `${path}.type`);
  validateFactEvidence(fact, path);

  if (fact.type === CANDIDATE_FACT_TYPE.RELATIONSHIP) {
    validateRelationshipFact(fact, path);
  } else if (fact.type === CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE) {
    validateEntityAttributeFact(fact, path);
  }

  assertDataOnly(fact, path);
  return true;
}

module.exports = { validateCandidateFact };
