"use strict";

const assert = require("node:assert/strict");
const { REQUIRED_METHODS } = require("../contracts/providerAdapter");
const { assertNoRawEvidence } = require("../domain/canonical");

function assertProviderContractShape(adapter) {
  for (const method of REQUIRED_METHODS) assert.equal(typeof adapter?.[method], "function", method);
}

function assertCanonicalProviderResult(result, provider) {
  assert.equal(result.provider, provider);
  assert.ok(result.provider_session_id);
  assert.ok(Array.isArray(result.identity_attributes));
  assert.ok(Array.isArray(result.verification_observations));
  assert.equal(result.provider_decision.provider, provider);
  assert.ok(Array.isArray(result.external_evidence_references));
  for (const reference of result.external_evidence_references) {
    assert.equal(reference.external_custody, true);
    assert.equal(reference.content_locally_available, false);
  }
  assertNoRawEvidence(result);
}

module.exports = { assertProviderContractShape, assertCanonicalProviderResult };
