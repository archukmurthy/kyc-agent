"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  APPLICABILITY_MODEL_VERSION,
  CANONICALIZATION_ALGORITHM,
  CAPABILITY_CONTRACT_VERSION,
  CLAIM_STATE_MODEL_VERSION,
  CONDITION_LANGUAGE_VERSION,
  POLICY_PACK_SCHEMA_ID,
  POLICY_PACK_SCHEMA_VERSION,
  REQUIREMENT_STATE,
  REQUIREMENT_STATE_MODEL_VERSION,
  RESOLUTION_SEMANTICS_VERSION,
  RISK_LEVEL_MODEL_VERSION,
  PolicyPackIntegrityError,
  PolicyPackValidationError,
  canonicalizeJson,
  hashPolicyPack,
  loadPolicyPack,
  validatePolicyPack,
} = require("..");

function engineSemantics() {
  return {
    capabilityContractVersion: CAPABILITY_CONTRACT_VERSION,
    conditionLanguageVersion: CONDITION_LANGUAGE_VERSION,
    requirementStateModelVersion: REQUIREMENT_STATE_MODEL_VERSION,
    claimStateModelVersion: CLAIM_STATE_MODEL_VERSION,
    applicabilityModelVersion: APPLICABILITY_MODEL_VERSION,
    resolutionSemanticsVersion: RESOLUTION_SEMANTICS_VERSION,
    riskLevelModelVersion: RISK_LEVEL_MODEL_VERSION,
    canonicalizationAlgorithm: CANONICALIZATION_ALGORITHM,
  };
}

function validPolicyPack(overrides = {}) {
  return {
    schemaId: POLICY_PACK_SCHEMA_ID,
    schemaVersion: POLICY_PACK_SCHEMA_VERSION,
    policyPackId: "test.pack",
    version: "1.0.0",
    status: "DRAFT",
    jurisdiction: "GB",
    applicability: { subjectType: "CORPORATE" },
    effectivePeriod: { from: "2026-01-01" },
    engineSemantics: engineSemantics(),
    parameters: {},
    definitions: {},
    entityProfiles: {},
    evidenceCatalogue: { items: [] },
    requirements: [{
      requirementId: "req-1",
      ruleIds: ["rule-1"],
      applicability: { condition: "always" },
    }],
    rules: [{ ruleId: "rule-1", condition: "always" }],
    actionTemplates: {},
    ...overrides,
  };
}

function referencedPolicyPack() {
  return validPolicyPack({
    sourceTraceability: {
      unresolvedActionTemplateSourceReferences: [],
      unresolvedLifecycleEventSourceReferences: [],
    },
    lifecyclePolicy: { eventCatalogue: { EVENT_1: { description: "Host-neutral event" } } },
    parameters: { threshold_pct: { value: 25 } },
    definitions: { ownership: "Ownership definition" },
    evidenceCatalogue: {
      items: [{ key: "governance_document", maxAgeRef: "threshold_pct" }],
    },
    entityProfiles: {
      company: {
        profile: "COMPANY",
        economicInterestConcept: "SHARE_OWNERSHIP",
        votingConcept: "VOTING_RIGHTS",
        appointmentControlConcept: "BOARD_APPOINTMENT_RIGHTS",
        primaryGovernanceDocuments: ["governance_document"],
      },
    },
    actionTemplates: {
      DISCLOSE_OWNER: { contentStatus: "SUPPLIED", text: "Identify the owner." },
    },
    requirements: [{
      requirementId: "req-1",
      ruleIds: ["rule-1"],
      applicability: { condition: "facts.share >= params.threshold_pct" },
      thresholdRef: "threshold_pct",
      definitionRef: "ownership",
      entitySemantics: {
        COMPANY: { concept: "SHARE_OWNERSHIP", actionTemplateId: "DISCLOSE_OWNER" },
      },
      refresh: { eventSourceRefs: ["EVENT_1"] },
      resolutionStrategies: [{
        strategy: "EXISTING_EVIDENCE",
        evidence: "governance_document",
        resolutionEffect: "POSITIVE_OR_NEGATIVE",
      }],
      testAssertions: ["A future reasoning assertion."],
    }],
  });
}

test("canonical JSON has fixed deterministic vectors", () => {
  assert.equal(CANONICALIZATION_ALGORITHM, "ubo-canonical-json-v1");
  assert.equal(canonicalizeJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(
    canonicalizeJson({ z: [3, { y: true, x: null }], a: "text" }),
    '{"a":"text","z":[3,{"x":null,"y":true}]}',
  );
});

test("the machine schema identity and UNRESOLVED requirement state are explicit and stable", () => {
  assert.equal(POLICY_PACK_SCHEMA_ID, "ubo-policy-pack");
  assert.equal(POLICY_PACK_SCHEMA_VERSION, "1.0");
  assert.deepEqual(Object.values(REQUIREMENT_STATE), [
    "UNRESOLVED",
    "RESOLVED",
    "GAP",
    "CONFLICT",
    "REVIEW_REQUIRED",
    "N_A",
  ]);
  assert.equal(validatePolicyPack(validPolicyPack()), true);
});

test("a valid hardened Policy Pack has a fixed hash vector", () => {
  assert.equal(
    hashPolicyPack(validPolicyPack()),
    "sha256:761f6b03ef9b3c17222627e469ad4c5cfdeb5f34391180b81857fcd3763ab741",
  );
});

test("insignificant whitespace, line endings, and object key order do not change policy identity", () => {
  const pack = validPolicyPack();
  const reordered = Object.fromEntries(Object.entries(pack).reverse());
  const prettyCrLf = JSON.stringify(reordered, null, 2).replace(/\n/g, "\r\n");
  assert.equal(hashPolicyPack(JSON.stringify(pack)), hashPolicyPack(prettyCrLf));
});

test("a material Policy Pack change changes its hash", () => {
  assert.notEqual(hashPolicyPack(validPolicyPack()), hashPolicyPack(validPolicyPack({ version: "1.0.1" })));
});

test("Policy Packs reject executable, non-data, and architecture-only tenant content", () => {
  assert.throws(() => validatePolicyPack(validPolicyPack({
    rules: [{ ruleId: "rule-1", execute: () => true }],
  })), PolicyPackValidationError);
  assert.throws(() => validatePolicyPack(validPolicyPack({ applicability: new Date() })), PolicyPackValidationError);
  assert.throws(() => validatePolicyPack(validPolicyPack({
    mvpArchitectureInvariants: { allowLegacyImports: false },
  })), PolicyPackValidationError);
  assert.throws(() => validatePolicyPack(validPolicyPack({
    runtimeContract: { inputs: ["host.form.session"] },
  })), PolicyPackValidationError);
});

test("Policy Packs pin every supported engine/schema semantic version", () => {
  for (const field of Object.keys(engineSemantics())) {
    const pack = validPolicyPack({ engineSemantics: { ...engineSemantics(), [field]: "unsupported-v9" } });
    assert.throws(() => validatePolicyPack(pack), (error) => {
      assert.equal(error.code, "UNSUPPORTED_POLICY_SEMANTICS_VERSION");
      return true;
    });
  }
  assert.throws(() => validatePolicyPack(validPolicyPack({ schemaId: "other-schema" })));
  assert.throws(() => validatePolicyPack(validPolicyPack({ schemaVersion: "2.0" })));
});

test("self-contained requirement references validate across all approved catalogues", () => {
  assert.equal(validatePolicyPack(referencedPolicyPack()), true);

  const mutations = [
    (pack) => { pack.requirements[0].thresholdRef = "missing_parameter"; },
    (pack) => { pack.requirements[0].definitionRef = "missing_definition"; },
    (pack) => { pack.requirements[0].resolutionStrategies[0].evidence = "missing_evidence"; },
    (pack) => { pack.requirements[0].entitySemantics.COMPANY.actionTemplateId = "MISSING_ACTION"; },
    (pack) => { pack.requirements[0].ruleIds = ["missing_rule"]; },
    (pack) => { pack.requirements[0].refresh.eventSourceRefs = ["MISSING_EVENT"]; },
    (pack) => { pack.requirements[0].entitySemantics.COMPANY.concept = "UNKNOWN_CONCEPT"; },
    (pack) => { pack.entityProfiles.company.primaryGovernanceDocuments = ["missing_evidence"]; },
    (pack) => { pack.requirements[0].applicability.condition = "facts.share >= params.missing_parameter"; },
    (pack) => { pack.requirements[0].resolutionStrategies[0].strategy = "COMPANIES_HOUSE"; },
    (pack) => { pack.requirements[0].resolutionStrategies[0].resolutionEffect = "AUTHORITATIVE"; },
  ];

  mutations.forEach((mutate) => {
    const pack = structuredClone(referencedPolicyPack());
    mutate(pack);
    assert.throws(() => validatePolicyPack(pack), PolicyPackValidationError);
  });
});

test("semantic action IDs preserve unresolved source content without inventing templates", () => {
  const pack = referencedPolicyPack();
  pack.actionTemplates.DISCLOSE_MISSING = {
    contentStatus: "UNRESOLVED_SOURCE_REFERENCE",
    sourceReference: "B1",
    note: "Source wording not supplied.",
  };
  pack.sourceTraceability.unresolvedActionTemplateSourceReferences.push({
    semanticId: "DISCLOSE_MISSING",
    sourceReference: "B1",
    reason: "Source wording not supplied.",
  });
  assert.equal(validatePolicyPack(pack), true);

  const invented = structuredClone(pack);
  invented.actionTemplates.DISCLOSE_MISSING.text = "Invented wording";
  assert.throws(() => validatePolicyPack(invented), PolicyPackValidationError);

  const mismatchedSource = structuredClone(pack);
  mismatchedSource.actionTemplates.DISCLOSE_MISSING.sourceReference = "B2";
  assert.throws(() => validatePolicyPack(mismatchedSource), PolicyPackValidationError);

  const positional = structuredClone(referencedPolicyPack());
  positional.actionTemplates.B1 = { contentStatus: "SUPPLIED", text: "Position-coupled" };
  assert.throws(() => validatePolicyPack(positional), PolicyPackValidationError);

  const emptySuppliedWording = structuredClone(referencedPolicyPack());
  emptySuppliedWording.actionTemplates.DISCLOSE_OWNER.text = "";
  assert.throws(() => validatePolicyPack(emptySuppliedWording), PolicyPackValidationError);
});

test("loading pins schema and policy identity, verifies a hash, clones data, and freezes the result", () => {
  const source = validPolicyPack();
  const expectedHash = hashPolicyPack(source);
  const loaded = loadPolicyPack(source, { expectedHash });

  assert.equal(loaded.identity.schemaId, POLICY_PACK_SCHEMA_ID);
  assert.equal(loaded.identity.schemaVersion, POLICY_PACK_SCHEMA_VERSION);
  assert.equal(loaded.identity.hash, expectedHash);
  assert.equal(loaded.identity.hashAlgorithm, "sha256");
  assert.equal(loaded.identity.canonicalizationAlgorithm, CANONICALIZATION_ALGORITHM);
  assert.notEqual(loaded.policyPack, source);
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded.policyPack.requirements[0]), true);

  assert.throws(
    () => loadPolicyPack(source, { expectedHash: `sha256:${"0".repeat(64)}` }),
    PolicyPackIntegrityError,
  );
});
