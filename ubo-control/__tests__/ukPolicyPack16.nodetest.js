"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  DECISION_APPLICATION_CONTRACT_VERSION,
  DECISION_APPLICATION_CONTRACT_VERSION_V2,
  UBO_POLICY_READINESS,
  UBO_POLICY_RUNTIME_MODE,
  assessUboPolicyPackReadiness,
  createUboDecisionApplication,
  hashPolicyPack,
  loadPolicyPack,
  validatePolicyPack,
} = require("..");
const { fixtureCatalogue, startFixture } = require("../../ubo-control-lab/server/labEngine");

const V13 = require("../policies/uk-corporate/1.3-rc/policy.json");
const V14 = require("../policies/uk-corporate/1.4-rc/policy.json");
const V15 = require("../policies/uk-corporate/1.5-rc/policy.json");
const V16 = require("../policies/uk-corporate/1.6-rc/policy.json");
const ASSERTION_PLAN = require("../policies/uk-corporate/1.6-rc/test-assertion-plan.json");

const ROOT = path.resolve(__dirname, "../..");
const POLICY_DIRECTORY = path.join(ROOT, "ubo-control/policies/uk-corporate/1.6-rc");
const V15_PATH = path.join(ROOT, "ubo-control/policies/uk-corporate/1.5-rc/policy.json");
const FILE_07_PATH = path.join(ROOT, "ubo-control/docs/freeze/uk-mvp-v1.0/07-UBO-CHARACTERIZATION-AND-TEST-PLAN-v1.md");
const EXPECTED_V15_CANONICAL_HASH = "sha256:724c2fa4820e02daddc24e652b50748646d87017cbfa632c062bc9e27de4b790";
const EXPECTED_V15_BYTE_HASH = "17fb18e1f9e26cc4d9e42695dc674bcc6f96b5431f0c6a77910b66e9c982ad67";
const EXPECTED_V16_CANONICAL_HASH = "sha256:6f4235ca32b961868f294b862810d101516a35a5ce8fe8a031ec2d2166e6e969";
const EVALUATION_TIME = "2026-09-03T12:00:00.000Z";

function readiness(runtimeMode, extra = {}) {
  return assessUboPolicyPackReadiness({ policyPack: V16, runtimeMode, evaluationTime: EVALUATION_TIME, ...extra });
}

function signoffStatusMap() {
  return Object.fromEntries(V16.signoffs.map(({ signoffId, status }) => [signoffId, status]));
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(target);
    return [target];
  });
}

test("UK Corporate 1.6-RC is an immutable schema-1.3 review-policy artifact", () => {
  assert.equal(fs.existsSync(path.join(POLICY_DIRECTORY, "policy.json")), true);
  assert.equal(fs.existsSync(path.join(POLICY_DIRECTORY, "SOURCE_MAPPING.md")), true);
  assert.equal(fs.existsSync(path.join(POLICY_DIRECTORY, "test-assertion-plan.json")), true);
  assert.equal(validatePolicyPack(V16), true);
  assert.deepEqual({
    policyPackId: V16.policyPackId,
    version: V16.version,
    schemaVersion: V16.schemaVersion,
    status: V16.status,
    supersedes: V16.supersedes,
    effectiveFrom: V16.effectivePeriod.from,
    approvedBy: V16.sourceTraceability.approvedBy,
  }, {
    policyPackId: "UBO-UK-CORPORATE",
    version: "1.6-RC",
    schemaVersion: "1.3",
    status: "CONTROL_ROOM_REVIEW",
    supersedes: "1.5-RC",
    effectiveFrom: null,
    approvedBy: null,
  });
  assert.equal(hashPolicyPack(V16), EXPECTED_V16_CANONICAL_HASH);
  assert.equal(loadPolicyPack(V16, { expectedHash: EXPECTED_V16_CANONICAL_HASH }).identity.hash, EXPECTED_V16_CANONICAL_HASH);
  assert.match(fs.readFileSync(path.join(POLICY_DIRECTORY, "SOURCE_MAPPING.md"), "utf8"), new RegExp(EXPECTED_V16_CANONICAL_HASH));
});

test("historical policy schemas and the v1.5 source and canonical identity remain unchanged", () => {
  [V13, V14, V15].forEach((policy) => assert.equal(validatePolicyPack(policy), true));
  assert.equal(hashPolicyPack(V15), EXPECTED_V15_CANONICAL_HASH);
  assert.equal(createHash("sha256").update(fs.readFileSync(V15_PATH)).digest("hex"), EXPECTED_V15_BYTE_HASH);
});

test("A-01 through A-18 exist exactly once with the accepted statuses and no approval", () => {
  const ids = V16.signoffs.map(({ signoffId }) => signoffId);
  assert.deepEqual(ids, Array.from({ length: 18 }, (_, index) => `A-${String(index + 1).padStart(2, "0")}`));
  assert.equal(new Set(ids).size, 18);
  assert.deepEqual(signoffStatusMap(), {
    "A-01": "DEFERRED",
    "A-02": "OPEN",
    "A-03": "OPEN",
    "A-04": "OPEN",
    "A-05": "OPEN",
    "A-06": "RESEARCH_COMPLETE_SIGNOFF_PENDING",
    "A-07": "RESEARCH_COMPLETE_SIGNOFF_PENDING",
    "A-08": "RESEARCH_COMPLETE_SIGNOFF_PENDING",
    "A-09": "RESEARCH_COMPLETE_SIGNOFF_PENDING",
    "A-10": "OPEN",
    "A-11": "OPEN",
    "A-12": "RESEARCH_COMPLETE_SIGNOFF_PENDING",
    "A-13": "OPEN",
    "A-14": "OPEN",
    "A-15": "OPEN",
    "A-16": "OPEN",
    "A-17": "OPEN",
    "A-18": "DEFERRED",
  });
  assert.equal(V16.signoffs.some(({ status }) => status === "APPROVED"), false);
  assert.equal(V16.signoffs.some(({ approver, approvedAt }) => approver || approvedAt), false);
  assert.deepEqual(V16.productionReadiness.mandatorySignoffIds, ["A-08", "A-09", "A-10", "A-11"]);
});

test("feature defaults preserve every sign-off dependency without enabling deferred features", () => {
  const features = Object.fromEntries(V16.productionReadiness.features.map((feature) => [feature.featureId, feature]));
  assert.deepEqual(features.LLP_PSC_ATTRIBUTION, { featureId: "LLP_PSC_ATTRIBUTION", enabled: false, requiredSignoffIds: ["A-06", "A-09"] });
  assert.deepEqual(features.INTERMEDIATE_LISTED_PARENT_TERMINUS, { featureId: "INTERMEDIATE_LISTED_PARENT_TERMINUS", enabled: false, requiredSignoffIds: ["A-01"] });
  assert.deepEqual(features.FIRM_LAYER_HOLDER_COLLECTION, { featureId: "FIRM_LAYER_HOLDER_COLLECTION", enabled: false, requiredSignoffIds: ["A-18"] });
  assert.deepEqual(features.RESIDUAL_CONFIRMATION_BUNDLE.requiredSignoffIds, ["A-02", "A-17"]);
  assert.deepEqual(features.NUMERIC_CUSTOMER_CONTROL_QUESTIONS.requiredSignoffIds, ["A-04", "A-17"]);
  assert.equal(features.CUSTOMER_LISTED_ROUTE.enabled, true);
  assert.deepEqual(features.CUSTOMER_LISTED_ROUTE.requiredSignoffIds, ["A-14"]);
  const blockedIds = readiness(UBO_POLICY_RUNTIME_MODE.PRODUCTION).blockingReasons
    .find(({ code }) => code === "REQUIRED_SIGNOFF_NOT_APPROVED").signoffIds;
  assert.equal(blockedIds.includes("A-01"), false);
  assert.equal(blockedIds.includes("A-18"), false);
});

test("v1.6-RC is review-only in Lab, blocked in production and cannot currently return READY", () => {
  const lab = readiness(UBO_POLICY_RUNTIME_MODE.LAB);
  const production = readiness(UBO_POLICY_RUNTIME_MODE.PRODUCTION);
  const historical = readiness(UBO_POLICY_RUNTIME_MODE.HISTORICAL_RECONSTRUCTION, {
    pinnedPolicyIdentity: {
      schemaId: V16.schemaId,
      schemaVersion: V16.schemaVersion,
      policyPackId: V16.policyPackId,
      version: V16.version,
      hash: EXPECTED_V16_CANONICAL_HASH,
    },
  });
  assert.equal(lab.readiness, UBO_POLICY_READINESS.REVIEW_ONLY);
  assert.equal(production.readiness, UBO_POLICY_READINESS.BLOCKED);
  assert.equal(historical.readiness, UBO_POLICY_READINESS.REVIEW_ONLY);
  assert.equal([lab, production, historical].some(({ readiness: state }) => state === UBO_POLICY_READINESS.READY), false);
  assert.deepEqual(lab.enabledFeatures, ["COMPANY_PSC_ATTRIBUTION", "CUSTOMER_LISTED_ROUTE"]);
  assert.deepEqual(lab.unsupportedAlgorithms, V16.productionReadiness.requiredAlgorithms
    .filter(({ algorithmId }) => !["canonicalization", "ownershipGraph", "percentageCalculation"].includes(algorithmId))
    .sort((left, right) => `${left.algorithmId}@${left.version}`.localeCompare(`${right.algorithmId}@${right.version}`)));
});

test("the frozen qualification, threshold, closure, evidence, control and phase declarations are exact", () => {
  assert.deepEqual(V16.qualificationDoctrine.routes.map(({ id }) => id), ["MANAGEMENT_CONTROL", "EFFECTIVE_INTEREST", "PSC_CONDITION_ATTRIBUTION"]);
  assert.equal(V16.qualificationDoctrine.personQualifiesWhen, "ANY_APPLICABLE_STATUTORY_ROUTE_SATISFIED");
  assert.equal(V16.qualificationDoctrine.recordAllQualifyingBases, true);
  assert.equal(V16.qualificationDoctrine.routes[1].methodStatus, "ADOPTED_INTERPRETATION");
  assert.equal(V16.qualificationDoctrine.routes[2].methodStatus, "STATUTORY_ATTRIBUTION_SEMANTICS");
  assert.deepEqual(V16.statutoryThresholds, {
    economic: { value: 25, comparator: ">", classification: "MANDATORY", legalBasis: "MLR_2017_REG_5_1_B" },
    voting: { value: 25, comparator: ">", classification: "MANDATORY", legalBasis: "MLR_2017_REG_5_1_B" },
  });
  assert.equal(V16.firmCollectionThreshold.enabled, false);
  assert.equal(V16.firmCollectionThreshold.neverProjectsStatutoryRole, true);
  assert.equal(V16.firmLayerHolderCollection.enabled, false);
  assert.deepEqual(V16.percentageEvidenceStates, ["DECLARED_EXACT", "INDEPENDENT_BAND_CORROBORATED", "EXACT_VALUE_VERIFIED"]);
  assert.equal(V16.declaredExactWithinIndependentBand.exactValueVerification, false);
  assert.equal(V16.controlActionGating.numericCustomerControlQuestions.mode, "LAST_RESORT_GATED");
  assert.equal(V16.residualConfirmationBundle.independentStatementResults, true);
  assert.equal(V16.residualConfirmationBundle.statements.length, 5);
  assert.equal(V16.listedTreatment.intermediateListedParentTerminus.enabled, false);
  assert.deepEqual(V16.structureAcquisition.allowedStrategies, ["DISCOVERY_LED", "CHART_ASSISTED", "SPECIALIST"]);
  assert.deepEqual(V16.phasedEvaluationOrder, [
    "BASE_APPLICABILITY", "CANONICAL_GRAPH_AND_DEPTH", "CALCULATIONS_AND_ATTRIBUTIONS", "QUALIFICATION",
    "DERIVED_REQUIREMENT_APPLICABILITY", "EVIDENCE_SUFFICIENCY", "INFORMATION_NEEDS",
    "RESOLUTION_PLANNING", "DECISION_SNAPSHOT",
  ]);
});

test("R01-R14 stay stable while successor intent is data only", () => {
  assert.deepEqual(V16.requirements.map(({ requirementId }) => requirementId), Array.from({ length: 14 }, (_, index) => `UBO-R${String(index + 1).padStart(2, "0")}`));
  assert.equal(V16.requirements.find(({ requirementId }) => requirementId === "UBO-R02").applicability.condition, "facts.graph_depth >= 2");
  assert.equal(V16.requirements.find(({ requirementId }) => requirementId === "UBO-R07").applicability.condition, "facts.actual_qualifying_persons_count >= 1");
  assert.match(V16.requirements.find(({ requirementId }) => requirementId === "UBO-R14").description, /cannot cure unresolved underlying requirements/);
  assert.deepEqual(V16.actionTemplates.DISCLOSE_SHARE_OWNERSHIP, V15.actionTemplates.DISCLOSE_SHARE_OWNERSHIP);
  ["CAPTURE_QUALIFYING_PERSON_IDENTITY", "DISCLOSE_TRUST_IN_CHAIN", "DISCLOSE_OTHER_SIGNIFICANT_CONTROL"].forEach((id) => {
    assert.equal(V16.actionTemplates[id].contentStatus, "UNRESOLVED_SOURCE_REFERENCE");
  });
});

test("the current Decision Applications and Lab remain pinned to v1.5 with no v1.6 public selector", () => {
  const v1 = createUboDecisionApplication({ policyPack: V15, contractVersion: DECISION_APPLICATION_CONTRACT_VERSION });
  const v2 = createUboDecisionApplication({ policyPack: V15, contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2 });
  assert.deepEqual(Object.keys(v1).sort(), ["applyDecisions", "evaluate", "intake"]);
  assert.deepEqual(Object.keys(v2).sort(), ["applyCustomerInput", "applyDecisions", "evaluate", "intake"]);
  assert.equal(fixtureCatalogue().policyReadiness.policyIdentity.version, "1.5-RC");
  assert.equal(startFixture({ fixtureId: "LAB01" }).snapshots[0].view.compliance.policyIdentity.policyVersion, "1.5-RC");
  assert.equal(Object.keys(require("..")).some((name) => /1_?6|policy.*selector/i.test(name)), false);

  const runtimeRoots = [path.join(ROOT, "ubo-control"), path.join(ROOT, "ubo-control-lab")];
  const runtimeFiles = runtimeRoots.flatMap(walkFiles).filter((file) => {
    const normalized = file.replaceAll("\\", "/");
    return /\.(js|jsx)$/.test(file)
      && !normalized.includes("/__tests__/")
      && !normalized.includes("/policies/")
      && !normalized.includes("/docs/");
  });
  const selectors = runtimeFiles.filter((file) => fs.readFileSync(file, "utf8").includes("1.6-rc"));
  assert.deepEqual(selectors, []);
});

test("opaque lifecycle codes remain unresolved, disabled and dependent on A-16", () => {
  assert.deepEqual(V16.sourceTraceability.unresolvedLifecycleEventSourceReferences.map(({ sourceReference }) => sourceReference), ["E01", "E02", "E08", "E10"]);
  assert.equal(V16.productionReadiness.features.find(({ featureId }) => featureId === "SEMANTIC_LIFECYCLE_EVENTS").enabled, false);
  assert.deepEqual(V16.productionReadiness.features.find(({ featureId }) => featureId === "SEMANTIC_LIFECYCLE_EVENTS").requiredSignoffIds, ["A-16"]);
});

test("the assertion plan covers each File 07 bullet in sections 3 through 16 exactly once", () => {
  const sourceLines = fs.readFileSync(FILE_07_PATH, "utf8").split(/\r?\n/);
  let section = 0;
  const sourceAssertions = [];
  for (const line of sourceLines) {
    const match = /^# (\d+)\./.exec(line);
    if (match) section = Number(match[1]);
    if (section >= 3 && section <= 16 && line.startsWith("- ")) sourceAssertions.push(line.slice(2).trim());
  }
  const plannedBullets = ASSERTION_PLAN.assertions.filter(({ assertionId }) => /^F07-\d{2}-\d{3}$/.test(assertionId));
  assert.equal(plannedBullets.length, sourceAssertions.length);
  assert.deepEqual(plannedBullets.map(({ assertion }) => assertion), sourceAssertions);
  assert.equal(new Set(ASSERTION_PLAN.assertions.map(({ assertionId }) => assertionId)).size, ASSERTION_PLAN.assertions.length);
  assert.equal(ASSERTION_PLAN.assertions.every(({ classification }) => ASSERTION_PLAN.classifications.includes(classification)), true);
  assert.equal(ASSERTION_PLAN.assertions.filter(({ executableNow }) => executableNow)
    .every(({ classification }) => ["SCHEMA_PROTECTED_NOW", "READINESS_PROTECTED_NOW", "EXISTING_RUNTIME_PROTECTED", "WAVE_3_QUALIFICATION_BASIS", "WAVE_4_COMPANY_ATTRIBUTION", "WAVE_5_LLP_ATTRIBUTION_WORKING_ASSUMPTION"].includes(classification)), true);
  assert.deepEqual(ASSERTION_PLAN.assertions
    .filter(({ classification, executableNow }) => classification === "WAVE_3_QUALIFICATION_BASIS" && executableNow)
    .map(({ assertionId }) => assertionId), Array.from({ length: 8 }, (_, index) => `F07-04-${String(index + 1).padStart(3, "0")}`));
  const wave4 = ASSERTION_PLAN.assertions
    .filter(({ classification, executableNow }) => classification === "WAVE_4_COMPANY_ATTRIBUTION" && executableNow);
  assert.deepEqual(wave4.map(({ assertionId }) => assertionId), Array.from({ length: 10 }, (_, index) => `F07-06-${String(index + 1).padStart(3, "0")}`));
  assert.equal(wave4.every(({ executionStatus, productionExecutable, requiredSignoffs, signoffDependencies }) => (
    executionStatus === "REVIEW_MODE_EXECUTABLE"
    && productionExecutable === false
    && JSON.stringify(requiredSignoffs) === JSON.stringify(signoffDependencies)
  )), true);
  const wave5 = ASSERTION_PLAN.assertions
    .filter(({ classification, executableNow }) => classification === "WAVE_5_LLP_ATTRIBUTION_WORKING_ASSUMPTION" && executableNow);
  assert.deepEqual(wave5.map(({ assertionId }) => assertionId), Array.from({ length: 5 }, (_, index) => `F07-06-${String(index + 14).padStart(3, "0")}`));
  assert.equal(wave5.every(({ executionStatus, productionExecutable, requiredSignoffs, signoffDependencies }) => (
    executionStatus === "REVIEW_MODE_EXECUTABLE_UNDER_WORKING_ASSUMPTION"
    && productionExecutable === false
    && requiredSignoffs.includes("A-06")
    && JSON.stringify(requiredSignoffs) === JSON.stringify(signoffDependencies)
  )), true);
  assert.equal(ASSERTION_PLAN.assertions.find(({ assertionId }) => assertionId === "F07-13-012").executableNow, false);
});

test("source mapping covers every material doctrine and R01-R14 without claiming approval", () => {
  const mapping = fs.readFileSync(path.join(POLICY_DIRECTORY, "SOURCE_MAPPING.md"), "utf8");
  [
    "Legal baseline", "Machine-readable governance", "Management-control route", "Effective-interest route",
    "PSC-condition attribution route", "Layer completeness", "Percentage evidence states", "Control action gating",
    "Residual confirmation bundle", "Customer-listed case", "Exhaustion categories/dispositions",
    "Structure acquisition", "Phased evaluation", "Successor runtime compatibility", "Lifecycle events",
  ].forEach((section) => assert.match(mapping, new RegExp(`\\| ${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`)));
  Array.from({ length: 14 }, (_, index) => `R${String(index + 1).padStart(2, "0")}`)
    .forEach((requirementId) => assert.match(mapping, new RegExp(`\\| ${requirementId} \\|`)));
  assert.match(mapping, /No Claude review, practitioner input, test result, or Control Room design freeze is represented here as legal or MLRO approval/);
});
