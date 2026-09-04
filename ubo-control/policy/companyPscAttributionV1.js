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
const {
  assertDataOnly,
  assertNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
} = require("../internal/validation");
const { canonicalizeJson } = require("./canonicalJson");
const { hashPolicyPack, validatePolicyPack } = require("./policyPack");

const PSC_ATTRIBUTION_ALGORITHM = "ubo-psc-attribution-v1";
const PSC_ATTRIBUTION_ASSESSMENT_VERSION = "ubo-psc-attribution-assessment-v1";
const PSC_ATTRIBUTION_METHOD_STATUS = "STATUTORY_ATTRIBUTION_SEMANTICS";
const PSC_ATTRIBUTION_GOVERNANCE_STATE = "REVIEW_ONLY";

const PSC_CONDITION = Object.freeze({
  SHARES_GT_THRESHOLD: "SHARES_GT_THRESHOLD",
  VOTING_GT_THRESHOLD: "VOTING_GT_THRESHOLD",
  APPOINT_REMOVE_MAJORITY: "APPOINT_REMOVE_MAJORITY",
  SIGNIFICANT_INFLUENCE_OR_CONTROL: "SIGNIFICANT_INFLUENCE_OR_CONTROL",
  TRUST_OR_FIRM_CONDITION: "TRUST_OR_FIRM_CONDITION",
});

const PSC_ATTRIBUTION_ERROR_CODE = Object.freeze({
  INVALID_INPUT: "INVALID_COMPANY_PSC_ATTRIBUTION_INPUT",
  INVALID_POLICY_PACK: "INVALID_COMPANY_PSC_ATTRIBUTION_POLICY_PACK",
  POLICY_IDENTITY_REQUIRED: "COMPANY_PSC_ATTRIBUTION_POLICY_IDENTITY_REQUIRED",
  POLICY_IDENTITY_MISMATCH: "COMPANY_PSC_ATTRIBUTION_POLICY_IDENTITY_MISMATCH",
  UNSUPPORTED_POLICY_SCHEMA: "UNSUPPORTED_COMPANY_PSC_ATTRIBUTION_POLICY_SCHEMA",
  ROUTE_NOT_DECLARED: "PSC_ATTRIBUTION_ROUTE_NOT_DECLARED",
  UNSUPPORTED_ROUTE_METHOD: "UNSUPPORTED_PSC_ATTRIBUTION_ROUTE_METHOD",
  UNSUPPORTED_ROUTE_METHOD_STATUS: "UNSUPPORTED_PSC_ATTRIBUTION_METHOD_STATUS",
  INVALID_GRAPH: "INVALID_COMPANY_PSC_ATTRIBUTION_GRAPH",
  INCONSISTENT_GRAPH_REFERENCE: "INCONSISTENT_COMPANY_PSC_ATTRIBUTION_GRAPH_REFERENCE",
  TARGET_NOT_COMPANY: "PSC_ATTRIBUTION_TARGET_NOT_COMPANY",
  HOLDER_NOT_NATURAL_PERSON: "PSC_ATTRIBUTION_HOLDER_NOT_NATURAL_PERSON",
  UNSUPPORTED_TARGET_RIGHT_SEMANTICS: "UNSUPPORTED_COMPANY_TARGET_RIGHT_SEMANTICS",
  MALFORMED_RELATIONSHIP: "MALFORMED_PSC_ATTRIBUTION_RELATIONSHIP",
  INVALID_SUPPORT_REFERENCE: "INVALID_PSC_ATTRIBUTION_SUPPORT_REFERENCE",
});

const PATH_STATE = Object.freeze({
  VALID: "VALID",
  NOT_SATISFIED: "NOT_SATISFIED",
  INDETERMINATE: "INDETERMINATE",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
});

class CompanyPscAttributionError extends UboContractError {
  constructor(message, { code = PSC_ATTRIBUTION_ERROR_CODE.INVALID_INPUT, details, cause } = {}) {
    super(message, { code, cause });
    if (details !== undefined) this.details = deepFreeze(cloneData(details));
  }
}

function attributionError(message, code, details, cause) {
  throw new CompanyPscAttributionError(message, { code, details, cause });
}

function digest(value) {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}

function canonicalSort(values) {
  return cloneData(values).sort((left, right) => canonicalizeJson(left).localeCompare(canonicalizeJson(right)));
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function uniqueData(values) {
  const sorted = canonicalSort(values || []);
  return sorted.filter((value, index) => index === 0
    || canonicalizeJson(value) !== canonicalizeJson(sorted[index - 1]));
}

function normalizeCaseReference(caseRevision, graph) {
  const graphCase = graph.sourceCase;
  if (caseRevision === undefined) return graphCase === undefined ? undefined : cloneData(graphCase);
  const supplied = Number.isSafeInteger(caseRevision) && caseRevision > 0
    ? { revision: caseRevision }
    : cloneData(caseRevision);
  assertPlainObject(supplied, "caseRevision");
  if (!Number.isSafeInteger(supplied.revision) || supplied.revision < 1) {
    attributionError("caseRevision.revision must be a positive safe integer", PSC_ATTRIBUTION_ERROR_CODE.INVALID_INPUT);
  }
  if (supplied.caseId !== undefined) assertNonEmptyString(supplied.caseId, "caseRevision.caseId");
  if (supplied.revisionId !== undefined) assertNonEmptyString(supplied.revisionId, "caseRevision.revisionId");
  if (graphCase !== undefined) {
    for (const field of ["caseId", "revision", "revisionId"]) {
      if (supplied[field] !== undefined && graphCase[field] !== supplied[field]) {
        attributionError("case revision does not match the canonical graph", PSC_ATTRIBUTION_ERROR_CODE.INCONSISTENT_GRAPH_REFERENCE);
      }
    }
  }
  return supplied;
}

function validateLoadedPolicy(loadedPolicyPack) {
  if (!loadedPolicyPack || typeof loadedPolicyPack !== "object"
    || !loadedPolicyPack.policyPack || !loadedPolicyPack.identity) {
    attributionError(
      "company PSC attribution requires a loaded schema-1.3 Policy Pack with exact identity",
      PSC_ATTRIBUTION_ERROR_CODE.POLICY_IDENTITY_REQUIRED,
    );
  }
  const { policyPack, identity } = loadedPolicyPack;
  try {
    validatePolicyPack(policyPack);
  } catch (cause) {
    attributionError("company PSC attribution received an invalid Policy Pack", PSC_ATTRIBUTION_ERROR_CODE.INVALID_POLICY_PACK, undefined, cause);
  }
  if (policyPack.schemaVersion !== "1.3") {
    attributionError("company PSC attribution requires Policy Pack schema 1.3", PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_POLICY_SCHEMA);
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
    attributionError("loaded Policy Pack identity does not match canonical content", PSC_ATTRIBUTION_ERROR_CODE.POLICY_IDENTITY_MISMATCH);
  }
  const route = policyPack.qualificationDoctrine.routes
    .find(({ id }) => id === QUALIFICATION_ROUTE.PSC_CONDITION_ATTRIBUTION);
  if (!route) attributionError("Policy Pack does not declare PSC_CONDITION_ATTRIBUTION", PSC_ATTRIBUTION_ERROR_CODE.ROUTE_NOT_DECLARED);
  if (route.method !== PSC_ATTRIBUTION_ALGORITHM) {
    attributionError(`PSC attribution method must equal ${PSC_ATTRIBUTION_ALGORITHM}`, PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_ROUTE_METHOD);
  }
  if (route.methodStatus !== PSC_ATTRIBUTION_METHOD_STATUS) {
    attributionError(`PSC attribution methodStatus must equal ${PSC_ATTRIBUTION_METHOD_STATUS}`, PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_ROUTE_METHOD_STATUS);
  }
  if (!Array.isArray(route.conditions)) {
    attributionError("PSC attribution route conditions are required", PSC_ATTRIBUTION_ERROR_CODE.INVALID_POLICY_PACK);
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

function entityProfile(entity) {
  if (entity.category === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) return "NATURAL_PERSON";
  if (entity.category === CANONICAL_ENTITY_CATEGORY.TRUST_OR_LEGAL_ARRANGEMENT) return "TRUST_OR_LEGAL_ARRANGEMENT";
  const raw = entity.entityTypeMetadata?.entityProfile
    || entity.entityTypeMetadata?.sourceEntityType
    || entity.entityTypeMetadata?.legalEntityProfile;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim().toUpperCase() : "UNKNOWN";
}

function validateEntities(canonicalEntities, graph) {
  if (!Array.isArray(canonicalEntities)) {
    attributionError("canonicalEntities must be an array", PSC_ATTRIBUTION_ERROR_CODE.INVALID_INPUT);
  }
  const byId = new Map();
  canonicalEntities.forEach((entity, index) => {
    assertPlainObject(entity, `canonicalEntities[${index}]`);
    assertNonEmptyString(entity.entityId, `canonicalEntities[${index}].entityId`);
    assertNonEmptyString(entity.category, `canonicalEntities[${index}].category`);
    if (byId.has(entity.entityId)) attributionError(`duplicate canonical entity ${entity.entityId}`, PSC_ATTRIBUTION_ERROR_CODE.INVALID_INPUT);
    byId.set(entity.entityId, entity);
  });
  graph.nodes.forEach((node) => {
    const entity = byId.get(node.entityId);
    if (!entity || entity.category !== node.category) {
      attributionError(`canonical entity ${node.entityId} does not match the graph node`, PSC_ATTRIBUTION_ERROR_CODE.INCONSISTENT_GRAPH_REFERENCE);
    }
  });
  return byId;
}

function validateGraph(graph) {
  try {
    assertPlainObject(graph, "ownershipGraph");
    assertDataOnly(graph, "ownershipGraph");
    assertNonEmptyString(graph.graphVersion, "ownershipGraph.graphVersion");
    if (!/^ubo-graph-v1:[a-f0-9]{64}$/.test(graph.graphVersion)) {
      attributionError("ownershipGraph.graphVersion must contain the canonical graph fingerprint", PSC_ATTRIBUTION_ERROR_CODE.INVALID_GRAPH);
    }
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.relationships)) {
      attributionError("ownershipGraph nodes and relationships are required", PSC_ATTRIBUTION_ERROR_CODE.INVALID_GRAPH);
    }
    const nodeIds = new Set(graph.nodes.map(({ entityId }) => entityId));
    if (nodeIds.size !== graph.nodes.length) {
      attributionError("ownershipGraph contains duplicate canonical nodes", PSC_ATTRIBUTION_ERROR_CODE.INVALID_GRAPH);
    }
    const relationshipIds = new Set();
    graph.relationships.forEach((relationship, index) => {
      assertPlainObject(relationship, `ownershipGraph.relationships[${index}]`);
      ["relationshipId", "subjectEntityId", "objectEntityId", "relationshipType", "temporalState"]
        .forEach((field) => assertNonEmptyString(relationship[field], `ownershipGraph.relationships[${index}].${field}`));
      if (!nodeIds.has(relationship.subjectEntityId) || !nodeIds.has(relationship.objectEntityId)) {
        attributionError("graph relationship references a missing canonical node", PSC_ATTRIBUTION_ERROR_CODE.MALFORMED_RELATIONSHIP);
      }
      if (relationshipIds.has(relationship.relationshipId)) {
        attributionError("ownershipGraph contains duplicate relationship IDs", PSC_ATTRIBUTION_ERROR_CODE.MALFORMED_RELATIONSHIP);
      }
      relationshipIds.add(relationship.relationshipId);
      if (!Object.values(TEMPORAL_STATE).includes(relationship.temporalState)) {
        attributionError("graph relationship has an invalid temporal state", PSC_ATTRIBUTION_ERROR_CODE.MALFORMED_RELATIONSHIP);
      }
      if (!Array.isArray(relationship.supportingClaimIds)) {
        attributionError("graph relationship supportingClaimIds must be an array", PSC_ATTRIBUTION_ERROR_CODE.MALFORMED_RELATIONSHIP);
      }
      relationship.supportingClaimIds.forEach((claimId, claimIndex) => {
        assertNonEmptyString(claimId, `ownershipGraph.relationships[${index}].supportingClaimIds[${claimIndex}]`);
      });
    });
  } catch (error) {
    if (error instanceof CompanyPscAttributionError) throw error;
    attributionError(error.message, PSC_ATTRIBUTION_ERROR_CODE.INVALID_GRAPH, undefined, error);
  }
}

function validateClaimSupport(claimSupport, graph) {
  if (!Array.isArray(claimSupport)) {
    attributionError("claimSupport must be an array", PSC_ATTRIBUTION_ERROR_CODE.INVALID_SUPPORT_REFERENCE);
  }
  const operativeClaimIds = new Set(graph.relationships.flatMap(({ supportingClaimIds }) => supportingClaimIds));
  const byId = new Map();
  claimSupport.forEach((support, index) => {
    assertPlainObject(support, `claimSupport[${index}]`);
    assertNonEmptyString(support.claimId, `claimSupport[${index}].claimId`);
    if (!operativeClaimIds.has(support.claimId)) {
      attributionError(`claimSupport references non-operative claim ${support.claimId}`, PSC_ATTRIBUTION_ERROR_CODE.INVALID_SUPPORT_REFERENCE);
    }
    if (!Array.isArray(support.evidenceReferences)) {
      attributionError("claimSupport evidenceReferences must be an array", PSC_ATTRIBUTION_ERROR_CODE.INVALID_SUPPORT_REFERENCE);
    }
    support.evidenceReferences.forEach((reference, referenceIndex) => {
      validateEvidenceReference(reference, `claimSupport[${index}].evidenceReferences[${referenceIndex}]`);
    });
    if (byId.has(support.claimId)) attributionError(`duplicate claim support ${support.claimId}`, PSC_ATTRIBUTION_ERROR_CODE.INVALID_SUPPORT_REFERENCE);
    byId.set(support.claimId, cloneData(support.evidenceReferences));
  });
  return byId;
}

function percentageIntervalAssessment(value, thresholdValue, comparator, incomplete = false) {
  if (!value || value.type === PERCENTAGE_VALUE_TYPE.UNKNOWN) {
    return { state: QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE, reasonCode: "PERCENTAGE_NOT_ESTABLISHED" };
  }
  const interval = intervalFromPercentageValue(value);
  const threshold = decimalNumberToRational(thresholdValue);
  const lowerComparison = compare(interval.lower, threshold);
  const upperComparison = compare(interval.upper, threshold);
  const satisfied = comparator === ">"
    ? lowerComparison > 0 || (lowerComparison === 0 && !interval.lowerInclusive)
    : lowerComparison >= 0;
  if (satisfied) return { state: QUALIFICATION_ASSESSMENT_STATE.SATISFIED, reasonCode: "PERCENTAGE_GUARANTEES_THRESHOLD" };
  if (incomplete) return { state: QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE, reasonCode: "INCOMPLETE_ATTRIBUTION_MAY_CHANGE_THRESHOLD_OUTCOME" };
  const notSatisfied = comparator === ">"
    ? upperComparison <= 0
    : upperComparison < 0 || (upperComparison === 0 && !interval.upperInclusive);
  if (notSatisfied) return { state: QUALIFICATION_ASSESSMENT_STATE.NOT_SATISFIED, reasonCode: "PERCENTAGE_DOES_NOT_SATISFY_THRESHOLD" };
  return { state: QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE, reasonCode: "PERCENTAGE_RANGE_STRADDLES_THRESHOLD" };
}

function targetRightCondition(relationship) {
  if (relationship.relationshipType === RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP) {
    if (relationship.qualifiers?.economicInterestConcept !== "SHARE_OWNERSHIP") {
      attributionError(
        `economic relationship ${relationship.relationshipId} does not explicitly establish company shares`,
        PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_TARGET_RIGHT_SEMANTICS,
        { relationshipId: relationship.relationshipId },
      );
    }
    return PSC_CONDITION.SHARES_GT_THRESHOLD;
  }
  if (relationship.relationshipType === RELATIONSHIP_TYPE.VOTING_RIGHTS) return PSC_CONDITION.VOTING_GT_THRESHOLD;
  if ([RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT, RELATIONSHIP_TYPE.BOARD_REMOVAL_RIGHT]
    .includes(relationship.relationshipType)) return PSC_CONDITION.APPOINT_REMOVE_MAJORITY;
  if (relationship.relationshipType === RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT
    && /APPOINT|REMOVE/.test(String(relationship.qualifiers?.controlConcept || "").toUpperCase())) {
    return PSC_CONDITION.APPOINT_REMOVE_MAJORITY;
  }
  if (relationship.relationshipType === RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL) {
    return PSC_CONDITION.SIGNIFICANT_INFLUENCE_OR_CONTROL;
  }
  return undefined;
}

function isInterpretive(relationship) {
  const qualifiers = relationship.qualifiers || {};
  return qualifiers.ambiguity !== undefined || qualifiers.potential === true
    || qualifiers.deFacto === true || qualifiers.requiresInterpretation === true;
}

function hasJointSignal(relationship) {
  const qualifiers = relationship.qualifiers || {};
  return qualifiers.jointArrangement === true || qualifiers.jointArrangementSignal === true
    || qualifiers.controlConcept === "JOINT_ARRANGEMENT";
}

function targetRightState(relationship, condition) {
  if (hasJointSignal(relationship)) return { state: PATH_STATE.REVIEW_REQUIRED, requiredSignoffs: ["A-13"], reasonCode: "JOINT_ARRANGEMENT_NOT_IMPLEMENTED" };
  if (relationship.temporalState === TEMPORAL_STATE.CEASED) return { state: PATH_STATE.NOT_SATISFIED, requiredSignoffs: [], reasonCode: "TARGET_RIGHT_NOT_CURRENT" };
  if (relationship.temporalState === TEMPORAL_STATE.UNKNOWN) return { state: PATH_STATE.INDETERMINATE, requiredSignoffs: [], reasonCode: "TARGET_RIGHT_CURRENTNESS_UNKNOWN" };
  if (condition === PSC_CONDITION.APPOINT_REMOVE_MAJORITY) {
    if (isInterpretive(relationship)) return { state: PATH_STATE.REVIEW_REQUIRED, requiredSignoffs: ["A-12"], reasonCode: "APPOINTMENT_RIGHT_REQUIRES_INTERPRETATION" };
    if (String(relationship.qualifiers?.scope || "").toUpperCase() === "MAJORITY") {
      return { state: PATH_STATE.VALID, requiredSignoffs: ["A-12"], reasonCode: "EXPLICIT_MAJORITY_APPOINTMENT_RIGHT" };
    }
    return { state: PATH_STATE.INDETERMINATE, requiredSignoffs: ["A-12"], reasonCode: "APPOINTMENT_MAJORITY_SCOPE_NOT_ESTABLISHED" };
  }
  if (condition === PSC_CONDITION.SIGNIFICANT_INFLUENCE_OR_CONTROL) {
    if (isInterpretive(relationship)) return { state: PATH_STATE.REVIEW_REQUIRED, requiredSignoffs: [], reasonCode: "SIGNIFICANT_CONTROL_REQUIRES_INTERPRETATION" };
    return { state: PATH_STATE.VALID, requiredSignoffs: [], reasonCode: "EXPLICIT_SIGNIFICANT_CONTROL" };
  }
  return { state: PATH_STATE.VALID, requiredSignoffs: [], reasonCode: "CURRENT_TARGET_RIGHT" };
}

function isPotentialMajorityStep(relationship) {
  return [
    RELATIONSHIP_TYPE.VOTING_RIGHTS,
    RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT,
    RELATIONSHIP_TYPE.BOARD_REMOVAL_RIGHT,
    RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT,
    RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL,
  ].includes(relationship.relationshipType);
}

function majorityStep(relationship) {
  const base = {
    relationshipId: relationship.relationshipId,
    fromEntityId: relationship.subjectEntityId,
    toEntityId: relationship.objectEntityId,
    relationshipType: relationship.relationshipType,
    temporalState: relationship.temporalState,
    ...(relationship.measurement === undefined ? {} : { measurement: cloneData(relationship.measurement) }),
    ...(relationship.qualifiers === undefined ? {} : { qualifiers: cloneData(relationship.qualifiers) }),
  };
  if (hasJointSignal(relationship)) {
    return { ...base, state: PATH_STATE.REVIEW_REQUIRED, reasonCode: "JOINT_ARRANGEMENT_NOT_IMPLEMENTED", requiredSignoffs: ["A-13"] };
  }
  if (relationship.temporalState === TEMPORAL_STATE.CEASED) {
    return { ...base, state: PATH_STATE.NOT_SATISFIED, reasonCode: "MAJORITY_STEP_NOT_CURRENT", requiredSignoffs: [] };
  }
  if (relationship.temporalState === TEMPORAL_STATE.UNKNOWN) {
    return { ...base, state: PATH_STATE.INDETERMINATE, reasonCode: "MAJORITY_STEP_CURRENTNESS_UNKNOWN", requiredSignoffs: [] };
  }
  if (relationship.relationshipType === RELATIONSHIP_TYPE.VOTING_RIGHTS) {
    const assessment = percentageIntervalAssessment(relationship.measurement, 50, ">", false);
    return {
      ...base,
      state: assessment.state === QUALIFICATION_ASSESSMENT_STATE.SATISFIED
        ? PATH_STATE.VALID
        : assessment.state,
      reasonCode: assessment.state === QUALIFICATION_ASSESSMENT_STATE.SATISFIED
        ? "STRICT_MAJORITY_VOTING_RIGHT_ESTABLISHED"
        : assessment.reasonCode,
      requiredSignoffs: [],
    };
  }
  if ([RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT, RELATIONSHIP_TYPE.BOARD_REMOVAL_RIGHT]
    .includes(relationship.relationshipType)
    || (relationship.relationshipType === RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT
      && /APPOINT|REMOVE/.test(String(relationship.qualifiers?.controlConcept || "").toUpperCase()))) {
    if (isInterpretive(relationship)) {
      return { ...base, state: PATH_STATE.REVIEW_REQUIRED, reasonCode: "APPOINTMENT_STEP_REQUIRES_INTERPRETATION", requiredSignoffs: ["A-12"] };
    }
    if (String(relationship.qualifiers?.scope || "").toUpperCase() === "MAJORITY") {
      return { ...base, state: PATH_STATE.VALID, reasonCode: "EXPLICIT_MAJORITY_APPOINTMENT_STEP", requiredSignoffs: ["A-12"] };
    }
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

function combinePathState(states) {
  if (states.includes(PATH_STATE.REVIEW_REQUIRED)) return PATH_STATE.REVIEW_REQUIRED;
  if (states.includes(PATH_STATE.INDETERMINATE)) return PATH_STATE.INDETERMINATE;
  if (states.includes(PATH_STATE.NOT_SATISFIED)) return PATH_STATE.NOT_SATISFIED;
  return PATH_STATE.VALID;
}

function diagnosticId(diagnostic) {
  return `psc-diagnostic:${digest(diagnostic).slice(0, 24)}`;
}

function createPath(targetRight, steps, rightAssessment) {
  const relationshipIds = [...steps.map(({ relationshipId }) => relationshipId), targetRight.relationshipId];
  const state = combinePathState([...steps.map((step) => step.state), rightAssessment.state]);
  return {
    pathId: `psc-path:${digest({ targetRightId: targetRight.relationshipId, relationshipIds }).slice(0, 24)}`,
    targetRightId: targetRight.relationshipId,
    state,
    relationshipIds,
    majoritySteps: cloneData(steps),
    directness: steps.length === 0 ? QUALIFICATION_DIRECTNESS.DIRECT : QUALIFICATION_DIRECTNESS.INDIRECT,
    requiredSignoffs: uniqueStrings([
      ...rightAssessment.requiredSignoffs,
      ...steps.flatMap(({ requiredSignoffs }) => requiredSignoffs),
    ]),
    reasonCodes: uniqueStrings([rightAssessment.reasonCode, ...steps.map(({ reasonCode }) => reasonCode)]),
  };
}

function enumerateMajorityPaths({ holderEntityId, relationships, entitiesById, targetRight, diagnostics }) {
  const incoming = new Map();
  relationships.filter(isPotentialMajorityStep).forEach((relationship) => {
    if (!incoming.has(relationship.objectEntityId)) incoming.set(relationship.objectEntityId, []);
    incoming.get(relationship.objectEntityId).push(relationship);
  });
  for (const values of incoming.values()) values.sort((left, right) => left.relationshipId.localeCompare(right.relationshipId));
  const paths = [];

  function visit(currentEntityId, visited, stepsToHolder) {
    for (const relationship of incoming.get(currentEntityId) || []) {
      const subject = entitiesById.get(relationship.subjectEntityId);
      const object = entitiesById.get(relationship.objectEntityId);
      if (!subject || !object) continue;
      if (visited.has(subject.entityId)) {
        const raw = {
          code: "RELEVANT_ATTRIBUTION_CYCLE",
          entityIds: [...visited, subject.entityId].sort(),
          relationshipIds: uniqueStrings([...stepsToHolder.map(({ relationshipId }) => relationshipId), relationship.relationshipId]),
          requiredSignoffs: ["A-09"],
        };
        diagnostics.push({ diagnosticId: diagnosticId(raw), ...raw });
        continue;
      }
      if (entityProfile(object) !== "COMPANY") {
        const profile = entityProfile(object);
        const raw = {
          code: "UNSUPPORTED_INTERMEDIARY_PROFILE",
          entityId: object.entityId,
          entityProfile: profile,
          relationshipId: relationship.relationshipId,
          requiredSignoffs: uniqueStrings(["A-09", ...(profile === "LLP" ? ["A-06"] : [])]),
        };
        diagnostics.push({ diagnosticId: diagnosticId(raw), ...raw });
        continue;
      }
      const assessedStep = majorityStep(relationship);
      if (["SIGNIFICANT_CONTROL_IS_NOT_A_MAJORITY_STEP", "UNSUPPORTED_MAJORITY_STEP_SEMANTIC"].includes(assessedStep.reasonCode)) {
        const raw = {
          code: assessedStep.reasonCode,
          relationshipId: relationship.relationshipId,
          requiredSignoffs: ["A-09"],
        };
        diagnostics.push({ diagnosticId: diagnosticId(raw), ...raw });
      }
      if (assessedStep.reasonCode === "JOINT_ARRANGEMENT_NOT_IMPLEMENTED") {
        const raw = {
          code: "JOINT_ARRANGEMENT_NOT_IMPLEMENTED",
          relationshipId: relationship.relationshipId,
          requiredSignoffs: ["A-09", "A-13"],
        };
        diagnostics.push({ diagnosticId: diagnosticId(raw), ...raw });
      }
      const steps = [assessedStep, ...stepsToHolder];
      if (subject.category === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) {
        paths.push({ personEntityId: subject.entityId, path: createPath(targetRight, steps, targetRightState(targetRight, targetRight.condition)) });
        continue;
      }
      const profile = entityProfile(subject);
      if (profile !== "COMPANY") {
        const raw = {
          code: "UNSUPPORTED_INTERMEDIARY_PROFILE",
          entityId: subject.entityId,
          entityProfile: profile,
          relationshipId: relationship.relationshipId,
          requiredSignoffs: uniqueStrings(["A-09", ...(profile === "LLP" ? ["A-06"] : [])]),
        };
        diagnostics.push({ diagnosticId: diagnosticId(raw), ...raw });
        continue;
      }
      visit(subject.entityId, new Set([...visited, subject.entityId]), steps);
    }
  }

  visit(holderEntityId, new Set([holderEntityId]), []);
  return paths.sort((left, right) => left.path.pathId.localeCompare(right.path.pathId));
}

function relationshipReference(relationship, claimEvidenceById) {
  const supportingClaimIds = uniqueStrings(relationship.supportingClaimIds);
  return {
    relationshipId: relationship.relationshipId,
    supportingClaimIds,
    evidenceReferences: uniqueData(supportingClaimIds.flatMap((claimId) => claimEvidenceById.get(claimId) || [])),
  };
}

function directnessFor(paths) {
  const relevant = paths.filter(({ state }) => state === PATH_STATE.VALID);
  const considered = relevant.length > 0 ? relevant : paths;
  if (considered.length === 0) return QUALIFICATION_DIRECTNESS.NOT_ESTABLISHED;
  const direct = considered.some(({ directness }) => directness === QUALIFICATION_DIRECTNESS.DIRECT);
  const indirect = considered.some(({ directness }) => directness === QUALIFICATION_DIRECTNESS.INDIRECT);
  if (direct && indirect) return QUALIFICATION_DIRECTNESS.DIRECT_AND_INDIRECT;
  return direct ? QUALIFICATION_DIRECTNESS.DIRECT : QUALIFICATION_DIRECTNESS.INDIRECT;
}

function aggregateMeasurements(rights) {
  const known = rights.filter(({ measurement }) => measurement && measurement.type !== PERCENTAGE_VALUE_TYPE.UNKNOWN);
  if (known.length === 0) return undefined;
  let aggregate = intervalFromPercentageValue(known[0].measurement);
  for (let index = 1; index < known.length; index += 1) {
    aggregate = addIntervals(aggregate, intervalFromPercentageValue(known[index].measurement));
  }
  return intervalToCalculatedValue(capPercentageInterval(aggregate));
}

function percentageThreshold(policyPack, condition) {
  const key = condition === PSC_CONDITION.SHARES_GT_THRESHOLD ? "economic" : "voting";
  const threshold = policyPack.statutoryThresholds[key];
  return {
    key,
    descriptor: {
      value: threshold.value,
      comparator: threshold.comparator,
      classification: QUALIFICATION_CLASSIFICATION.STATUTORY,
      sourceClassification: threshold.classification,
      legalBasis: threshold.legalBasis,
      policyFieldReference: `statutoryThresholds.${key}`,
      dimension: key === "economic" ? GRAPH_DIMENSION.ECONOMIC : GRAPH_DIMENSION.VOTING,
    },
  };
}

function assessmentForEntry(entry, policyPack) {
  const paths = [...entry.paths].sort((left, right) => left.pathId.localeCompare(right.pathId));
  const validRightIds = uniqueStrings(paths.filter(({ state }) => state === PATH_STATE.VALID).map(({ targetRightId }) => targetRightId));
  const validRights = [...entry.rights.values()].filter(({ relationshipId }) => validRightIds.includes(relationshipId));
  const uncertainRightIds = uniqueStrings(paths
    .filter(({ state, targetRightId }) => (
      [PATH_STATE.INDETERMINATE, PATH_STATE.REVIEW_REQUIRED].includes(state)
      && !validRightIds.includes(targetRightId)
    ))
    .map(({ targetRightId }) => targetRightId));
  const hasReview = paths.some(({ state }) => state === PATH_STATE.REVIEW_REQUIRED);
  const hasIndeterminate = paths.some(({ state }) => state === PATH_STATE.INDETERMINATE);

  if ([PSC_CONDITION.SHARES_GT_THRESHOLD, PSC_CONDITION.VOTING_GT_THRESHOLD].includes(entry.condition)) {
    const aggregate = aggregateMeasurements(validRights);
    const incomplete = uncertainRightIds.length > 0
      || validRights.some(({ measurement }) => !measurement || measurement.type === PERCENTAGE_VALUE_TYPE.UNKNOWN);
    if (aggregate === undefined) {
      if (hasReview) return { state: QUALIFICATION_ASSESSMENT_STATE.REVIEW_REQUIRED, reasonCode: "ATTRIBUTION_REQUIRES_REVIEW" };
      if (hasIndeterminate || incomplete) return { state: QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE, reasonCode: "ATTRIBUTION_OR_TARGET_RIGHT_INDETERMINATE" };
      return { state: QUALIFICATION_ASSESSMENT_STATE.NOT_SATISFIED, reasonCode: "NO_QUALIFYING_MAJORITY_CHAIN" };
    }
    const { descriptor } = percentageThreshold(policyPack, entry.condition);
    const thresholdAssessment = percentageIntervalAssessment(aggregate, descriptor.value, descriptor.comparator, incomplete);
    if (thresholdAssessment.state === QUALIFICATION_ASSESSMENT_STATE.SATISFIED) {
      return { state: thresholdAssessment.state, reasonCode: "ATTRIBUTED_TARGET_RIGHTS_SATISFY_CONDITION", aggregate };
    }
    if (hasReview) return { state: QUALIFICATION_ASSESSMENT_STATE.REVIEW_REQUIRED, reasonCode: "ATTRIBUTION_REQUIRES_REVIEW", aggregate };
    return { state: thresholdAssessment.state, reasonCode: thresholdAssessment.reasonCode, aggregate };
  }
  if (validRightIds.length > 0) return { state: QUALIFICATION_ASSESSMENT_STATE.SATISFIED, reasonCode: "EXPLICIT_CONDITION_ATTRIBUTED" };
  if (hasReview) return { state: QUALIFICATION_ASSESSMENT_STATE.REVIEW_REQUIRED, reasonCode: "ATTRIBUTION_REQUIRES_REVIEW" };
  if (hasIndeterminate) return { state: QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE, reasonCode: "ATTRIBUTION_INDETERMINATE" };
  return { state: QUALIFICATION_ASSESSMENT_STATE.NOT_SATISFIED, reasonCode: "CONDITION_NOT_ESTABLISHED" };
}

function requirementForCondition(condition) {
  if (condition === PSC_CONDITION.SHARES_GT_THRESHOLD) return "UBO-R01";
  if (condition === PSC_CONDITION.VOTING_GT_THRESHOLD) return "UBO-R04";
  if (condition === PSC_CONDITION.APPOINT_REMOVE_MAJORITY) return "UBO-R05";
  return "UBO-R06";
}

function validateTargetRightSlots(targetRights) {
  const slots = new Map();
  targetRights.forEach((right) => {
    const explicitSlot = right.qualifiers?.rightSlotId || right.qualifiers?.shareClassId
      || right.qualifiers?.votingClassId || right.qualifiers?.rightClassId;
    const slot = canonicalizeJson({
      subjectEntityId: right.subjectEntityId,
      objectEntityId: right.objectEntityId,
      condition: right.condition,
      relationshipType: right.relationshipType,
      explicitSlot: explicitSlot || null,
    });
    if (slots.has(slot)) {
      attributionError(
        "target-right relationships overlap without distinct canonical right-slot semantics",
        PSC_ATTRIBUTION_ERROR_CODE.MALFORMED_RELATIONSHIP,
        { relationshipIds: [slots.get(slot), right.relationshipId].sort() },
      );
    }
    slots.set(slot, right.relationshipId);
  });
}

function makeBasis({ entry, assessment, policyPack, route, policyIdentity, graphReference, caseReference, relationshipsById, claimEvidenceById }) {
  const paths = [...entry.paths].sort((left, right) => left.pathId.localeCompare(right.pathId));
  const relationshipIds = uniqueStrings(paths.flatMap(({ relationshipIds: ids }) => ids));
  const relationshipReferences = relationshipIds.map((id) => relationshipReference(relationshipsById.get(id), claimEvidenceById));
  const targetRights = [...entry.rights.values()].sort((left, right) => left.relationshipId.localeCompare(right.relationshipId));
  const requiredSignoffs = uniqueStrings([
    route.signoffId,
    ...(entry.condition === PSC_CONDITION.APPOINT_REMOVE_MAJORITY ? ["A-12"] : []),
    ...paths.flatMap(({ requiredSignoffs: ids }) => ids),
  ]);
  const dimension = entry.condition === PSC_CONDITION.SHARES_GT_THRESHOLD
    ? GRAPH_DIMENSION.ECONOMIC
    : entry.condition === PSC_CONDITION.VOTING_GT_THRESHOLD ? GRAPH_DIMENSION.VOTING : undefined;
  const threshold = dimension === undefined ? undefined : percentageThreshold(policyPack, entry.condition).descriptor;
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
    directness: directnessFor(paths),
    method: PSC_ATTRIBUTION_ALGORITHM,
    methodStatus: PSC_ATTRIBUTION_METHOD_STATUS,
    methodVersion: PSC_ATTRIBUTION_ALGORITHM,
    assessmentState: assessment.state,
    reasonCode: assessment.reasonCode,
    ...(threshold === undefined ? {} : { threshold }),
    ...(assessment.aggregate === undefined ? {} : { aggregatedTargetRightValue: cloneData(assessment.aggregate) }),
    targetRightReferences: targetRights.map((right) => ({
      targetRightId: right.relationshipId,
      holderEntityId: right.subjectEntityId,
      relationshipId: right.relationshipId,
      temporalState: right.temporalState,
      ...(right.measurement === undefined ? {} : { originalValue: cloneData(right.measurement) }),
      attributed: paths.some((path) => path.targetRightId === right.relationshipId && path.state === PATH_STATE.VALID),
    })),
    attributionChains: cloneData(paths),
    orderedPathReferences: paths.map(({ pathId, targetRightId, state, relationshipIds: ids }) => ({ pathId, targetRightId, state, relationshipIds: cloneData(ids) })),
    relationshipReferences,
    operativeClaimReferences: uniqueStrings(relationshipReferences.flatMap(({ supportingClaimIds }) => supportingClaimIds)),
    evidenceReferences: uniqueData(relationshipReferences.flatMap(({ evidenceReferences }) => evidenceReferences)),
    policyRequirement: {
      requirementId: requirementForCondition(entry.condition),
      routeReference: "qualificationDoctrine.routes.PSC_CONDITION_ATTRIBUTION",
      conditionReference: `qualificationDoctrine.routes.PSC_CONDITION_ATTRIBUTION.conditions.${entry.condition}`,
      legalBasis: route.legalBasis,
    },
    reviewDependencies: requiredSignoffs,
    governance: {
      governanceState: PSC_ATTRIBUTION_GOVERNANCE_STATE,
      policyStatus: policyPack.status,
      productionAuthorized: false,
      requiredSignoffIds: requiredSignoffs,
    },
  });
}

function assessCompanyPscAttributionV1({
  policyPack: loadedPolicyPack,
  ownershipGraph,
  canonicalEntities,
  claimSupport = [],
  targetEntityId,
  caseRevision,
}) {
  try {
    validateGraph(ownershipGraph);
    assertNonEmptyString(targetEntityId, "targetEntityId");
    const { policyPack, route, policyIdentity } = validateLoadedPolicy(loadedPolicyPack);
    const entitiesById = validateEntities(canonicalEntities, ownershipGraph);
    const target = entitiesById.get(targetEntityId);
    if (!target || target.category !== CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY || entityProfile(target) !== "COMPANY") {
      attributionError("PSC attribution target must be a canonical COMPANY", PSC_ATTRIBUTION_ERROR_CODE.TARGET_NOT_COMPANY);
    }
    const caseReference = normalizeCaseReference(caseRevision, ownershipGraph);
    const fingerprint = ownershipGraph.graphVersion.split(":")[1];
    const graphReference = { graphVersion: ownershipGraph.graphVersion, graphFingerprint: `sha256:${fingerprint}` };
    const claimEvidenceById = validateClaimSupport(claimSupport, ownershipGraph);
    const relationshipsById = new Map(ownershipGraph.relationships.map((relationship) => [relationship.relationshipId, relationship]));
    const diagnostics = [];
    const entries = new Map();
    const targetRights = ownershipGraph.relationships
      .filter(({ objectEntityId }) => objectEntityId === targetEntityId)
      .map((relationship) => ({ ...relationship, condition: targetRightCondition(relationship) }))
      .filter(({ condition }) => condition !== undefined)
      .sort((left, right) => left.relationshipId.localeCompare(right.relationshipId));
    validateTargetRightSlots(targetRights);

    function entryFor(personEntityId, condition) {
      const person = entitiesById.get(personEntityId);
      if (!person || person.category !== CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) {
        attributionError("final PSC attribution holder must be a canonical NATURAL_PERSON", PSC_ATTRIBUTION_ERROR_CODE.HOLDER_NOT_NATURAL_PERSON);
      }
      const key = `${personEntityId}|${condition}`;
      if (!entries.has(key)) entries.set(key, {
        personEntityId,
        targetEntityId,
        condition,
        rights: new Map(),
        paths: [],
      });
      return entries.get(key);
    }

    targetRights.forEach((targetRight) => {
      const holder = entitiesById.get(targetRight.subjectEntityId);
      if (!holder) return;
      if (hasJointSignal(targetRight)) {
        const raw = {
          code: "JOINT_ARRANGEMENT_NOT_IMPLEMENTED",
          relationshipId: targetRight.relationshipId,
          requiredSignoffs: ["A-09", "A-13"],
        };
        diagnostics.push({ diagnosticId: diagnosticId(raw), ...raw });
      }
      if (holder.category === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) {
        const entry = entryFor(holder.entityId, targetRight.condition);
        entry.rights.set(targetRight.relationshipId, targetRight);
        entry.paths.push(createPath(targetRight, [], targetRightState(targetRight, targetRight.condition)));
        return;
      }
      const profile = entityProfile(holder);
      if (profile !== "COMPANY") {
        const raw = {
          code: "UNSUPPORTED_TARGET_RIGHT_HOLDER_PROFILE",
          entityId: holder.entityId,
          entityProfile: profile,
          relationshipId: targetRight.relationshipId,
          requiredSignoffs: uniqueStrings(["A-09", ...(profile === "LLP" ? ["A-06"] : [])]),
        };
        diagnostics.push({ diagnosticId: diagnosticId(raw), ...raw });
        return;
      }
      enumerateMajorityPaths({
        holderEntityId: holder.entityId,
        relationships: ownershipGraph.relationships,
        entitiesById,
        targetRight,
        diagnostics,
      }).forEach(({ personEntityId, path }) => {
        const entry = entryFor(personEntityId, targetRight.condition);
        entry.rights.set(targetRight.relationshipId, targetRight);
        entry.paths.push(path);
      });
    });

    const basisRecords = [...entries.values()]
      .map((entry) => {
        entry.paths = [...new Map(entry.paths.map((path) => [path.pathId, path])).values()];
        const assessment = assessmentForEntry(entry, policyPack);
        return makeBasis({
          entry,
          assessment,
          policyPack,
          route,
          policyIdentity,
          graphReference,
          caseReference,
          relationshipsById,
          claimEvidenceById,
        });
      })
      .sort((left, right) => left.basisId.localeCompare(right.basisId));
    const unsupportedDiagnostics = uniqueData(diagnostics).sort((left, right) => left.diagnosticId.localeCompare(right.diagnosticId));
    const assessedConditions = route.conditions.filter((condition) => condition !== PSC_CONDITION.TRUST_OR_FIRM_CONDITION);
    const requiredSignoffIds = uniqueStrings([
      route.signoffId,
      ...basisRecords.flatMap(({ governance }) => governance?.requiredSignoffIds || []),
      ...unsupportedDiagnostics.flatMap(({ requiredSignoffs }) => requiredSignoffs || []),
    ]);
    const resultIdentity = {
      assessmentContractVersion: PSC_ATTRIBUTION_ASSESSMENT_VERSION,
      algorithmVersion: PSC_ATTRIBUTION_ALGORITHM,
      policyIdentity,
      graphReference,
      caseReference: caseReference || null,
      targetEntityId,
      basisIds: basisRecords.map(({ basisId }) => basisId),
      diagnosticIds: unsupportedDiagnostics.map(({ diagnosticId: id }) => id),
    };
    return deepFreeze(cloneData({
      assessmentContractVersion: PSC_ATTRIBUTION_ASSESSMENT_VERSION,
      algorithmVersion: PSC_ATTRIBUTION_ALGORITHM,
      assessmentId: `${PSC_ATTRIBUTION_ASSESSMENT_VERSION}:${digest(resultIdentity).slice(0, 32)}`,
      ...(caseReference === undefined ? {} : { caseReference }),
      policyIdentity,
      graphReference,
      targetEntity: { entityId: target.entityId, entityProfile: "COMPANY" },
      assessedRoutes: [QUALIFICATION_ROUTE.PSC_CONDITION_ATTRIBUTION],
      assessedConditions,
      unassessedConditions: [PSC_CONDITION.TRUST_OR_FIRM_CONDITION],
      assessedNaturalPersonIds: uniqueStrings(basisRecords.map(({ personEntityId }) => personEntityId)),
      basisRecords,
      satisfiedBasisIds: basisRecords.filter(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.SATISFIED).map(({ basisId }) => basisId),
      indeterminateBasisIds: basisRecords.filter(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE).map(({ basisId }) => basisId),
      reviewRequiredBasisIds: basisRecords.filter(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.REVIEW_REQUIRED).map(({ basisId }) => basisId),
      notSatisfiedBasisIds: basisRecords.filter(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.NOT_SATISFIED).map(({ basisId }) => basisId),
      unsupportedDiagnostics,
      scope: "ROUTE_SPECIFIC_NOT_FINAL_PERSON_DETERMINATION",
      governance: {
        governanceState: PSC_ATTRIBUTION_GOVERNANCE_STATE,
        policyStatus: policyPack.status,
        productionAuthorized: false,
        requiredSignoffIds,
      },
    }));
  } catch (error) {
    if (error instanceof CompanyPscAttributionError) throw error;
    attributionError(error.message, PSC_ATTRIBUTION_ERROR_CODE.INVALID_INPUT, undefined, error);
  }
}

module.exports = {
  PSC_ATTRIBUTION_ALGORITHM,
  PSC_ATTRIBUTION_ASSESSMENT_VERSION,
  PSC_ATTRIBUTION_ERROR_CODE,
  PSC_ATTRIBUTION_GOVERNANCE_STATE,
  PSC_ATTRIBUTION_METHOD_STATUS,
  PSC_CONDITION,
  CompanyPscAttributionError,
  assessCompanyPscAttributionV1,
};
