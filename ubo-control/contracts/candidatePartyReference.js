"use strict";

const {
  assertArray,
  assertDataOnly,
  assertNonEmptyString,
  assertOptionalNonEmptyString,
  assertPlainObject,
  fail,
} = require("../internal/validation");

function validateExternalIdentifier(identifier, path) {
  assertPlainObject(identifier, path);
  const namespace = identifier.namespace || identifier.system || identifier.identifierType;
  assertNonEmptyString(namespace, `${path}.namespace/system/identifierType`);
  assertNonEmptyString(identifier.value, `${path}.value`);
  assertDataOnly(identifier, path);
}

function validateCandidatePartyReference(party, path = "candidateParty") {
  assertPlainObject(party, path);
  assertOptionalNonEmptyString(party.entityId, `${path}.entityId`);
  assertOptionalNonEmptyString(party.name, `${path}.name`);
  assertOptionalNonEmptyString(party.entityType, `${path}.entityType`);
  assertOptionalNonEmptyString(party.jurisdiction, `${path}.jurisdiction`);

  const identifiers = party.externalIdentifiers === undefined ? [] : party.externalIdentifiers;
  assertArray(identifiers, `${path}.externalIdentifiers`);
  identifiers.forEach((identifier, index) => {
    validateExternalIdentifier(identifier, `${path}.externalIdentifiers[${index}]`);
  });

  if (!party.entityId && !party.name && identifiers.length === 0) {
    fail(`${path} requires entityId, name, or at least one external identifier`);
  }

  assertDataOnly(party, path);
  return true;
}

module.exports = { validateCandidatePartyReference };
