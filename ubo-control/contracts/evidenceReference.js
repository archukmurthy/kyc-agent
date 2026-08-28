"use strict";

const {
  assertDataOnly,
  assertNonEmptyString,
  assertOptionalNonEmptyString,
  assertPlainObject,
  fail,
} = require("../internal/validation");

function validateEvidenceReference(reference, path = "evidenceReference") {
  assertPlainObject(reference, path);

  const hasSystem = typeof reference.system === "string" && reference.system.trim() !== "";
  const hasNamespace = typeof reference.namespace === "string" && reference.namespace.trim() !== "";
  if (!hasSystem && !hasNamespace) {
    fail(`${path} requires system or namespace`);
  }

  assertOptionalNonEmptyString(reference.system, `${path}.system`);
  assertOptionalNonEmptyString(reference.namespace, `${path}.namespace`);
  assertNonEmptyString(reference.referenceType, `${path}.referenceType`);
  assertNonEmptyString(reference.referenceId, `${path}.referenceId`);

  if (reference.locator !== undefined) {
    assertDataOnly(reference.locator, `${path}.locator`);
  }

  if (reference.integrity !== undefined) {
    assertPlainObject(reference.integrity, `${path}.integrity`);
    assertNonEmptyString(reference.integrity.algorithm, `${path}.integrity.algorithm`);
    assertNonEmptyString(reference.integrity.digest, `${path}.integrity.digest`);
    assertDataOnly(reference.integrity, `${path}.integrity`);
  }

  return true;
}

module.exports = { validateEvidenceReference };
