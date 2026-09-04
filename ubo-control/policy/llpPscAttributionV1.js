"use strict";

const { createHash } = require("node:crypto");
const { PERCENTAGE_VALUE_TYPE, RELATIONSHIP_TYPE } = require("../contracts/constants");
const { validateEvidenceReference } = require("../contracts/evidenceReference");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const {
  QUALIFICATION_ASSESSMENT_STATE,
  QUALIFICATION_CLASSIFICATION,
  QUALIFICATION_DIRECTNESS,
  QUALIFICATION_ROUTE,
  createQualificationBasisV2,
} = require("../domain/qualificationBasisV2");
const {
  addIntervals,
  capPercentageInterval,
  compare,
  decimalNumberToRational,
  intervalFromPercentageValue,
  intervalToCalculatedValue,
} = require("../domain/exactPercentage");
const { GRAPH_DIMENSION, TEMPORAL_STATE } = require("../domain/ownershipGraph");
const { UboContractError } = require("../errors");
const { assertDataOnly, assertNonEmptyString, assertPlainObject, cloneData, deepFreeze } = require("../internal/validation");
const { canonicalizeJson } = require("./canonicalJson");
const { hashPolicyPack, validatePolicyPack } = require("./policyPack");

const LLP_PSC_ATTRIBUTION_ALGORITHM = "ubo-llp-psc-attribution-v1";
const LLP_PSC_ATTRIBUTION_ASSESSMENT_VERSION = "ubo-llp-psc-attribution-assessment-v1";
const LLP_PSC_ATTRIBUTION_METHOD_STATUS = "STATUTORY_ATTRIBUTION_SEMANTICS";
const LLP_PSC_ATTRIBUTION_GOVERNANCE_STATE = "REVIEW_ONLY";
const LLP_PSC_WORKING_ASSUMPTION = "A-06-WA-01";

const LLP_PSC_CONDITION = Object.freeze({
  SURPLUS_ASSET_RIGHTS_GT_THRESHOLD: "SURPLUS_ASSET_RIGHTS_GT_THRESHOLD",
  LLP_VOTING_GT_THRESHOLD: "LLP_VOTING_GT_THRESHOLD",
  LLP_APPOINT_REMOVE_MAJORITY_OF_MANAGEMENT: "LLP_APPOINT_REMOVE_MAJORITY_OF_MANAGEMENT",
  LLP_SIGNIFICANT_INFLUENCE_OR_CONTROL: "LLP_SIGNIFICANT_INFLUENCE_OR_CONTROL",
  LLP_TRUST_OR_FIRM_CONDITION: "LLP_TRUST_OR_FIRM_CONDITION",
});

const COMPANY_PSC_CONDITION = Object.freeze({
  SHARES_GT_THRESHOLD: "SHARES_GT_THRESHOLD",
  VOTING_GT_THRESHOLD: "VOTING_GT_THRESHOLD",
  APPOINT_REMOVE_MAJORITY: "APPOINT_REMOVE_MAJORITY",
  SIGNIFICANT_INFLUENCE_OR_CONTROL: "SIGNIFICANT_INFLUENCE_OR_CONTROL",
});

const LLP_PSC_ATTRIBUTION_ERROR_CODE = Object.freeze({
  INVALID_INPUT: "INVALID_LLP_PSC_ATTRIBUTION_INPUT",
  INVALID_POLICY_PACK: "INVALID_LLP_PSC_ATTRIBUTION_POLICY_PACK",
  POLICY_IDENTITY_REQUIRED: "LLP_PSC_ATTRIBUTION_POLICY_IDENTITY_REQUIRED",
  POLICY_IDENTITY_MISMATCH: "LLP_PSC_ATTRIBUTION_POLICY_IDENTITY_MISMATCH",
  UNSUPPORTED_POLICY_SCHEMA: "UNSUPPORTED_LLP_PSC_ATTRIBUTION_POLICY_SCHEMA",
  ROUTE_NOT_DECLARED: "LLP_PSC_ATTRIBUTION_ROUTE_NOT_DECLARED",
  LLP_CONDITIONS_NOT_DECLARED: "LLP_PSC_ATTRIBUTION_CONDITIONS_NOT_DECLARED",
  UNSUPPORTED_ROUTE_METHOD: "UNSUPPORTED_LLP_PSC_ATTRIBUTION_ROUTE_METHOD",
  UNSUPPORTED_ROUTE_METHOD_STATUS: "UNSUPPORTED_LLP_PSC_ATTRIBUTION_METHOD_STATUS",
  INVALID_GRAPH: "INVALID_LLP_PSC_ATTRIBUTION_GRAPH",
  INCONSISTENT_GRAPH_REFERENCE: "INCONSISTENT_LLP_PSC_ATTRIBUTION_GRAPH_REFERENCE",
  UNSUPPORTED_TARGET_PROFILE: "UNSUPPORTED_LLP_PSC_ATTRIBUTION_TARGET_PROFILE",
  UNSUPPORTED_TARGET_RIGHT_SEMANTICS: "UNSUPPORTED_LLP_TARGET_RIGHT_SEMANTICS",
  MALFORMED_RELATIONSHIP: "MALFORMED_LLP_PSC_ATTRIBUTION_RELATIONSHIP",
  INVALID_SUPPORT_REFERENCE: "INVALID_LLP_PSC_ATTRIBUTION_SUPPORT_REFERENCE",
});

const PATH_STATE = Object.freeze({
  VALID: "VALID",
  NOT_SATISFIED: "NOT_SATISFIED",
  INDETERMINATE: "INDETERMINATE",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
});

class LlpPscAttributionError extends UboContractError {
  constructor(message, { code = LLP_PSC_ATTRIBUTION_ERROR_CODE.INVALID_INPUT, details, cause } = {}) {
    super(message, { code, cause });
    if (details !== undefined) this.details = deepFreeze(cloneData(details));
  }
}

function fail(message, code, details, cause) {
  throw new LlpPscAttributionError(message, { code, details, cause });
}

function digest(value) {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}

function canonicalSort(values) {
  return cloneData(values).sort((a, b) => canonicalizeJson(a).localeCompare(canonicalizeJson(b)));
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function uniqueData(values) {
  const sorted = canonicalSort(values || []);
  return sorted.filter((value, index) => index === 0 || canonicalizeJson(value) !== canonicalizeJson(sorted[index - 1]));
}

function profileFor(entity) {
  if (entity.category === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) return "NATURAL_PERSON";
  if (entity.category === CANONICAL_ENTITY_CATEGORY.TRUST_OR_LEGAL_ARRANGEMENT) return "TRUST";
  const profile = entity.entityTypeMetadata?.entityProfile
    || entity.entityTypeMetadata?.sourceEntityType
    || entity.entityTypeMetadata?.legalEntityProfile;
  return typeof profile === "string" && profile.trim() !== "" ? profile.trim().toUpperCase() : "UNKNOWN";
}

function validateLoadedPolicy(loaded, successorReviewComposition = false) {
  if (!loaded || typeof loaded !== "object" || !loaded.policyPack || !loaded.identity) {
    fail("LLP attribution requires a loaded schema-1.3 review Policy Pack", LLP_PSC_ATTRIBUTION_ERROR_CODE.POLICY_IDENTITY_REQUIRED);
  }
  const { policyPack, identity } = loaded;
  try {
    validatePolicyPack(policyPack);
  } catch (cause) {
    fail("LLP attribution received an invalid Policy Pack", LLP_PSC_ATTRIBUTION_ERROR_CODE.INVALID_POLICY_PACK, undefined, cause);
  }
  if (policyPack.schemaVersion !== "1.3") {
    fail("LLP attribution requires Policy Pack schema 1.3", LLP_PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_POLICY_SCHEMA);
  }
  const canonicalHash = hashPolicyPack(policyPack);
  const expected = {
    schemaId: policyPack.schemaId,
    schemaVersion: policyPack.schemaVersion,
    policyPackId: policyPack.policyPackId,
    version: policyPack.version,
    hash: canonicalHash,
  };
  if (Object.entries(expected).some(([field, value]) => identity[field] !== value)) {
    fail("loaded Policy Pack identity does not match canonical content", LLP_PSC_ATTRIBUTION_ERROR_CODE.POLICY_IDENTITY_MISMATCH);
  }
  const route = policyPack.qualificationDoctrine.routes.find(({ id }) => id === QUALIFICATION_ROUTE.PSC_CONDITION_ATTRIBUTION);
  if (!route) fail("Policy Pack does not declare PSC condition attribution", LLP_PSC_ATTRIBUTION_ERROR_CODE.ROUTE_NOT_DECLARED);
  if (!successorReviewComposition && route.method !== LLP_PSC_ATTRIBUTION_ALGORITHM) {
    fail(`LLP attribution route method must equal ${LLP_PSC_ATTRIBUTION_ALGORITHM}`, LLP_PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_ROUTE_METHOD);
  }
  if (!successorReviewComposition && route.methodStatus !== LLP_PSC_ATTRIBUTION_METHOD_STATUS) {
    fail(`LLP attribution methodStatus must equal ${LLP_PSC_ATTRIBUTION_METHOD_STATUS}`, LLP_PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_ROUTE_METHOD_STATUS);
  }
  const declaredConditions = new Set(route.conditions || []);
  const missingConditions = Object.values(LLP_PSC_CONDITION).filter((condition) => !declaredConditions.has(condition));
  if (!successorReviewComposition && missingConditions.length > 0) {
    fail("Policy Pack does not declare the complete LLP condition set", LLP_PSC_ATTRIBUTION_ERROR_CODE.LLP_CONDITIONS_NOT_DECLARED, { missingConditions });
  }
  return {
    policyPack,
    route,
    policyIdentity: {
      policyPackId: policyPack.policyPackId,
      version: policyPack.version,
      schemaVersion: policyPack.schemaVersion,
      canonicalHash,
    },
  };
}

function validateGraph(graph) {
  try {
    assertPlainObject(graph, "ownershipGraph");
    assertDataOnly(graph, "ownershipGraph");
    assertNonEmptyString(graph.graphVersion, "ownershipGraph.graphVersion");
    if (!/^ubo-graph-v1:[a-f0-9]{64}$/.test(graph.graphVersion)) fail("invalid graph fingerprint", LLP_PSC_ATTRIBUTION_ERROR_CODE.INVALID_GRAPH);
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.relationships)) fail("graph nodes and relationships are required", LLP_PSC_ATTRIBUTION_ERROR_CODE.INVALID_GRAPH);
    const nodeIds = new Set(graph.nodes.map(({ entityId }) => entityId));
    if (nodeIds.size !== graph.nodes.length) fail("duplicate graph node", LLP_PSC_ATTRIBUTION_ERROR_CODE.INVALID_GRAPH);
    const relationshipIds = new Set();
    graph.relationships.forEach((relationship, index) => {
      assertPlainObject(relationship, `ownershipGraph.relationships[${index}]`);
      ["relationshipId", "subjectEntityId", "objectEntityId", "relationshipType", "temporalState"]
        .forEach((field) => assertNonEmptyString(relationship[field], `ownershipGraph.relationships[${index}].${field}`));
      if (!nodeIds.has(relationship.subjectEntityId) || !nodeIds.has(relationship.objectEntityId)) fail("relationship references a missing node", LLP_PSC_ATTRIBUTION_ERROR_CODE.MALFORMED_RELATIONSHIP);
      if (relationshipIds.has(relationship.relationshipId)) fail("duplicate relationship ID", LLP_PSC_ATTRIBUTION_ERROR_CODE.MALFORMED_RELATIONSHIP);
      relationshipIds.add(relationship.relationshipId);
      if (!Object.values(TEMPORAL_STATE).includes(relationship.temporalState)) fail("invalid relationship temporal state", LLP_PSC_ATTRIBUTION_ERROR_CODE.MALFORMED_RELATIONSHIP);
      if (!Array.isArray(relationship.supportingClaimIds)) fail("supportingClaimIds must be an array", LLP_PSC_ATTRIBUTION_ERROR_CODE.MALFORMED_RELATIONSHIP);
      relationship.supportingClaimIds.forEach((claimId, claimIndex) => assertNonEmptyString(claimId, `supportingClaimIds[${claimIndex}]`));
    });
  } catch (error) {
    if (error instanceof LlpPscAttributionError) throw error;
    fail(error.message, LLP_PSC_ATTRIBUTION_ERROR_CODE.INVALID_GRAPH, undefined, error);
  }
}

function validateEntities(entities, graph) {
  if (!Array.isArray(entities)) fail("canonicalEntities must be an array", LLP_PSC_ATTRIBUTION_ERROR_CODE.INVALID_INPUT);
  const byId = new Map();
  entities.forEach((entity, index) => {
    assertPlainObject(entity, `canonicalEntities[${index}]`);
    assertNonEmptyString(entity.entityId, `canonicalEntities[${index}].entityId`);
    assertNonEmptyString(entity.category, `canonicalEntities[${index}].category`);
    if (byId.has(entity.entityId)) fail(`duplicate canonical entity ${entity.entityId}`, LLP_PSC_ATTRIBUTION_ERROR_CODE.INVALID_INPUT);
    byId.set(entity.entityId, entity);
  });
  graph.nodes.forEach((node) => {
    if (!byId.has(node.entityId) || byId.get(node.entityId).category !== node.category) {
      fail(`canonical entity ${node.entityId} does not match graph`, LLP_PSC_ATTRIBUTION_ERROR_CODE.INCONSISTENT_GRAPH_REFERENCE);
    }
  });
  return byId;
}

function validateSupport(claimSupport, graph) {
  if (!Array.isArray(claimSupport)) fail("claimSupport must be an array", LLP_PSC_ATTRIBUTION_ERROR_CODE.INVALID_SUPPORT_REFERENCE);
  const operative = new Set(graph.relationships.flatMap(({ supportingClaimIds }) => supportingClaimIds));
  const byId = new Map();
  claimSupport.forEach((item, index) => {
    assertPlainObject(item, `claimSupport[${index}]`);
    assertNonEmptyString(item.claimId, `claimSupport[${index}].claimId`);
    if (!operative.has(item.claimId) || byId.has(item.claimId) || !Array.isArray(item.evidenceReferences)) {
      fail("claimSupport must uniquely reference an operative claim", LLP_PSC_ATTRIBUTION_ERROR_CODE.INVALID_SUPPORT_REFERENCE);
    }
    item.evidenceReferences.forEach((reference, referenceIndex) => validateEvidenceReference(reference, `claimSupport[${index}].evidenceReferences[${referenceIndex}]`));
    byId.set(item.claimId, cloneData(item.evidenceReferences));
  });
  return byId;
}

function caseReferenceFor(caseRevision, graph) {
  const graphCase = graph.sourceCase;
  if (caseRevision === undefined) return graphCase === undefined ? undefined : cloneData(graphCase);
  const supplied = Number.isSafeInteger(caseRevision) ? { revision: caseRevision } : cloneData(caseRevision);
  assertPlainObject(supplied, "caseRevision");
  if (!Number.isSafeInteger(supplied.revision) || supplied.revision < 1) fail("case revision must be positive", LLP_PSC_ATTRIBUTION_ERROR_CODE.INVALID_INPUT);
  if (graphCase && ["caseId", "revision", "revisionId"].some((field) => supplied[field] !== undefined && supplied[field] !== graphCase[field])) {
    fail("case revision conflicts with graph", LLP_PSC_ATTRIBUTION_ERROR_CODE.INCONSISTENT_GRAPH_REFERENCE);
  }
  return supplied;
}

function percentageAssessment(value, thresholdValue, comparator, incomplete = false) {
  if (!value || value.type === PERCENTAGE_VALUE_TYPE.UNKNOWN) return { state: QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE, reasonCode: "PERCENTAGE_NOT_ESTABLISHED" };
  const interval = intervalFromPercentageValue(value);
  const threshold = decimalNumberToRational(thresholdValue);
  const lower = compare(interval.lower, threshold);
  const upper = compare(interval.upper, threshold);
  const satisfied = comparator === ">" ? lower > 0 || (lower === 0 && !interval.lowerInclusive) : lower >= 0;
  if (satisfied) return { state: QUALIFICATION_ASSESSMENT_STATE.SATISFIED, reasonCode: "PERCENTAGE_GUARANTEES_THRESHOLD" };
  if (incomplete) return { state: QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE, reasonCode: "INCOMPLETE_ATTRIBUTION_MAY_CHANGE_THRESHOLD_OUTCOME" };
  const notSatisfied = comparator === ">" ? upper <= 0 : upper < 0 || (upper === 0 && !interval.upperInclusive);
  if (notSatisfied) return { state: QUALIFICATION_ASSESSMENT_STATE.NOT_SATISFIED, reasonCode: "PERCENTAGE_DOES_NOT_SATISFY_THRESHOLD" };
  return { state: QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE, reasonCode: "PERCENTAGE_RANGE_STRADDLES_THRESHOLD" };
}

function interpretive(relationship) {
  const q = relationship.qualifiers || {};
  return q.ambiguity !== undefined || q.potential === true || q.deFacto === true || q.requiresInterpretation === true;
}

function joint(relationship) {
  const q = relationship.qualifiers || {};
  return q.jointArrangement === true || q.jointArrangementSignal === true || q.controlConcept === "JOINT_ARRANGEMENT";
}

function appointmentSemantic(relationship, controlledProfile) {
  const concept = String(relationship.qualifiers?.controlConcept || "").toUpperCase();
  if (controlledProfile === "LLP") {
    return relationship.relationshipType === RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT
      && concept === "MANAGEMENT_APPOINTMENT_RIGHTS"
      && relationship.qualifiers?.managementBody === "persons_entitled_to_participate_in_management";
  }
  return [RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT, RELATIONSHIP_TYPE.BOARD_REMOVAL_RIGHT].includes(relationship.relationshipType)
    || (relationship.relationshipType === RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT && /APPOINT|REMOVE/.test(concept));
}

function targetCondition(relationship, targetProfile) {
  const q = relationship.qualifiers || {};
  if (relationship.relationshipType === RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP) {
    if (targetProfile === "COMPANY" && q.economicInterestConcept === "SHARE_OWNERSHIP") {
      return { condition: COMPANY_PSC_CONDITION.SHARES_GT_THRESHOLD, dimension: GRAPH_DIMENSION.ECONOMIC, rightSemantic: "COMPANY_SHARE_OWNERSHIP" };
    }
    if (targetProfile === "LLP" && ["SURPLUS_ASSET_RIGHTS", "LLP_SURPLUS_ASSET_RIGHTS"].includes(q.economicInterestConcept)) {
      return { condition: LLP_PSC_CONDITION.SURPLUS_ASSET_RIGHTS_GT_THRESHOLD, dimension: GRAPH_DIMENSION.ECONOMIC, rightSemantic: "LLP_SURPLUS_ASSET_RIGHTS" };
    }
    fail("economic target right is incompatible with target entity profile", LLP_PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_TARGET_RIGHT_SEMANTICS, { relationshipId: relationship.relationshipId, targetProfile });
  }
  if (relationship.relationshipType === RELATIONSHIP_TYPE.VOTING_RIGHTS) {
    return {
      condition: targetProfile === "LLP" ? LLP_PSC_CONDITION.LLP_VOTING_GT_THRESHOLD : COMPANY_PSC_CONDITION.VOTING_GT_THRESHOLD,
      dimension: GRAPH_DIMENSION.VOTING,
      rightSemantic: targetProfile === "LLP" ? "LLP_VOTING_RIGHTS" : "COMPANY_VOTING_RIGHTS",
    };
  }
  if (appointmentSemantic(relationship, targetProfile)) {
    return {
      condition: targetProfile === "LLP" ? LLP_PSC_CONDITION.LLP_APPOINT_REMOVE_MAJORITY_OF_MANAGEMENT : COMPANY_PSC_CONDITION.APPOINT_REMOVE_MAJORITY,
      rightSemantic: targetProfile === "LLP" ? "LLP_MANAGEMENT_APPOINTMENT_REMOVAL" : "COMPANY_BOARD_APPOINTMENT_REMOVAL",
    };
  }
  if (relationship.relationshipType === RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL) {
    return {
      condition: targetProfile === "LLP" ? LLP_PSC_CONDITION.LLP_SIGNIFICANT_INFLUENCE_OR_CONTROL : COMPANY_PSC_CONDITION.SIGNIFICANT_INFLUENCE_OR_CONTROL,
      rightSemantic: targetProfile === "LLP" ? "LLP_SIGNIFICANT_INFLUENCE_OR_CONTROL" : "COMPANY_SIGNIFICANT_INFLUENCE_OR_CONTROL",
    };
  }
  return undefined;
}

function directRightState(relationship, condition) {
  if (joint(relationship)) return { state: PATH_STATE.REVIEW_REQUIRED, reasonCode: "JOINT_ARRANGEMENT_NOT_IMPLEMENTED", requiredSignoffs: ["A-13"] };
  if (relationship.temporalState === TEMPORAL_STATE.CEASED) return { state: PATH_STATE.NOT_SATISFIED, reasonCode: "TARGET_RIGHT_NOT_CURRENT", requiredSignoffs: [] };
  if (relationship.temporalState === TEMPORAL_STATE.UNKNOWN) return { state: PATH_STATE.INDETERMINATE, reasonCode: "TARGET_RIGHT_CURRENTNESS_UNKNOWN", requiredSignoffs: [] };
  if ([LLP_PSC_CONDITION.LLP_APPOINT_REMOVE_MAJORITY_OF_MANAGEMENT, COMPANY_PSC_CONDITION.APPOINT_REMOVE_MAJORITY].includes(condition)) {
    if (interpretive(relationship)) return { state: PATH_STATE.REVIEW_REQUIRED, reasonCode: "APPOINTMENT_RIGHT_REQUIRES_INTERPRETATION", requiredSignoffs: ["A-12"] };
    if (String(relationship.qualifiers?.scope || "").toUpperCase() === "MAJORITY") return { state: PATH_STATE.VALID, reasonCode: "EXPLICIT_MAJORITY_APPOINTMENT_RIGHT", requiredSignoffs: ["A-12"] };
    return { state: PATH_STATE.INDETERMINATE, reasonCode: "APPOINTMENT_MAJORITY_SCOPE_NOT_ESTABLISHED", requiredSignoffs: ["A-12"] };
  }
  if ([LLP_PSC_CONDITION.LLP_SIGNIFICANT_INFLUENCE_OR_CONTROL, COMPANY_PSC_CONDITION.SIGNIFICANT_INFLUENCE_OR_CONTROL].includes(condition)) {
    if (interpretive(relationship)) return { state: PATH_STATE.REVIEW_REQUIRED, reasonCode: "SIGNIFICANT_CONTROL_REQUIRES_INTERPRETATION", requiredSignoffs: [] };
    return { state: PATH_STATE.VALID, reasonCode: "EXPLICIT_SIGNIFICANT_CONTROL", requiredSignoffs: [] };
  }
  return { state: PATH_STATE.VALID, reasonCode: "CURRENT_TARGET_RIGHT", requiredSignoffs: [] };
}

function isPotentialStep(relationship) {
  return [
    RELATIONSHIP_TYPE.VOTING_RIGHTS,
    RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT,
    RELATIONSHIP_TYPE.BOARD_REMOVAL_RIGHT,
    RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT,
    RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL,
  ].includes(relationship.relationshipType);
}

function majorityStep(relationship, controlledEntity, controllerEntity, policyPack) {
  const controlledProfile = profileFor(controlledEntity);
  const controllerProfile = profileFor(controllerEntity);
  const base = {
    relationshipId: relationship.relationshipId,
    fromEntityId: relationship.subjectEntityId,
    toEntityId: relationship.objectEntityId,
    relationshipType: relationship.relationshipType,
    controlledEntityProfile: controlledProfile,
    controllerEntityProfile: controllerProfile,
    temporalState: relationship.temporalState,
    ...(relationship.measurement === undefined ? {} : { measurement: cloneData(relationship.measurement) }),
    ...(relationship.qualifiers === undefined ? {} : { qualifiers: cloneData(relationship.qualifiers) }),
  };
  if (joint(relationship)) return { ...base, state: PATH_STATE.REVIEW_REQUIRED, reasonCode: "JOINT_ARRANGEMENT_NOT_IMPLEMENTED", requiredSignoffs: ["A-13"] };
  if (relationship.temporalState === TEMPORAL_STATE.CEASED) return { ...base, state: PATH_STATE.NOT_SATISFIED, reasonCode: "MAJORITY_STEP_NOT_CURRENT", requiredSignoffs: [] };
  if (relationship.temporalState === TEMPORAL_STATE.UNKNOWN) return { ...base, state: PATH_STATE.INDETERMINATE, reasonCode: "MAJORITY_STEP_CURRENTNESS_UNKNOWN", requiredSignoffs: [] };
  if (relationship.relationshipType === RELATIONSHIP_TYPE.VOTING_RIGHTS) {
    const majority = percentageAssessment(relationship.measurement, 50, ">", false);
    const directLlpCondition = controlledProfile === "LLP"
      ? percentageAssessment(relationship.measurement, policyPack.statutoryThresholds.voting.value, policyPack.statutoryThresholds.voting.comparator, false)
      : undefined;
    const llpGovernanceReview = controlledProfile === "LLP"
      && majority.state === QUALIFICATION_ASSESSMENT_STATE.NOT_SATISFIED
      && directLlpCondition?.state === QUALIFICATION_ASSESSMENT_STATE.SATISFIED;
    return {
      ...base,
      state: majority.state === QUALIFICATION_ASSESSMENT_STATE.SATISFIED ? PATH_STATE.VALID : majority.state,
      reasonCode: majority.state === QUALIFICATION_ASSESSMENT_STATE.SATISFIED
        ? "STRICT_MAJORITY_VOTING_RIGHT_ESTABLISHED"
        : llpGovernanceReview ? "LLP_DIRECT_VOTING_CONDITION_IS_NOT_MAJORITY_CONTROL" : majority.reasonCode,
      llpGovernanceReview,
      requiredSignoffs: [],
    };
  }
  if (appointmentSemantic(relationship, controlledProfile)) {
    if (interpretive(relationship)) return { ...base, state: PATH_STATE.REVIEW_REQUIRED, reasonCode: "APPOINTMENT_STEP_REQUIRES_INTERPRETATION", requiredSignoffs: ["A-12"] };
    if (String(relationship.qualifiers?.scope || "").toUpperCase() === "MAJORITY") return { ...base, state: PATH_STATE.VALID, reasonCode: "EXPLICIT_MAJORITY_APPOINTMENT_STEP", requiredSignoffs: ["A-12"] };
    return { ...base, state: PATH_STATE.INDETERMINATE, reasonCode: "APPOINTMENT_MAJORITY_SCOPE_NOT_ESTABLISHED", requiredSignoffs: ["A-12"] };
  }
  return {
    ...base,
    state: PATH_STATE.INDETERMINATE,
    reasonCode: relationship.relationshipType === RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL
      ? "SIGNIFICANT_CONTROL_IS_NOT_A_MAJORITY_STEP"
      : "UNSUPPORTED_MAJORITY_STEP_SEMANTIC",
    requiredSignoffs: [],
  };
}

function combinePathState(steps, rightState) {
  if (steps.some(({ llpGovernanceReview }) => llpGovernanceReview)) return PATH_STATE.REVIEW_REQUIRED;
  const states = [...steps.map(({ state }) => state), rightState.state];
  if (states.includes(PATH_STATE.REVIEW_REQUIRED)) return PATH_STATE.REVIEW_REQUIRED;
  if (states.includes(PATH_STATE.INDETERMINATE)) return PATH_STATE.INDETERMINATE;
  if (states.includes(PATH_STATE.NOT_SATISFIED)) return PATH_STATE.NOT_SATISFIED;
  return PATH_STATE.VALID;
}

function makePath(targetRight, steps, rightState) {
  const relationshipIds = [...steps.map(({ relationshipId }) => relationshipId), targetRight.relationshipId];
  return {
    pathId: `llp-psc-path:${digest({ targetRightId: targetRight.relationshipId, relationshipIds }).slice(0, 24)}`,
    targetRightId: targetRight.relationshipId,
    state: combinePathState(steps, rightState),
    relationshipIds,
    majoritySteps: cloneData(steps),
    directness: steps.length === 0 ? QUALIFICATION_DIRECTNESS.DIRECT : QUALIFICATION_DIRECTNESS.INDIRECT,
    reasonCodes: uniqueStrings([rightState.reasonCode, ...steps.map(({ reasonCode }) => reasonCode)]),
    requiredSignoffs: uniqueStrings([...rightState.requiredSignoffs, ...steps.flatMap(({ requiredSignoffs }) => requiredSignoffs)]),
  };
}

function diagnostic(raw) {
  return { diagnosticId: `llp-psc-diagnostic:${digest(raw).slice(0, 24)}`, ...raw };
}

function enumeratePaths({ holderEntityId, targetRight, relationships, entitiesById, policyPack, diagnostics }) {
  const incoming = new Map();
  relationships.filter(isPotentialStep).forEach((relationship) => {
    if (!incoming.has(relationship.objectEntityId)) incoming.set(relationship.objectEntityId, []);
    incoming.get(relationship.objectEntityId).push(relationship);
  });
  for (const values of incoming.values()) values.sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));
  const paths = [];
  function visit(currentId, visited, stepsToHolder) {
    for (const relationship of incoming.get(currentId) || []) {
      const subject = entitiesById.get(relationship.subjectEntityId);
      const object = entitiesById.get(relationship.objectEntityId);
      if (!subject || !object) continue;
      if (visited.has(subject.entityId)) {
        diagnostics.push(diagnostic({
          code: "RELEVANT_MIXED_ATTRIBUTION_CYCLE",
          entityIds: [...visited, subject.entityId].sort(),
          relationshipIds: uniqueStrings([...stepsToHolder.map(({ relationshipId }) => relationshipId), relationship.relationshipId]),
          requiredSignoffs: ["A-06"],
        }));
        continue;
      }
      const objectProfile = profileFor(object);
      if (!["COMPANY", "LLP"].includes(objectProfile)) {
        diagnostics.push(diagnostic({ code: "UNSUPPORTED_INTERMEDIARY_PROFILE", entityId: object.entityId, entityProfile: objectProfile, relationshipId: relationship.relationshipId, requiredSignoffs: uniqueStrings(["A-06", ...(objectProfile.includes("FUND") || objectProfile.includes("PARTNERSHIP") ? ["A-05"] : [])]) }));
        continue;
      }
      const step = majorityStep(relationship, object, subject, policyPack);
      if (["SIGNIFICANT_CONTROL_IS_NOT_A_MAJORITY_STEP", "UNSUPPORTED_MAJORITY_STEP_SEMANTIC", "LLP_DIRECT_VOTING_CONDITION_IS_NOT_MAJORITY_CONTROL"].includes(step.reasonCode)) {
        diagnostics.push(diagnostic({ code: step.reasonCode, relationshipId: relationship.relationshipId, controlledEntityProfile: objectProfile, requiredSignoffs: ["A-06"] }));
      }
      if (step.reasonCode === "JOINT_ARRANGEMENT_NOT_IMPLEMENTED") diagnostics.push(diagnostic({ code: step.reasonCode, relationshipId: relationship.relationshipId, requiredSignoffs: ["A-06", "A-13"] }));
      const steps = [step, ...stepsToHolder];
      if (subject.category === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) {
        paths.push({ personEntityId: subject.entityId, path: makePath(targetRight, steps, directRightState(targetRight, targetRight.condition)) });
        continue;
      }
      const subjectProfile = profileFor(subject);
      if (!["COMPANY", "LLP"].includes(subjectProfile)) {
        diagnostics.push(diagnostic({ code: "UNSUPPORTED_INTERMEDIARY_PROFILE", entityId: subject.entityId, entityProfile: subjectProfile, relationshipId: relationship.relationshipId, requiredSignoffs: uniqueStrings(["A-06", ...(subjectProfile.includes("FUND") || subjectProfile.includes("PARTNERSHIP") ? ["A-05"] : [])]) }));
        continue;
      }
      visit(subject.entityId, new Set([...visited, subject.entityId]), steps);
    }
  }
  visit(holderEntityId, new Set([holderEntityId]), []);
  return paths.sort((a, b) => a.path.pathId.localeCompare(b.path.pathId));
}

function aggregateRights(rights) {
  const known = rights.filter(({ measurement }) => measurement && measurement.type !== PERCENTAGE_VALUE_TYPE.UNKNOWN);
  if (known.length === 0) return undefined;
  let interval = intervalFromPercentageValue(known[0].measurement);
  for (let index = 1; index < known.length; index += 1) interval = addIntervals(interval, intervalFromPercentageValue(known[index].measurement));
  return intervalToCalculatedValue(capPercentageInterval(interval));
}

function percentageCondition(condition) {
  return [
    LLP_PSC_CONDITION.SURPLUS_ASSET_RIGHTS_GT_THRESHOLD,
    LLP_PSC_CONDITION.LLP_VOTING_GT_THRESHOLD,
    COMPANY_PSC_CONDITION.SHARES_GT_THRESHOLD,
    COMPANY_PSC_CONDITION.VOTING_GT_THRESHOLD,
  ].includes(condition);
}

function economicCondition(condition) {
  return [LLP_PSC_CONDITION.SURPLUS_ASSET_RIGHTS_GT_THRESHOLD, COMPANY_PSC_CONDITION.SHARES_GT_THRESHOLD].includes(condition);
}

function assessmentFor(entry, policyPack) {
  const paths = [...entry.paths].sort((a, b) => a.pathId.localeCompare(b.pathId));
  const validIds = uniqueStrings(paths.filter(({ state }) => state === PATH_STATE.VALID).map(({ targetRightId }) => targetRightId));
  const validRights = [...entry.rights.values()].filter(({ relationshipId }) => validIds.includes(relationshipId));
  const uncertainIds = uniqueStrings(paths.filter(({ state, targetRightId }) => [PATH_STATE.INDETERMINATE, PATH_STATE.REVIEW_REQUIRED].includes(state) && !validIds.includes(targetRightId)).map(({ targetRightId }) => targetRightId));
  const hasReview = paths.some(({ state }) => state === PATH_STATE.REVIEW_REQUIRED);
  const hasIndeterminate = paths.some(({ state }) => state === PATH_STATE.INDETERMINATE);
  if (percentageCondition(entry.condition)) {
    const aggregate = aggregateRights(validRights);
    const incomplete = uncertainIds.length > 0 || validRights.some(({ measurement }) => !measurement || measurement.type === PERCENTAGE_VALUE_TYPE.UNKNOWN);
    if (aggregate === undefined) {
      if (hasReview) return { state: QUALIFICATION_ASSESSMENT_STATE.REVIEW_REQUIRED, reasonCode: "LLP_GOVERNANCE_CONTROL_EVIDENCE_REQUIRED" };
      if (hasIndeterminate || incomplete) return { state: QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE, reasonCode: "ATTRIBUTION_OR_TARGET_RIGHT_INDETERMINATE" };
      return { state: QUALIFICATION_ASSESSMENT_STATE.NOT_SATISFIED, reasonCode: "NO_QUALIFYING_MAJORITY_CHAIN" };
    }
    const threshold = policyPack.statutoryThresholds[economicCondition(entry.condition) ? "economic" : "voting"];
    const result = percentageAssessment(aggregate, threshold.value, threshold.comparator, incomplete);
    if (result.state === QUALIFICATION_ASSESSMENT_STATE.SATISFIED) return { state: result.state, reasonCode: "ATTRIBUTED_TARGET_RIGHTS_SATISFY_CONDITION", aggregate };
    if (hasReview) return { state: QUALIFICATION_ASSESSMENT_STATE.REVIEW_REQUIRED, reasonCode: "LLP_GOVERNANCE_CONTROL_EVIDENCE_REQUIRED", aggregate };
    return { state: result.state, reasonCode: result.reasonCode, aggregate };
  }
  if (validIds.length > 0) return { state: QUALIFICATION_ASSESSMENT_STATE.SATISFIED, reasonCode: "EXPLICIT_CONDITION_ATTRIBUTED" };
  if (hasReview) return { state: QUALIFICATION_ASSESSMENT_STATE.REVIEW_REQUIRED, reasonCode: "ATTRIBUTION_REQUIRES_REVIEW" };
  if (hasIndeterminate) return { state: QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE, reasonCode: "ATTRIBUTION_INDETERMINATE" };
  return { state: QUALIFICATION_ASSESSMENT_STATE.NOT_SATISFIED, reasonCode: "CONDITION_NOT_ESTABLISHED" };
}

function directness(paths) {
  const relevant = paths.filter(({ state }) => state === PATH_STATE.VALID);
  const considered = relevant.length > 0 ? relevant : paths;
  if (considered.length === 0) return QUALIFICATION_DIRECTNESS.NOT_ESTABLISHED;
  const direct = considered.some((path) => path.directness === QUALIFICATION_DIRECTNESS.DIRECT);
  const indirect = considered.some((path) => path.directness === QUALIFICATION_DIRECTNESS.INDIRECT);
  if (direct && indirect) return QUALIFICATION_DIRECTNESS.DIRECT_AND_INDIRECT;
  return direct ? QUALIFICATION_DIRECTNESS.DIRECT : QUALIFICATION_DIRECTNESS.INDIRECT;
}

function relationshipReference(relationship, support) {
  const supportingClaimIds = uniqueStrings(relationship.supportingClaimIds);
  return { relationshipId: relationship.relationshipId, supportingClaimIds, evidenceReferences: uniqueData(supportingClaimIds.flatMap((claimId) => support.get(claimId) || [])) };
}

function thresholdDescriptor(policyPack, condition) {
  const key = economicCondition(condition) ? "economic" : "voting";
  const threshold = policyPack.statutoryThresholds[key];
  return {
    value: threshold.value,
    comparator: threshold.comparator,
    classification: QUALIFICATION_CLASSIFICATION.STATUTORY,
    sourceClassification: threshold.classification,
    legalBasis: threshold.legalBasis,
    policyFieldReference: `statutoryThresholds.${key}`,
    dimension: key === "economic" ? GRAPH_DIMENSION.ECONOMIC : GRAPH_DIMENSION.VOTING,
  };
}

function makeBasis({ entry, assessment, targetProfile, route, policyPack, policyIdentity, graphReference, caseReference, relationshipsById, support }) {
  const paths = [...entry.paths].sort((a, b) => a.pathId.localeCompare(b.pathId));
  const relationshipIds = uniqueStrings(paths.flatMap(({ relationshipIds: ids }) => ids));
  const references = relationshipIds.map((id) => relationshipReference(relationshipsById.get(id), support));
  const rights = [...entry.rights.values()].sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));
  const usesCompanySemantics = targetProfile === "COMPANY" || paths.some(({ majoritySteps }) => majoritySteps.some(({ controlledEntityProfile }) => controlledEntityProfile === "COMPANY"));
  const usesAppointment = [LLP_PSC_CONDITION.LLP_APPOINT_REMOVE_MAJORITY_OF_MANAGEMENT, COMPANY_PSC_CONDITION.APPOINT_REMOVE_MAJORITY].includes(entry.condition)
    || paths.some(({ majoritySteps }) => majoritySteps.some(({ reasonCode }) => /APPOINTMENT/.test(reasonCode)));
  const requiredSignoffs = uniqueStrings([
    "A-06",
    ...(usesCompanySemantics ? ["A-09"] : []),
    ...(usesAppointment ? ["A-12"] : []),
    ...paths.flatMap(({ requiredSignoffs: ids }) => ids),
  ]);
  const dimension = percentageCondition(entry.condition) ? (economicCondition(entry.condition) ? GRAPH_DIMENSION.ECONOMIC : GRAPH_DIMENSION.VOTING) : undefined;
  const threshold = dimension ? thresholdDescriptor(policyPack, entry.condition) : undefined;
  return createQualificationBasisV2({
    ...(caseReference === undefined ? {} : { caseReference }),
    policyIdentity,
    graphReference,
    personEntityId: entry.personEntityId,
    holderCategory: CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON,
    targetEntityId: entry.targetEntityId,
    route: QUALIFICATION_ROUTE.PSC_CONDITION_ATTRIBUTION,
    classification: QUALIFICATION_CLASSIFICATION.STATUTORY,
    condition: entry.condition,
    ...(dimension === undefined ? {} : { dimension }),
    directness: directness(paths),
    method: LLP_PSC_ATTRIBUTION_ALGORITHM,
    methodStatus: LLP_PSC_ATTRIBUTION_METHOD_STATUS,
    methodVersion: LLP_PSC_ATTRIBUTION_ALGORITHM,
    workingAssumptionRef: LLP_PSC_WORKING_ASSUMPTION,
    assessmentState: assessment.state,
    reasonCode: assessment.reasonCode,
    ...(threshold === undefined ? {} : { threshold }),
    ...(assessment.aggregate === undefined ? {} : { aggregatedTargetRightValue: cloneData(assessment.aggregate) }),
    targetRightReferences: rights.map((right) => ({
      targetRightId: right.relationshipId,
      holderEntityId: right.subjectEntityId,
      targetEntityProfile: targetProfile,
      rightSemantic: right.rightSemantic,
      relationshipId: right.relationshipId,
      temporalState: right.temporalState,
      ...(right.measurement === undefined ? {} : { originalValue: cloneData(right.measurement) }),
      attributed: paths.some((path) => path.targetRightId === right.relationshipId && path.state === PATH_STATE.VALID),
    })),
    attributionChains: cloneData(paths),
    orderedPathReferences: paths.map(({ pathId, targetRightId, state, relationshipIds: ids }) => ({ pathId, targetRightId, state, relationshipIds: cloneData(ids) })),
    relationshipReferences: references,
    operativeClaimReferences: uniqueStrings(references.flatMap(({ supportingClaimIds }) => supportingClaimIds)),
    evidenceReferences: uniqueData(references.flatMap(({ evidenceReferences }) => evidenceReferences)),
    policyRequirement: { requirementId: entry.condition.includes("VOTING") ? "UBO-R04" : entry.condition.includes("APPOINT") ? "UBO-R05" : entry.condition.includes("INFLUENCE") ? "UBO-R06" : "UBO-R01", routeReference: "qualificationDoctrine.routes.PSC_CONDITION_ATTRIBUTION", conditionReference: entry.condition, legalBasis: route.legalBasis },
    reviewDependencies: requiredSignoffs,
    governance: {
      governanceState: LLP_PSC_ATTRIBUTION_GOVERNANCE_STATE,
      productionAuthorized: false,
      requiredSignoffIds: requiredSignoffs,
      workingAssumptionRef: LLP_PSC_WORKING_ASSUMPTION,
      policyStatus: policyPack.status,
    },
  });
}

function validateTargetSlots(rights) {
  const slots = new Map();
  rights.forEach((right) => {
    const q = right.qualifiers || {};
    const explicitSlot = q.rightSlotId || q.shareClassId || q.votingClassId || q.rightClassId || null;
    const slot = canonicalizeJson({ subjectEntityId: right.subjectEntityId, objectEntityId: right.objectEntityId, condition: right.condition, relationshipType: right.relationshipType, explicitSlot });
    if (slots.has(slot)) fail("overlapping target rights lack distinct canonical slots", LLP_PSC_ATTRIBUTION_ERROR_CODE.MALFORMED_RELATIONSHIP, { relationshipIds: [slots.get(slot), right.relationshipId].sort() });
    slots.set(slot, right.relationshipId);
  });
}

function assessLlpPscAttributionV1({ policyPack: loadedPolicyPack, ownershipGraph, canonicalEntities, claimSupport = [], targetEntityId, caseRevision, compositionMode }) {
  try {
    validateGraph(ownershipGraph);
    assertNonEmptyString(targetEntityId, "targetEntityId");
    const successorReviewComposition = compositionMode === "SUCCESSOR_REVIEW_ONLY";
    if (compositionMode !== undefined && !successorReviewComposition) fail("unsupported LLP attribution composition mode", LLP_PSC_ATTRIBUTION_ERROR_CODE.INVALID_INPUT);
    const { policyPack, route, policyIdentity } = validateLoadedPolicy(loadedPolicyPack, successorReviewComposition);
    const entitiesById = validateEntities(canonicalEntities, ownershipGraph);
    const target = entitiesById.get(targetEntityId);
    const targetProfile = target ? profileFor(target) : "UNKNOWN";
    if (!target || target.category !== CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY || !["COMPANY", "LLP"].includes(targetProfile)) {
      fail("LLP attribution target must be a canonical COMPANY or LLP", LLP_PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_TARGET_PROFILE);
    }
    const caseReference = caseReferenceFor(caseRevision, ownershipGraph);
    const graphReference = { graphVersion: ownershipGraph.graphVersion, graphFingerprint: `sha256:${ownershipGraph.graphVersion.split(":")[1]}` };
    const support = validateSupport(claimSupport, ownershipGraph);
    const relationshipsById = new Map(ownershipGraph.relationships.map((relationship) => [relationship.relationshipId, relationship]));
    const diagnostics = [];
    const entries = new Map();
    const targetRights = ownershipGraph.relationships
      .filter(({ objectEntityId }) => objectEntityId === targetEntityId)
      .map((relationship) => ({ ...relationship, ...targetCondition(relationship, targetProfile) }))
      .filter(({ condition }) => condition !== undefined)
      .sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));
    validateTargetSlots(targetRights);

    function entryFor(personEntityId, condition) {
      const person = entitiesById.get(personEntityId);
      if (!person || person.category !== CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) return undefined;
      const key = `${personEntityId}|${condition}`;
      if (!entries.has(key)) entries.set(key, { personEntityId, targetEntityId, condition, rights: new Map(), paths: [] });
      return entries.get(key);
    }

    targetRights.forEach((right) => {
      const holder = entitiesById.get(right.subjectEntityId);
      if (!holder) return;
      if (joint(right)) diagnostics.push(diagnostic({ code: "JOINT_ARRANGEMENT_NOT_IMPLEMENTED", relationshipId: right.relationshipId, requiredSignoffs: ["A-06", "A-13"] }));
      if (holder.category === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) {
        const entry = entryFor(holder.entityId, right.condition);
        entry.rights.set(right.relationshipId, right);
        entry.paths.push(makePath(right, [], directRightState(right, right.condition)));
        return;
      }
      const holderProfile = profileFor(holder);
      if (!["COMPANY", "LLP"].includes(holderProfile)) {
        diagnostics.push(diagnostic({ code: "UNSUPPORTED_TARGET_RIGHT_HOLDER_PROFILE", entityId: holder.entityId, entityProfile: holderProfile, relationshipId: right.relationshipId, requiredSignoffs: uniqueStrings(["A-06", ...(holderProfile.includes("FUND") || holderProfile.includes("PARTNERSHIP") ? ["A-05"] : [])]) }));
        return;
      }
      enumeratePaths({ holderEntityId: holder.entityId, targetRight: right, relationships: ownershipGraph.relationships, entitiesById, policyPack, diagnostics })
        .forEach(({ personEntityId, path }) => {
          const entry = entryFor(personEntityId, right.condition);
          if (!entry) return;
          entry.rights.set(right.relationshipId, right);
          entry.paths.push(path);
        });
    });

    const basisRecords = [...entries.values()].map((entry) => {
      entry.paths = [...new Map(entry.paths.map((path) => [path.pathId, path])).values()];
      return makeBasis({ entry, assessment: assessmentFor(entry, policyPack), targetProfile, route, policyPack, policyIdentity, graphReference, caseReference, relationshipsById, support });
    }).sort((a, b) => a.basisId.localeCompare(b.basisId));
    const unsupportedDiagnostics = uniqueData(diagnostics).sort((a, b) => a.diagnosticId.localeCompare(b.diagnosticId));
    const requiredSignoffIds = uniqueStrings(["A-06", ...basisRecords.flatMap(({ governance }) => governance.requiredSignoffIds), ...unsupportedDiagnostics.flatMap(({ requiredSignoffs }) => requiredSignoffs || [])]);
    const identity = { assessmentContractVersion: LLP_PSC_ATTRIBUTION_ASSESSMENT_VERSION, algorithmVersion: LLP_PSC_ATTRIBUTION_ALGORITHM, workingAssumptionRef: LLP_PSC_WORKING_ASSUMPTION, compositionMode: compositionMode || "POLICY_DECLARED_METHOD", policyIdentity, graphReference, caseReference: caseReference || null, targetEntityId, targetProfile, basisIds: basisRecords.map(({ basisId }) => basisId), diagnosticIds: unsupportedDiagnostics.map(({ diagnosticId }) => diagnosticId) };
    return deepFreeze(cloneData({
      assessmentContractVersion: LLP_PSC_ATTRIBUTION_ASSESSMENT_VERSION,
      algorithmVersion: LLP_PSC_ATTRIBUTION_ALGORITHM,
      workingAssumptionRef: LLP_PSC_WORKING_ASSUMPTION,
      compositionMode: compositionMode || "POLICY_DECLARED_METHOD",
      assessmentId: `${LLP_PSC_ATTRIBUTION_ASSESSMENT_VERSION}:${digest(identity).slice(0, 32)}`,
      ...(caseReference === undefined ? {} : { caseReference }),
      policyIdentity,
      graphReference,
      targetEntity: { entityId: targetEntityId, entityProfile: targetProfile },
      assessedRoutes: [QUALIFICATION_ROUTE.PSC_CONDITION_ATTRIBUTION],
      assessedConditions: targetProfile === "LLP" ? [LLP_PSC_CONDITION.SURPLUS_ASSET_RIGHTS_GT_THRESHOLD, LLP_PSC_CONDITION.LLP_VOTING_GT_THRESHOLD, LLP_PSC_CONDITION.LLP_APPOINT_REMOVE_MAJORITY_OF_MANAGEMENT, LLP_PSC_CONDITION.LLP_SIGNIFICANT_INFLUENCE_OR_CONTROL] : Object.values(COMPANY_PSC_CONDITION),
      unassessedConditions: [LLP_PSC_CONDITION.LLP_TRUST_OR_FIRM_CONDITION],
      assessedNaturalPersonIds: uniqueStrings(basisRecords.map(({ personEntityId }) => personEntityId)),
      basisRecords,
      satisfiedBasisIds: basisRecords.filter(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.SATISFIED).map(({ basisId }) => basisId),
      indeterminateBasisIds: basisRecords.filter(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE).map(({ basisId }) => basisId),
      reviewRequiredBasisIds: basisRecords.filter(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.REVIEW_REQUIRED).map(({ basisId }) => basisId),
      notSatisfiedBasisIds: basisRecords.filter(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.NOT_SATISFIED).map(({ basisId }) => basisId),
      unsupportedDiagnostics,
      scope: "ROUTE_SPECIFIC_NOT_FINAL_PERSON_DETERMINATION",
      governance: { governanceState: LLP_PSC_ATTRIBUTION_GOVERNANCE_STATE, productionAuthorized: false, requiredSignoffIds, workingAssumptionRef: LLP_PSC_WORKING_ASSUMPTION, policyStatus: policyPack.status },
    }));
  } catch (error) {
    if (error instanceof LlpPscAttributionError) throw error;
    fail(error.message, LLP_PSC_ATTRIBUTION_ERROR_CODE.INVALID_INPUT, undefined, error);
  }
}

module.exports = {
  COMPANY_PSC_CONDITION,
  LLP_PSC_ATTRIBUTION_ALGORITHM,
  LLP_PSC_ATTRIBUTION_ASSESSMENT_VERSION,
  LLP_PSC_ATTRIBUTION_ERROR_CODE,
  LLP_PSC_ATTRIBUTION_GOVERNANCE_STATE,
  LLP_PSC_ATTRIBUTION_METHOD_STATUS,
  LLP_PSC_CONDITION,
  LLP_PSC_WORKING_ASSUMPTION,
  LlpPscAttributionError,
  assessLlpPscAttributionV1,
};
