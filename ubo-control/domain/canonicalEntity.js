"use strict";

const {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertEnum,
  assertNonEmptyString,
  assertOptionalNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
  fail,
} = require("../internal/validation");

const CANONICAL_ENTITY_CATEGORY = Object.freeze({
  NATURAL_PERSON: "NATURAL_PERSON",
  LEGAL_ENTITY: "LEGAL_ENTITY",
  TRUST_OR_LEGAL_ARRANGEMENT: "TRUST_OR_LEGAL_ARRANGEMENT",
  OTHER: "OTHER",
  UNKNOWN: "UNKNOWN",
});

function validateTimestamp(value, path) {
  assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(value))) fail(`${path} must be an ISO-compatible timestamp`);
}

function validateExternalIdentifier(identifier, path) {
  assertPlainObject(identifier, path);
  const namespace = identifier.namespace || identifier.system || identifier.identifierType;
  assertNonEmptyString(namespace, `${path}.namespace/system/identifierType`);
  assertNonEmptyString(identifier.value, `${path}.value`);
  assertDataOnly(identifier, path);
}

function validateCanonicalEntityRecord(entity, path = "canonicalEntity") {
  assertPlainObject(entity, path);
  assertAllowedKeys(entity, [
    "entityId",
    "category",
    "primaryName",
    "aliases",
    "externalIdentifiers",
    "jurisdiction",
    "entityTypeMetadata",
    "createdAt",
    "createdInRevision",
  ], path);
  assertNonEmptyString(entity.entityId, `${path}.entityId`);
  assertEnum(entity.category, CANONICAL_ENTITY_CATEGORY, `${path}.category`);
  assertOptionalNonEmptyString(entity.primaryName, `${path}.primaryName`);
  assertArray(entity.aliases, `${path}.aliases`);
  entity.aliases.forEach((alias, index) => assertNonEmptyString(alias, `${path}.aliases[${index}]`));
  assertArray(entity.externalIdentifiers, `${path}.externalIdentifiers`);
  entity.externalIdentifiers.forEach((identifier, index) => {
    validateExternalIdentifier(identifier, `${path}.externalIdentifiers[${index}]`);
  });
  assertOptionalNonEmptyString(entity.jurisdiction, `${path}.jurisdiction`);
  assertPlainObject(entity.entityTypeMetadata, `${path}.entityTypeMetadata`);
  assertDataOnly(entity.entityTypeMetadata, `${path}.entityTypeMetadata`);
  validateTimestamp(entity.createdAt, `${path}.createdAt`);
  if (!Number.isSafeInteger(entity.createdInRevision) || entity.createdInRevision < 1) {
    fail(`${path}.createdInRevision must be a positive safe integer`);
  }
  assertDataOnly(entity, path);
  return true;
}

function createCanonicalEntityRecord(input, { createdAt, createdInRevision }) {
  assertPlainObject(input, "canonicalEntityInput");
  assertAllowedKeys(input, [
    "entityId",
    "category",
    "primaryName",
    "aliases",
    "externalIdentifiers",
    "jurisdiction",
    "entityTypeMetadata",
  ], "canonicalEntityInput");
  const record = {
    entityId: input.entityId,
    category: input.category,
    aliases: cloneData(input.aliases || []),
    externalIdentifiers: cloneData(input.externalIdentifiers || []),
    entityTypeMetadata: cloneData(input.entityTypeMetadata || {}),
    createdAt,
    createdInRevision,
  };
  if (input.primaryName !== undefined) record.primaryName = input.primaryName;
  if (input.jurisdiction !== undefined) record.jurisdiction = input.jurisdiction;
  validateCanonicalEntityRecord(record);
  return deepFreeze(record);
}

module.exports = {
  CANONICAL_ENTITY_CATEGORY,
  createCanonicalEntityRecord,
  validateCanonicalEntityRecord,
};
