"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { hashPolicyPack, loadPolicyPack, validatePolicyPack } = require("../policy/policyPack");

const v14 = require("../policies/uk-corporate/1.4-rc/policy.json");
const policyPack = require("../policies/uk-corporate/1.5-rc/policy.json");
const EXPECTED_HASH = "sha256:724c2fa4820e02daddc24e652b50748646d87017cbfa632c062bc9e27de4b790";

test("UK Corporate 1.5-RC is a schema-1.2 successor and leaves historical 1.4-RC valid", () => {
  assert.equal(validatePolicyPack(v14), true);
  assert.equal(hashPolicyPack(v14), "sha256:43e1ce72f884d626a4962351a44c7305117c6b12d6e398ca1ebb4ca46813a87a");
  assert.equal(validatePolicyPack(policyPack), true);
  assert.equal(policyPack.schemaVersion, "1.2");
  assert.equal(policyPack.version, "1.5-RC");
  assert.equal(policyPack.supersedes, "1.4-RC");
  assert.equal(hashPolicyPack(policyPack), EXPECTED_HASH);
  assert.equal(loadPolicyPack(policyPack, { expectedHash: EXPECTED_HASH }).identity.hash, EXPECTED_HASH);
});

test("DISCLOSE_SHARE_OWNERSHIP has the exact approved structured submission contract", () => {
  const template = policyPack.actionTemplates.DISCLOSE_SHARE_OWNERSHIP;
  assert.equal(template.contentStatus, "CONTROL_ROOM_APPROVED");
  assert.deepEqual(template.submissionContract, {
    factType: "RELATIONSHIP",
    concept: "SHARE_OWNERSHIP",
    relationshipType: "ECONOMIC_OWNERSHIP",
    direction: "OWNER_TO_TARGET",
    target: "INFORMATION_NEED_SUBJECT",
    allowedMeasurementTypes: ["EXACT", "RANGE", "UNKNOWN"],
    temporalMeaning: "CURRENT",
  });
  assert.deepEqual(template.sourceDecision, {
    source: "CONTROL_ROOM_SUCCESSOR_POLICY",
    decisionDate: "2026-09-01",
    supersedesUnresolvedReference: "B1",
  });
  assert.match(template.textByEntityProfile.COMPANY, /direct|currently owns shares/i);
  assert.equal(policyPack.sourceTraceability.unresolvedActionTemplateSourceReferences
    .some(({ semanticId }) => semanticId === "DISCLOSE_SHARE_OWNERSHIP"), false);
});

test("schema 1.2 rejects malformed submission semantics and inconsistent source provenance", () => {
  const wrongRelationship = structuredClone(policyPack);
  wrongRelationship.actionTemplates.DISCLOSE_SHARE_OWNERSHIP.submissionContract.relationshipType = "CLOSE_ENOUGH";
  assert.throws(() => validatePolicyPack(wrongRelationship), /relationshipType/);

  const wrongProvenance = structuredClone(policyPack);
  wrongProvenance.actionTemplates.DISCLOSE_SHARE_OWNERSHIP.sourceDecision.decisionDate = "2026-09-02";
  assert.throws(() => validatePolicyPack(wrongProvenance), /inconsistent successor-policy provenance/);
});

test("COMPANY and LLP retain separate R01 concepts, templates and wording", () => {
  const r01 = policyPack.requirements.find(({ requirementId }) => requirementId === "UBO-R01");
  assert.deepEqual(r01.entitySemantics.COMPANY, {
    concept: "SHARE_OWNERSHIP",
    actionTemplateId: "DISCLOSE_SHARE_OWNERSHIP",
  });
  assert.deepEqual(r01.entitySemantics.LLP, {
    concept: "SURPLUS_ASSET_RIGHTS",
    actionTemplateId: "DISCLOSE_LLP_SURPLUS_ASSET_RIGHTS",
  });
  const companyQuestion = r01.resolutionStrategies.find(({ condition }) => condition === "case.entity_profile == 'COMPANY'");
  const llpQuestion = r01.resolutionStrategies.find(({ condition }) => condition === "case.entity_profile == 'LLP'");
  assert.equal(companyQuestion.actionTemplateId, "DISCLOSE_SHARE_OWNERSHIP");
  assert.equal(llpQuestion.actionTemplateId, "DISCLOSE_LLP_SURPLUS_ASSET_RIGHTS");
  const llpTemplate = policyPack.actionTemplates.DISCLOSE_LLP_SURPLUS_ASSET_RIGHTS;
  assert.equal(llpTemplate.contentStatus, "SUPPLIED");
  assert.equal(llpTemplate.entityProfile, "LLP");
  assert.match(llpTemplate.text, /surplus assets/i);
  assert.equal(llpTemplate.textByEntityProfile, undefined);
  assert.doesNotMatch(llpTemplate.text, /owns shares/i);
});
