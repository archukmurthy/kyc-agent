"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const V16 = require("../policies/uk-corporate/1.6-rc/policy.json");
const { PERCENTAGE_VALUE_TYPE } = require("../contracts/constants");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const { GRAPH_DIMENSION, TEMPORAL_STATE } = require("../domain/ownershipGraph");
const {
  HOLDER_IDENTITY_STATE,
  JOINT_ARRANGEMENT_QUALIFIER_STATE,
  LAYER_CLOSURE_ALGORITHM,
  LAYER_CLOSURE_ASSESSMENT_VERSION,
  LAYER_CLOSURE_ERROR_CODE,
  LAYER_CLOSURE_STATE,
  assessLayerClosureV1,
} = require("../policy/layerClosureV1");
const {
  PERCENTAGE_PRECISION_ASSESSMENT_VERSION,
  PERCENTAGE_PRECISION_STATE,
  assessPercentagePrecisionV1,
} = require("../policy/percentagePrecisionV1");
const { loadPolicyPack } = require("../policy/policyPack");
const { canonicalizeJson } = require("../policy/canonicalJson");

const TARGET = "entity-target";
const GRAPH_VERSION = `ubo-graph-v1:${"6".repeat(64)}`;
const POLICY = loadPolicyPack(V16);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exact(value) {
  return { type: PERCENTAGE_VALUE_TYPE.EXACT, value: String(value) };
}

function range(lowerBound, upperBound, lowerInclusive = true, upperInclusive = true) {
  return {
    type: PERCENTAGE_VALUE_TYPE.RANGE,
    lowerBound: String(lowerBound),
    upperBound: String(upperBound),
    lowerInclusive,
    upperInclusive,
  };
}

function unknown(reason = "not established") {
  return { type: PERCENTAGE_VALUE_TYPE.UNKNOWN, reason };
}

function target(profile = "COMPANY") {
  return {
    entityId: TARGET,
    category: CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY,
    entityTypeMetadata: { sourceEntityType: profile },
  };
}

function holding(id, measurement, {
  profile = "COMPANY",
  dimension = GRAPH_DIMENSION.ECONOMIC,
  holderEntityId = `holder-${id}`,
  holderIdentityState = HOLDER_IDENTITY_STATE.IDENTIFIED,
  interestBasis = dimension === GRAPH_DIMENSION.VOTING ? "VOTING_RIGHTS"
    : profile === "LLP" ? "LLP_SURPLUS_ASSET_RIGHTS" : "COMPANY_SHARE_OWNERSHIP",
  denominatorRef = dimension === GRAPH_DIMENSION.VOTING ? "total-votes" : "total-equity",
  interestClassRef = dimension === GRAPH_DIMENSION.VOTING ? "all-votes" : "ordinary-equity",
  targetRightId = `right-${id}`,
  interestSlotId = `slot-${id}`,
  temporalState = TEMPORAL_STATE.CURRENT,
  attributedCopyOfRightId,
  operativeClaimReferences = [`claim-${id}`],
  evidenceReferences = [{ system: "test", referenceType: "REGISTER", referenceId: `evidence-${id}` }],
} = {}) {
  return {
    relationshipId: `relationship-${id}`,
    holderEntityId,
    targetEntityId: TARGET,
    holderIdentityState,
    targetEntityProfile: profile,
    dimension,
    interestBasis,
    denominatorRef,
    interestClassRef,
    targetRightId,
    interestSlotId,
    measurement,
    temporalState,
    operativeClaimReferences,
    evidenceReferences,
    ...(attributedCopyOfRightId === undefined ? {} : { attributedCopyOfRightId }),
  };
}

function contexts(dimension = GRAPH_DIMENSION.ECONOMIC, overrides = {}) {
  return {
    denominatorContext: {
      state: "COMPATIBLE",
      denominatorRef: dimension === GRAPH_DIMENSION.VOTING ? "total-votes" : "total-equity",
      references: ["denominator-proof"],
      ...(overrides.denominatorContext || {}),
    },
    shareClassContext: {
      state: dimension === GRAPH_DIMENSION.ECONOMIC ? "SUFFICIENT" : "NOT_APPLICABLE",
      references: ["class-proof"],
      ...(overrides.shareClassContext || {}),
    },
    conflictContext: { state: "NONE", references: [], ...(overrides.conflictContext || {}) },
    jointArrangementContext: {
      state: JOINT_ARRANGEMENT_QUALIFIER_STATE.NO_RELEVANT_SIGNAL,
      material: true,
      references: [],
      ...(overrides.jointArrangementContext || {}),
    },
  };
}

function policyWith({ statutoryComparator = ">", firmEnabled = false, firmValue = null, firmComparator = null } = {}) {
  const raw = clone(V16);
  raw.policyPackId = `TEST-WAVE-6-${statutoryComparator}-${firmEnabled}-${firmValue}-${firmComparator}`;
  raw.version = "test-wave-6";
  raw.statutoryThresholds.economic.comparator = statutoryComparator;
  raw.statutoryThresholds.voting.comparator = statutoryComparator;
  raw.firmCollectionThreshold.enabled = firmEnabled;
  raw.firmCollectionThreshold.value = firmValue;
  raw.firmCollectionThreshold.comparator = firmComparator;
  return loadPolicyPack(raw);
}

function malformedFirmPolicy() {
  const raw = clone(V16);
  raw.policyPackId = "TEST-WAVE-6-MALFORMED-FIRM";
  raw.version = "test-wave-6-malformed-firm";
  raw.firmCollectionThreshold = {
    ...raw.firmCollectionThreshold,
    enabled: true,
    value: "ten",
    comparator: ">=",
  };
  return {
    policyPack: raw,
    identity: {
      schemaId: raw.schemaId,
      schemaVersion: raw.schemaVersion,
      policyPackId: raw.policyPackId,
      version: raw.version,
      hash: `sha256:${createHash("sha256").update(canonicalizeJson(raw), "utf8").digest("hex")}`,
    },
  };
}

function assess(directHoldings, {
  profile = "COMPANY",
  dimension = GRAPH_DIMENSION.ECONOMIC,
  policyPack = POLICY,
  contextOverrides = {},
  extra = {},
} = {}) {
  return assessLayerClosureV1({
    policyPack,
    targetEntity: target(profile),
    dimension,
    directHoldings,
    ...contexts(dimension, contextOverrides),
    caseRevision: { caseId: "case-wave-6", revision: 6, revisionId: "revision-wave-6" },
    graphVersion: GRAPH_VERSION,
    evaluationTime: "2026-09-04T12:00:00.000Z",
    ...extra,
  });
}

function qualifier(result, id) {
  return result.qualifiers.find(({ qualifierId }) => qualifierId === id);
}

test("statutory >25 closure follows the required exact and endpoint truth table", () => {
  const cases = [
    [range(75, 100, false, true), LAYER_CLOSURE_STATE.CLOSED, range(0, 25, true, false)],
    [range(75, 100, true, true), LAYER_CLOSURE_STATE.CLOSED, range(0, 25, true, true)],
    [exact(75), LAYER_CLOSURE_STATE.CLOSED, exact(25)],
    [exact(74), LAYER_CLOSURE_STATE.OPEN, exact(26)],
  ];
  for (const [measurement, expected, residual] of cases) {
    const result = assess([holding("one", measurement)]);
    assert.equal(result.statutoryClosure.state, expected);
    assert.deepEqual(result.residualInterval, residual);
    assert.equal(result.statutoryClosure.threshold.comparator, ">");
  }
  assert.equal(assess([holding("a", exact(40)), holding("b", exact(35))]).statutoryClosure.state, LAYER_CLOSURE_STATE.CLOSED);
});

test(">=25 closure respects residual endpoint attainability", () => {
  const policyPack = policyWith({ statutoryComparator: ">=" });
  const cases = [
    [range(75, 100, false, true), LAYER_CLOSURE_STATE.CLOSED],
    [range(75, 100, true, true), LAYER_CLOSURE_STATE.OPEN],
    [range(76, 100, true, true), LAYER_CLOSURE_STATE.CLOSED],
    [exact(75), LAYER_CLOSURE_STATE.OPEN],
    [exact(75.01), LAYER_CLOSURE_STATE.CLOSED],
  ];
  for (const [measurement, expected] of cases) {
    assert.equal(assess([holding("one", measurement)], { policyPack }).statutoryClosure.state, expected);
  }
});

test("statutory and enabled firm closure remain separate", () => {
  const policyPack = policyWith({ firmEnabled: true, firmValue: 10, firmComparator: ">=" });
  for (const [value, expected] of [[75, "OPEN"], [90, "OPEN"], [90.01, "CLOSED"]]) {
    const result = assess([holding("one", exact(value))], { policyPack });
    assert.equal(result.firmPolicyClosure.state, expected);
    if (value === 75) assert.equal(result.statutoryClosure.state, "CLOSED");
    assert.equal(result.firmPolicyClosure.threshold.classification, "FIRM_POLICY");
    assert.equal(result.statutoryClosure.threshold.classification, "STATUTORY");
  }
  assert.equal(Object.prototype.hasOwnProperty.call(assess([holding("one", exact(75))]), "firmPolicyClosure"), false);
});

test("firm threshold safety errors do not suppress statutory closure", () => {
  const unsafe = assess([holding("one", exact(75))], {
    policyPack: policyWith({ firmEnabled: true, firmValue: 50, firmComparator: ">" }),
  });
  assert.equal(unsafe.statutoryClosure.state, "CLOSED");
  assert.equal(unsafe.firmPolicyConfigurationError.code, "UNSAFE_FIRM_COLLECTION_THRESHOLD");
  assert.equal(Object.prototype.hasOwnProperty.call(unsafe, "firmPolicyClosure"), false);

  const malformed = assess([holding("one", exact(75))], { policyPack: malformedFirmPolicy() });
  assert.equal(malformed.statutoryClosure.state, "CLOSED");
  assert.equal(malformed.firmPolicyConfigurationError.code, "MALFORMED_FIRM_COLLECTION_THRESHOLD");
});

test("multiple intervals preserve combined endpoint attainability", () => {
  const result = assess([
    holding("a", range(40, 50, false, true)),
    holding("b", range(35, 50, false, true)),
  ]);
  assert.deepEqual(result.directHoldingSumInterval, range(75, 100, false, true));
  assert.deepEqual(result.residualInterval, range(0, 25, true, false));
  assert.equal(result.statutoryClosure.state, "CLOSED");
});

test("direct-right identity deduplicates corroboration and attributed copies while distinct rights sum", () => {
  const first = holding("support-a", exact(40), { targetRightId: "right-shared", interestSlotId: "slot-shared" });
  const second = holding("support-b", exact(40), {
    targetRightId: "right-shared",
    interestSlotId: "slot-shared",
    holderEntityId: first.holderEntityId,
  });
  const deduplicated = assess([first, second]);
  assert.deepEqual(deduplicated.countedDirectRightIds, ["right-shared"]);
  assert.deepEqual(deduplicated.directHoldingSumInterval, exact(40));
  assert.equal(deduplicated.excludedDirectRights.some(({ reasonCode }) => reasonCode === "DUPLICATE_SUPPORT_FOR_SAME_DIRECT_RIGHT"), true);

  const distinct = assess([holding("a", exact(40)), holding("b", exact(35))]);
  assert.deepEqual(distinct.directHoldingSumInterval, exact(75));

  const attributedCopy = assess([
    holding("direct", exact(75), { targetRightId: "right-direct" }),
    holding("copy", exact(75), { targetRightId: "right-copy", attributedCopyOfRightId: "right-direct" }),
  ]);
  assert.deepEqual(attributedCopy.directHoldingSumInterval, exact(75));
  assert.equal(attributedCopy.excludedDirectRights.some(({ reasonCode }) => reasonCode === "ATTRIBUTED_COPY_OF_DIRECT_RIGHT"), true);
});

test("overlapping slots block closure without selecting a percentage", () => {
  const result = assess([
    holding("a", exact(40), { interestSlotId: "same-slot" }),
    holding("b", exact(35), { interestSlotId: "same-slot" }),
  ]);
  assert.equal(result.statutoryClosure.state, "INDETERMINATE");
  assert.equal(qualifier(result, "NON_OVERLAPPING_INTERESTS").state, "INDETERMINATE");
  assert.deepEqual(result.countedDirectRightIds, []);
});

test("infeasible minimum totals fail while feasible broad uppers remain unnormalised", () => {
  assert.throws(
    () => assess([holding("a", exact(60)), holding("b", exact(50))]),
    (error) => error.code === LAYER_CLOSURE_ERROR_CODE.INFEASIBLE_DIRECT_TOTAL,
  );
  assert.throws(
    () => assess([holding("a", range(60, 70, false, true)), holding("b", range(40, 50, false, true))]),
    (error) => error.code === LAYER_CLOSURE_ERROR_CODE.INFEASIBLE_DIRECT_TOTAL,
  );
  const broad = assess([holding("a", range(60, 80)), holding("b", range(20, 40))]);
  assert.deepEqual(broad.directHoldingSumInterval, range(80, 120));
  assert.deepEqual(broad.residualInterval, range(0, 20));
  assert.equal(broad.statutoryClosure.state, "CLOSED");
  assert.equal(assess([holding("all", exact(100))]).statutoryClosure.state, "CLOSED");
});

test("holder identity can block closure while residual arithmetic remains visible", () => {
  const result = assess([holding("unknown-holder", exact(80), { holderIdentityState: HOLDER_IDENTITY_STATE.UNRESOLVED })]);
  assert.equal(result.statutoryClosure.arithmeticState, "CLOSED");
  assert.equal(result.statutoryClosure.state, "INDETERMINATE");
  assert.equal(result.additionalQualifyingHolderPossible.arithmeticValue, false);
  assert.equal(result.additionalQualifyingHolderPossible.value, "unknown");
  assert.equal(qualifier(result, "HOLDERS_IDENTIFIED").reasonCode, "MATERIAL_HOLDER_IDENTITY_UNRESOLVED");
});

test("economic and voting closure are separate even for the same target", () => {
  const economic = assess([holding("economic", exact(75))]);
  const voting = assess([holding("voting", exact(50), {
    dimension: GRAPH_DIMENSION.VOTING,
    denominatorRef: "total-votes",
    interestClassRef: "all-votes",
  })], { dimension: GRAPH_DIMENSION.VOTING });
  assert.equal(economic.statutoryClosure.state, "CLOSED");
  assert.equal(voting.statutoryClosure.state, "OPEN");
  assert.deepEqual([economic.dimension, voting.dimension], ["ECONOMIC", "VOTING"]);
});

test("denominator, share-class, currentness, contradiction and joint qualifiers block independently", () => {
  const denominator = assess([holding("one", exact(80))], { contextOverrides: { denominatorContext: { state: "INCOMPATIBLE" } } });
  assert.equal(denominator.statutoryClosure.state, "INDETERMINATE");
  assert.equal(qualifier(denominator, "COMPATIBLE_DENOMINATOR").state, "INDETERMINATE");

  const shareClass = assess([holding("one", exact(80))], { contextOverrides: { shareClassContext: { state: "UNKNOWN" } } });
  assert.equal(shareClass.statutoryClosure.state, "INDETERMINATE");

  const temporal = assess([
    holding("current", exact(75)),
    holding("ceased", exact(30), {
      temporalState: TEMPORAL_STATE.CEASED,
      holderIdentityState: HOLDER_IDENTITY_STATE.UNRESOLVED,
      denominatorRef: "historical-denominator",
    }),
  ]);
  assert.deepEqual(temporal.directHoldingSumInterval, exact(75));
  assert.equal(temporal.statutoryClosure.state, "CLOSED");
  const unknownCurrentness = assess([
    holding("current", exact(75)),
    holding("unknown", exact(10), { temporalState: TEMPORAL_STATE.UNKNOWN }),
  ]);
  assert.equal(unknownCurrentness.statutoryClosure.state, "INDETERMINATE");

  const conflict = assess([holding("one", exact(80))], { contextOverrides: { conflictContext: { state: "UNRESOLVED_MATERIAL", references: ["conflict-1"] } } });
  assert.equal(conflict.statutoryClosure.state, "INDETERMINATE");
  const interpretiveConflict = assess([holding("one", exact(80))], { contextOverrides: { conflictContext: { state: "REVIEW_REQUIRED", references: ["conflict-2"] } } });
  assert.equal(interpretiveConflict.statutoryClosure.state, "REVIEW_REQUIRED");

  const joint = assess([holding("one", exact(80))], { contextOverrides: { jointArrangementContext: { state: "POSITIVE_SIGNAL", references: ["joint-1"] } } });
  assert.equal(joint.statutoryClosure.state, "REVIEW_REQUIRED");
  assert.deepEqual(joint.governance.requiredSignoffIds, ["A-13"]);
});

test("percentage patterns never infer a joint arrangement", () => {
  const result = assess([holding("a", exact(40)), holding("b", exact(35))]);
  assert.equal(qualifier(result, "NO_OPEN_RELEVANT_JOINT_ARRANGEMENT").reasonCode, "CALLER_REPORTS_NO_RELEVANT_JOINT_SIGNAL");
  assert.deepEqual(result.governance.requiredSignoffIds, []);
  const omitted = assessLayerClosureV1({
    policyPack: POLICY,
    targetEntity: target(),
    dimension: GRAPH_DIMENSION.ECONOMIC,
    directHoldings: [holding("a", exact(40)), holding("b", exact(35))],
    denominatorContext: contexts().denominatorContext,
    shareClassContext: contexts().shareClassContext,
    conflictContext: contexts().conflictContext,
  });
  assert.equal(omitted.statutoryClosure.state, "INDETERMINATE");
  assert.deepEqual(omitted.governance.requiredSignoffIds, ["A-13"]);
});

test("unsupported profiles and cross-profile economic semantics fail closed", () => {
  assert.throws(
    () => assess([holding("one", exact(80), { profile: "TRUST" })], { profile: "TRUST" }),
    (error) => error.code === LAYER_CLOSURE_ERROR_CODE.UNSUPPORTED_TARGET_PROFILE && error.details.disposition === "REVIEW_SPECIALIST_PROFILE",
  );
  assert.throws(
    () => assess([holding("wrong", exact(80), { profile: "LLP", interestBasis: "COMPANY_SHARE_OWNERSHIP" })], { profile: "LLP" }),
    (error) => error.code === LAYER_CLOSURE_ERROR_CODE.INCOMPATIBLE_HOLDING_SEMANTICS,
  );
});

test("unknown percentages block arithmetic closure without inventing an exactness route", () => {
  const result = assess([holding("unknown", unknown())]);
  assert.equal(result.statutoryClosure.state, "INDETERMINATE");
  assert.equal(result.exactnessNeededForDetermination.state, PERCENTAGE_PRECISION_STATE.NOT_APPLICABLE);
  assert.equal(qualifier(result, "PERCENTAGE_VALUES_ESTABLISHED").state, "INDETERMINATE");
});

test("decision-sensitive precision distinguishes threshold, closure and non-percentage blockers", () => {
  const above = assessPercentagePrecisionV1({ value: range(25, 50, false, true), threshold: { value: 25, comparator: ">", classification: "STATUTORY" } });
  const below = assessPercentagePrecisionV1({ value: range(10, 25), threshold: { value: 25, comparator: ">", classification: "STATUTORY" } });
  const straddling = assessPercentagePrecisionV1({ value: range(25, 50), threshold: { value: 25, comparator: ">", classification: "STATUTORY" } });
  assert.equal(above.state, "NOT_REQUIRED");
  assert.equal(below.state, "NOT_REQUIRED");
  assert.equal(straddling.state, "REQUIRED_FOR_THRESHOLD_DETERMINATION");

  const closureSensitive = assess([holding("range", range(70, 80))]);
  assert.equal(closureSensitive.exactnessNeededForDetermination.state, "REQUIRED_FOR_LAYER_CLOSURE");
  const definitelyOpen = assess([holding("range", range(20, 40))]);
  assert.equal(definitelyOpen.exactnessNeededForDetermination.state, "NOT_REQUIRED");
  const blocked = assess([holding("range", range(70, 80), { holderIdentityState: "UNRESOLVED" })]);
  assert.equal(blocked.exactnessNeededForDetermination.state, "BLOCKED_BY_NON_PERCENTAGE_FACT");
  assert.equal(blocked.exactnessNeededForDetermination.blockers.includes("HOLDERS_IDENTIFIED"), true);
  const threshold = { value: 25, comparator: ">", classification: "STATUTORY" };
  assert.equal(assessPercentagePrecisionV1({ value: unknown(), threshold }).state, "NOT_APPLICABLE");
  assert.throws(() => assessPercentagePrecisionV1({ value: exact(101), threshold }), /outside the percentage domain/);
  assert.throws(
    () => assessPercentagePrecisionV1({ value: { type: "RANGE", lowerBound: "10", upperBound: "20" }, threshold }),
    /endpoint inclusivity/,
  );
});

test("layer closure and precision identities are immutable, deterministic and ignore display labels", () => {
  const rights = [holding("a", range(40, 50)), holding("b", range(35, 45))];
  const first = assess(rights);
  const reversed = assess([...rights].reverse().map((item) => ({ ...item, displayLabel: "ignored label" })));
  assert.equal(first.assessmentContractVersion, LAYER_CLOSURE_ASSESSMENT_VERSION);
  assert.equal(first.algorithmVersion, LAYER_CLOSURE_ALGORITHM);
  assert.equal(first.assessmentId, reversed.assessmentId);
  const recordingMetadata = assess(rights, {
    contextOverrides: {
      denominatorContext: { displayLabel: "ignored denominator label" },
      shareClassContext: { displayLabel: "ignored class label" },
    },
    extra: { caseRevision: { caseId: "case-wave-6", revision: 6, revisionId: "revision-wave-6", recordedAt: "ignored" } },
  });
  assert.equal(first.assessmentId, recordingMetadata.assessmentId);
  const changedEvidence = assess([{ ...rights[0], evidenceReferences: [{ system: "test", referenceType: "REGISTER", referenceId: "changed-evidence" }] }, rights[1]]);
  assert.notEqual(first.assessmentId, changedEvidence.assessmentId);
  assert.equal(first.exactnessNeededForDetermination.assessmentContractVersion, PERCENTAGE_PRECISION_ASSESSMENT_VERSION);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "qualifies"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "informationNeeds"), false);
});

test("Wave 6 closure and precision remain private and isolated from runtime and providers", () => {
  const sources = ["layerClosureV1.js", "percentagePrecisionV1.js"]
    .map((name) => fs.readFileSync(path.join(__dirname, "..", "policy", name), "utf8"));
  const publicEntry = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  for (const source of sources) {
    [/companies\s*house/i, /legacy[-/]discovery/i, /\bfetch\s*\(/, /DecisionApplication/, /InformationNeed/, /ResolutionPlanner/, /calculateEffectivePercentage/]
      .forEach((pattern) => assert.doesNotMatch(source, pattern));
  }
  assert.doesNotMatch(publicEntry, /layerClosureV1|assessLayerClosureV1|percentagePrecisionV1|assessPercentagePrecisionV1/);
});
