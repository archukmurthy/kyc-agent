"use strict";

const {
  APPLICABILITY_RESULT,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
} = require("../contracts/constants");
const { assertArray, assertDataOnly, assertNonEmptyString, assertPlainObject, cloneData, deepFreeze } = require("../internal/validation");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const { compare, decimalNumberToRational } = require("../domain/exactPercentage");
const { GRAPH_DIMENSION, TEMPORAL_STATE } = require("../domain/ownershipGraph");
const { CALCULATION_STATUS } = require("../domain/percentageCalculation");
const { validateOwnershipCase } = require("../domain/ownershipCase");
const { hashPolicyPack, validatePolicyPack } = require("./policyPack");
const {
  POLICY_TRUTH_VALUE,
  PolicyConfigurationError,
  evaluateConditionExpression,
} = require("./conditionEvaluator");

const POLICY_DETERMINATION_ALGORITHM = "ubo-policy-determination-v1";

const BASIS_ASSESSMENT_STATE = Object.freeze({
  SATISFIED: "SATISFIED",
  NOT_SATISFIED: "NOT_SATISFIED",
  INDETERMINATE: "INDETERMINATE",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
});

const BASIS_TYPE = Object.freeze({
  ECONOMIC_INTEREST: "ECONOMIC_INTEREST",
  INDIRECT_CALCULATION: "INDIRECT_CALCULATION",
  VOTING_CONTROL: "VOTING_CONTROL",
  APPOINTMENT_CONTROL: "APPOINTMENT_CONTROL",
  OTHER_SIGNIFICANT_CONTROL: "OTHER_SIGNIFICANT_CONTROL",
  TRUST_SPECIALIST: "TRUST_SPECIALIST",
});

const BASIS_ROLE = Object.freeze({
  [BASIS_TYPE.ECONOMIC_INTEREST]: "beneficial_owner",
  [BASIS_TYPE.VOTING_CONTROL]: "controller_voting",
  [BASIS_TYPE.APPOINTMENT_CONTROL]: "controller_appointment",
  [BASIS_TYPE.OTHER_SIGNIFICANT_CONTROL]: "controller_other_means",
});

function configurationError(message) {
  throw new PolicyConfigurationError(message);
}

function parameterValues(policyPack) {
  return Object.fromEntries(Object.entries(policyPack.parameters).map(([key, parameter]) => [key, cloneData(parameter.value)]));
}

function policyIdentity(loadedPolicyPack) {
  const { policyPack, identity } = loadedPolicyPack;
  return {
    policyPackId: policyPack.policyPackId,
    policyVersion: policyPack.version,
    policyHash: identity.hash,
    policySchemaVersion: policyPack.schemaVersion,
    determinationAlgorithm: POLICY_DETERMINATION_ALGORITHM,
  };
}

function evaluatePolicyApplicability(policyPack, caseContext) {
  const entityType = caseContext.entityType;
  if (typeof entityType !== "string" || entityType.trim() === "") {
    return deepFreeze({ status: APPLICABILITY_RESULT.UNKNOWN, rationaleCode: "ENTITY_TYPE_MISSING" });
  }
  if (policyPack.applicability.entityScope.includes(entityType)) {
    const profile = policyPack.entityProfiles[entityType];
    if (!profile) configurationError(`Applicable entity type ${entityType} has no entity profile`);
    return deepFreeze({
      status: APPLICABILITY_RESULT.APPLIES,
      entityType,
      entityProfile: profile.profile,
      rationaleCode: "ENTITY_TYPE_IN_POLICY_SCOPE",
    });
  }
  const route = policyPack.applicability.outOfScopeRoutes[entityType];
  if (route) {
    return deepFreeze({
      status: APPLICABILITY_RESULT.DOES_NOT_APPLY,
      entityType,
      route: route.route,
      routeUboApplicable: cloneData(route.uboApplicable),
      reason: route.reason,
      rationaleCode: "ENTITY_TYPE_ROUTED_OUT_OF_SCOPE",
    });
  }
  return deepFreeze({ status: APPLICABILITY_RESULT.UNKNOWN, entityType, rationaleCode: "ENTITY_TYPE_NOT_CONFIGURED" });
}

function truthToApplicability(truth) {
  if (truth === POLICY_TRUTH_VALUE.TRUE) return APPLICABILITY_RESULT.APPLIES;
  if (truth === POLICY_TRUTH_VALUE.FALSE) return APPLICABILITY_RESULT.DOES_NOT_APPLY;
  return APPLICABILITY_RESULT.UNKNOWN;
}

function evaluateRequirementApplicability(policyPack, packApplicability, conditionContext) {
  return policyPack.requirements.map((requirement) => {
    if (packApplicability.status !== APPLICABILITY_RESULT.APPLIES) {
      return {
        requirementId: requirement.requirementId,
        applicability: packApplicability.status === APPLICABILITY_RESULT.DOES_NOT_APPLY
          ? APPLICABILITY_RESULT.DOES_NOT_APPLY
          : APPLICABILITY_RESULT.UNKNOWN,
        conditionTruth: packApplicability.status === APPLICABILITY_RESULT.DOES_NOT_APPLY
          ? POLICY_TRUTH_VALUE.FALSE
          : POLICY_TRUTH_VALUE.UNKNOWN,
        rationaleCode: "POLICY_PACK_NOT_APPLICABLE_OR_UNKNOWN",
        basisAssessmentIds: [],
      };
    }
    const truth = evaluateConditionExpression(requirement.applicability.condition, conditionContext);
    return {
      requirementId: requirement.requirementId,
      applicability: truthToApplicability(truth),
      conditionTruth: truth,
      rationaleCode: "REQUIREMENT_CONDITION_EVALUATED",
      basisAssessmentIds: [],
    };
  });
}

function thresholdParameter(policyPack, requirementId) {
  const requirement = policyPack.requirements.find((item) => item.requirementId === requirementId);
  if (!requirement || !requirement.thresholdRef) configurationError(`${requirementId} has no threshold reference`);
  const parameter = policyPack.parameters[requirement.thresholdRef];
  if (!parameter) configurationError(`${requirementId} references missing threshold ${requirement.thresholdRef}`);
  if (parameter.unit !== "percent_exclusive" || typeof parameter.value !== "number") {
    configurationError(`${requirement.thresholdRef} must be a numeric percent_exclusive parameter`);
  }
  return { parameterRef: requirement.thresholdRef, parameter };
}

function exactOrRangeAssessment(value, threshold, complete) {
  const thresholdValue = decimalNumberToRational(threshold);
  if (value.type === PERCENTAGE_VALUE_TYPE.EXACT) {
    const comparison = compare(decimalNumberToRational(value.value), thresholdValue);
    if (comparison > 0) return { state: BASIS_ASSESSMENT_STATE.SATISFIED, rationaleCode: "EXACT_ABOVE_EXCLUSIVE_THRESHOLD" };
    if (complete) return { state: BASIS_ASSESSMENT_STATE.NOT_SATISFIED, rationaleCode: "COMPLETE_EXACT_NOT_ABOVE_EXCLUSIVE_THRESHOLD" };
    return { state: BASIS_ASSESSMENT_STATE.INDETERMINATE, rationaleCode: "PARTIAL_EXACT_NOT_YET_ABOVE_THRESHOLD" };
  }
  if (value.type !== PERCENTAGE_VALUE_TYPE.RANGE) configurationError(`Unsupported calculated percentage type ${value.type}`);
  const lowerComparison = compare(decimalNumberToRational(value.lowerBound), thresholdValue);
  const upperComparison = compare(decimalNumberToRational(value.upperBound), thresholdValue);
  const whollyAbove = lowerComparison > 0 || (lowerComparison === 0 && value.lowerInclusive === false);
  if (whollyAbove) return { state: BASIS_ASSESSMENT_STATE.SATISFIED, rationaleCode: "INTERVAL_WHOLELY_ABOVE_EXCLUSIVE_THRESHOLD" };
  const whollyNotAbove = upperComparison < 0 || upperComparison === 0;
  if (complete && whollyNotAbove) {
    return { state: BASIS_ASSESSMENT_STATE.NOT_SATISFIED, rationaleCode: "COMPLETE_INTERVAL_NOT_ABOVE_EXCLUSIVE_THRESHOLD" };
  }
  return { state: BASIS_ASSESSMENT_STATE.INDETERMINATE, rationaleCode: complete
    ? "INTERVAL_STRADDLES_EXCLUSIVE_THRESHOLD"
    : "PARTIAL_INTERVAL_NOT_YET_WHOLELY_ABOVE_THRESHOLD" };
}

function assessCalculationAgainstExclusiveThreshold(calculation, parameter) {
  if (parameter.unit !== "percent_exclusive" || typeof parameter.value !== "number") {
    configurationError("Threshold comparison requires a numeric percent_exclusive parameter");
  }
  if (calculation.status === CALCULATION_STATUS.NO_PATH) {
    return deepFreeze({ state: BASIS_ASSESSMENT_STATE.INDETERMINATE, rationaleCode: "NO_ESTABLISHED_PATH_IS_NOT_ZERO" });
  }
  if (!calculation.aggregateKnownValue) {
    return deepFreeze({ state: BASIS_ASSESSMENT_STATE.INDETERMINATE, rationaleCode: "NO_DEFENSIBLE_KNOWN_NUMERIC_CONTRIBUTION" });
  }
  const complete = calculation.status === CALCULATION_STATUS.COMPLETE;
  return deepFreeze(exactOrRangeAssessment(calculation.aggregateKnownValue, parameter.value, complete));
}

function requirementById(policyPack, requirementId) {
  const requirement = policyPack.requirements.find((item) => item.requirementId === requirementId);
  if (!requirement) configurationError(`Policy Pack is missing ${requirementId}`);
  return requirement;
}

function requirementApplies(requirementAssessments, requirementId) {
  return requirementAssessments.find((item) => item.requirementId === requirementId)?.applicability === APPLICABILITY_RESULT.APPLIES;
}

function entityById(caseState, entityId) {
  return caseState.canonicalEntities.find((entity) => entity.entityId === entityId);
}

function calculationReference(calculation) {
  return {
    calculationAlgorithm: calculation.calculationAlgorithm,
    graphVersion: calculation.graphVersion,
    subjectEntityId: calculation.subjectEntityId,
    targetEntityId: calculation.targetEntityId,
    dimension: calculation.dimension,
    status: calculation.status,
  };
}

function relationshipReferences(graph, relationshipIds) {
  return [...new Set(relationshipIds)].sort().map((relationshipId) => {
    const relationship = graph.relationships.find((item) => item.relationshipId === relationshipId);
    if (!relationship) configurationError(`Calculation references unknown graph relationship ${relationshipId}`);
    return { relationshipId, supportingClaimIds: cloneData(relationship.supportingClaimIds) };
  });
}

function calculationRelationships(calculation) {
  return [...calculation.knownPaths, ...calculation.unresolvedPaths]
    .flatMap((path) => path.relationshipIds);
}

function terminalConceptEstablished(graph, calculation, expectedConcept, dimension) {
  const paths = [...calculation.knownPaths, ...calculation.unresolvedPaths];
  if (paths.length === 0) return true;
  return paths.every((path) => {
    const terminalId = path.relationshipIds[path.relationshipIds.length - 1];
    const relationship = graph.relationships.find((item) => item.relationshipId === terminalId);
    if (!relationship) configurationError(`Calculation references unknown terminal relationship ${terminalId}`);
    if (dimension === GRAPH_DIMENSION.ECONOMIC) {
      return relationship.qualifiers?.economicInterestConcept === expectedConcept;
    }
    return expectedConcept === "VOTING_RIGHTS"
      || relationship.qualifiers?.votingConcept === expectedConcept;
  });
}

function makeCalculationBasis({
  policyPack,
  requirementAssessments,
  graph,
  caseState,
  calculation,
  requirementId,
  basisType,
  entityProfile,
  expectedConcept,
}) {
  if (!requirementApplies(requirementAssessments, requirementId)) return undefined;
  const holder = entityById(caseState, calculation.subjectEntityId);
  if (!holder) configurationError(`Calculation holder ${calculation.subjectEntityId} is not a canonical case entity`);
  const { parameterRef, parameter } = thresholdParameter(policyPack, requirementId);
  let assessment = assessCalculationAgainstExclusiveThreshold(calculation, parameter);
  if (!terminalConceptEstablished(graph, calculation, expectedConcept, calculation.dimension)) {
    assessment = { state: BASIS_ASSESSMENT_STATE.INDETERMINATE, rationaleCode: "ENTITY_PROFILE_CONCEPT_NOT_ESTABLISHED" };
  }
  const relationshipIds = calculationRelationships(calculation);
  const basis = {
    assessmentId: `${requirementId}:${basisType}:${calculation.subjectEntityId}`,
    requirementId,
    basisType,
    holderEntityId: calculation.subjectEntityId,
    holderCategory: holder.category,
    entityProfile,
    policyConcept: expectedConcept,
    state: assessment.state,
    rationaleCode: assessment.rationaleCode,
    threshold: { parameterRef, value: parameter.value, unit: parameter.unit },
    calculationReference: calculationReference(calculation),
    relationshipReferences: relationshipReferences(graph, relationshipIds),
  };
  if (assessment.state === BASIS_ASSESSMENT_STATE.SATISFIED && holder.category !== CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) {
    basis.holderResolution = "ULTIMATE_NATURAL_PERSON_UNRESOLVED";
  }
  return basis;
}

function indirectCalculationBasis(calculation, requirementAssessments) {
  if (!requirementApplies(requirementAssessments, "UBO-R02")) return undefined;
  const state = calculation.status === CALCULATION_STATUS.COMPLETE
    ? BASIS_ASSESSMENT_STATE.SATISFIED
    : BASIS_ASSESSMENT_STATE.INDETERMINATE;
  return {
    assessmentId: `UBO-R02:${BASIS_TYPE.INDIRECT_CALCULATION}:${calculation.subjectEntityId}:${calculation.dimension}`,
    requirementId: "UBO-R02",
    basisType: BASIS_TYPE.INDIRECT_CALCULATION,
    holderEntityId: calculation.subjectEntityId,
    state,
    rationaleCode: calculation.status === CALCULATION_STATUS.COMPLETE
      ? "PINNED_G2_2_CALCULATION_COMPLETE"
      : "PINNED_G2_2_CALCULATION_NOT_COMPLETE",
    calculationReference: calculationReference(calculation),
  };
}

function graphBasis({ graph, caseState, relationship, requirementId, basisType, state, rationaleCode, entityProfile }) {
  const holder = entityById(caseState, relationship.subjectEntityId);
  if (!holder) configurationError(`Relationship holder ${relationship.subjectEntityId} is not a canonical case entity`);
  const basis = {
    assessmentId: `${requirementId}:${basisType}:${relationship.relationshipId}`,
    requirementId,
    basisType,
    holderEntityId: holder.entityId,
    holderCategory: holder.category,
    entityProfile,
    state,
    rationaleCode,
    relationshipReferences: relationshipReferences(graph, [relationship.relationshipId]),
  };
  if (state === BASIS_ASSESSMENT_STATE.SATISFIED && holder.category !== CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) {
    basis.holderResolution = "ULTIMATE_NATURAL_PERSON_UNRESOLVED";
  }
  return basis;
}

function appointmentBases(policyPack, requirementAssessments, graph, caseState, entityProfile, targetEntityId) {
  if (!requirementApplies(requirementAssessments, "UBO-R05")) return [];
  const profile = Object.values(policyPack.entityProfiles).find((item) => item.profile === entityProfile);
  if (!profile) configurationError(`Missing entity-profile semantics for ${entityProfile}`);
  const types = new Set([
    RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT,
    RELATIONSHIP_TYPE.BOARD_REMOVAL_RIGHT,
    RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT,
  ]);
  return graph.relationships
    .filter((relationship) => relationship.objectEntityId === targetEntityId
      && types.has(relationship.relationshipType)
      && relationship.temporalState !== TEMPORAL_STATE.CEASED)
    .map((relationship) => {
      const qualifiers = relationship.qualifiers || {};
      const semanticMatch = qualifiers.entityProfile === entityProfile
        && qualifiers.controlConcept === profile.appointmentControlConcept
        && (qualifiers.managementBody === undefined || qualifiers.managementBody === profile.managementBody);
      let state = BASIS_ASSESSMENT_STATE.INDETERMINATE;
      let rationaleCode = semanticMatch ? "APPOINTMENT_SCOPE_NOT_ESTABLISHED" : "APPOINTMENT_PROFILE_SEMANTICS_NOT_ESTABLISHED";
      if (semanticMatch && qualifiers.scope === "MAJORITY") {
        state = BASIS_ASSESSMENT_STATE.SATISFIED;
        rationaleCode = "EXPLICIT_MAJORITY_APPOINTMENT_CONTROL";
      } else if (semanticMatch && typeof qualifiers.scope === "string") {
        state = BASIS_ASSESSMENT_STATE.NOT_SATISFIED;
        rationaleCode = "EXPLICIT_NON_MAJORITY_APPOINTMENT_SCOPE";
      }
      if (relationship.temporalState === TEMPORAL_STATE.UNKNOWN) {
        state = BASIS_ASSESSMENT_STATE.INDETERMINATE;
        rationaleCode = "APPOINTMENT_CURRENTNESS_UNKNOWN";
      }
      return graphBasis({ graph, caseState, relationship, requirementId: "UBO-R05", basisType: BASIS_TYPE.APPOINTMENT_CONTROL, state, rationaleCode, entityProfile });
    });
}

function otherControlBases(requirementAssessments, graph, caseState, entityProfile, targetEntityId) {
  if (!requirementApplies(requirementAssessments, "UBO-R06")) return [];
  return graph.relationships
    .filter((relationship) => relationship.objectEntityId === targetEntityId
      && relationship.relationshipType === RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL
      && relationship.temporalState !== TEMPORAL_STATE.CEASED)
    .map((relationship) => {
      const qualifiers = relationship.qualifiers || {};
      const ambiguous = typeof qualifiers.ambiguity === "string"
        || qualifiers.potential === true
        || qualifiers.deFacto === true
        || qualifiers.requiresInterpretation === true;
      let state = ambiguous ? BASIS_ASSESSMENT_STATE.REVIEW_REQUIRED : BASIS_ASSESSMENT_STATE.SATISFIED;
      let rationaleCode = ambiguous ? "CONTROL_FACT_REQUIRES_INTERPRETATION" : "EXPLICIT_SIGNIFICANT_CONTROL_FACT";
      if (relationship.temporalState === TEMPORAL_STATE.UNKNOWN) {
        state = BASIS_ASSESSMENT_STATE.INDETERMINATE;
        rationaleCode = "SIGNIFICANT_CONTROL_CURRENTNESS_UNKNOWN";
      }
      return graphBasis({ graph, caseState, relationship, requirementId: "UBO-R06", basisType: BASIS_TYPE.OTHER_SIGNIFICANT_CONTROL, state, rationaleCode, entityProfile });
    });
}

function trustBases(requirementAssessments, graph, caseState, entityProfile, targetEntityId) {
  if (!requirementApplies(requirementAssessments, "UBO-R11")) return [];
  const trustTypes = new Set([
    RELATIONSHIP_TYPE.TRUST_OWNERSHIP,
    RELATIONSHIP_TYPE.SETTLOR,
    RELATIONSHIP_TYPE.TRUSTEE,
    RELATIONSHIP_TYPE.PROTECTOR,
    RELATIONSHIP_TYPE.BENEFICIARY,
    RELATIONSHIP_TYPE.CONTROL_OVER_TRUST_OR_INTERMEDIARY,
  ]);
  return graph.relationships
    .filter((relationship) => trustTypes.has(relationship.relationshipType)
      && (relationship.objectEntityId === targetEntityId
        || entityById(caseState, relationship.objectEntityId)?.category === CANONICAL_ENTITY_CATEGORY.TRUST_OR_LEGAL_ARRANGEMENT))
    .map((relationship) => graphBasis({
      graph,
      caseState,
      relationship,
      requirementId: "UBO-R11",
      basisType: BASIS_TYPE.TRUST_SPECIALIST,
      state: BASIS_ASSESSMENT_STATE.INDETERMINATE,
      rationaleCode: "TRUST_SPECIALIST_RESOLUTION_REQUIRED",
      entityProfile,
    }));
}

function projectQualifyingPersons(policy, graph, basisAssessments, pinnedPolicyIdentity) {
  const approvedRoles = new Set(policy.roleProjection.roles.map(({ role }) => role));
  const people = new Map();
  basisAssessments
    .filter((basis) => basis.state === BASIS_ASSESSMENT_STATE.SATISFIED
      && basis.holderCategory === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON
      && BASIS_ROLE[basis.basisType])
    .forEach((basis) => {
      const role = BASIS_ROLE[basis.basisType];
      if (!approvedRoles.has(role)) configurationError(`Policy Pack does not project required role ${role}`);
      if (!people.has(basis.holderEntityId)) {
        people.set(basis.holderEntityId, { entityId: basis.holderEntityId, roles: new Set(), bases: [] });
      }
      const person = people.get(basis.holderEntityId);
      person.roles.add(role);
      person.bases.push({
        assessmentId: basis.assessmentId,
        requirementId: basis.requirementId,
        basisType: basis.basisType,
        role,
        rationaleCode: basis.rationaleCode,
        graphVersion: graph.graphVersion,
        ...(basis.calculationReference ? { calculationReference: cloneData(basis.calculationReference) } : {}),
        ...(basis.relationshipReferences ? { relationshipReferences: cloneData(basis.relationshipReferences) } : {}),
      });
    });
  return [...people.values()].map((person) => ({
    entityId: person.entityId,
    policyPackId: pinnedPolicyIdentity.policyPackId,
    policyVersion: pinnedPolicyIdentity.policyVersion,
    policyHash: pinnedPolicyIdentity.policyHash,
    roles: [...person.roles].sort(),
    bases: person.bases.sort((left, right) => left.assessmentId.localeCompare(right.assessmentId)),
  })).sort((left, right) => left.entityId.localeCompare(right.entityId));
}

function determinePolicyAssessment({
  loadedPolicyPack,
  caseContext,
  caseState,
  graph,
  calculations,
  facts = {},
  answers = {},
}) {
  assertPlainObject(loadedPolicyPack, "loadedPolicyPack");
  assertPlainObject(loadedPolicyPack.policyPack, "loadedPolicyPack.policyPack");
  assertPlainObject(loadedPolicyPack.identity, "loadedPolicyPack.identity");
  validatePolicyPack(loadedPolicyPack.policyPack);
  const actualPolicyHash = hashPolicyPack(loadedPolicyPack.policyPack);
  if (loadedPolicyPack.identity.hash !== actualPolicyHash) configurationError("Loaded Policy Pack hash is not pinned to its canonical content");
  if (loadedPolicyPack.identity.policyPackId !== loadedPolicyPack.policyPack.policyPackId
    || loadedPolicyPack.identity.version !== loadedPolicyPack.policyPack.version
    || loadedPolicyPack.identity.schemaVersion !== loadedPolicyPack.policyPack.schemaVersion) {
    configurationError("Loaded Policy Pack identity does not match its canonical content");
  }
  assertPlainObject(caseContext, "caseContext");
  assertDataOnly(caseContext, "caseContext");
  validateOwnershipCase(caseState);
  assertPlainObject(graph, "graph");
  assertArray(calculations, "calculations");
  calculations.forEach((calculation, index) => {
    assertPlainObject(calculation, `calculations[${index}]`);
    if (calculation.graphVersion !== graph.graphVersion) configurationError("Calculation graph version does not match policy graph");
  });
  if (graph.sourceCase.caseId !== caseState.caseId || graph.sourceCase.revisionId !== caseState.revisionId) {
    configurationError("Graph source case revision does not match the supplied OwnershipCase");
  }
  assertNonEmptyString(caseContext.subjectEntityId, "caseContext.subjectEntityId");
  if (!entityById(caseState, caseContext.subjectEntityId)) configurationError("Policy subject is not a canonical case entity");
  assertDataOnly(facts, "facts");
  assertDataOnly(answers, "answers");

  const policy = loadedPolicyPack.policyPack;
  const packApplicability = evaluatePolicyApplicability(policy, caseContext);
  const profile = packApplicability.entityProfile;
  const conditionContext = {
    case: { ...cloneData(caseContext), ...(profile ? { entity_profile: profile } : {}) },
    facts: cloneData(facts),
    answers: cloneData(answers),
    params: parameterValues(policy),
  };
  const requirementAssessments = evaluateRequirementApplicability(policy, packApplicability, conditionContext);
  const basisAssessments = [];

  if (packApplicability.status === APPLICABILITY_RESULT.APPLIES) {
    const profileConfig = policy.entityProfiles[caseContext.entityType];
    const r01 = requirementById(policy, "UBO-R01");
    calculations.forEach((calculation) => {
      if (calculation.targetEntityId !== caseContext.subjectEntityId) return;
      if (calculation.dimension === GRAPH_DIMENSION.ECONOMIC) {
        const basis = makeCalculationBasis({
          policyPack: policy,
          requirementAssessments,
          graph,
          caseState,
          calculation,
          requirementId: "UBO-R01",
          basisType: BASIS_TYPE.ECONOMIC_INTEREST,
          entityProfile: profile,
          expectedConcept: r01.entitySemantics[profile]?.concept,
        });
        if (basis) basisAssessments.push(basis);
      }
      if (calculation.dimension === GRAPH_DIMENSION.VOTING) {
        const basis = makeCalculationBasis({
          policyPack: policy,
          requirementAssessments,
          graph,
          caseState,
          calculation,
          requirementId: "UBO-R04",
          basisType: BASIS_TYPE.VOTING_CONTROL,
          entityProfile: profile,
          expectedConcept: profileConfig.votingConcept,
        });
        if (basis) basisAssessments.push(basis);
      }
      const indirect = indirectCalculationBasis(calculation, requirementAssessments);
      if (indirect) basisAssessments.push(indirect);
    });
    basisAssessments.push(...appointmentBases(policy, requirementAssessments, graph, caseState, profile, caseContext.subjectEntityId));
    basisAssessments.push(...otherControlBases(requirementAssessments, graph, caseState, profile, caseContext.subjectEntityId));
    basisAssessments.push(...trustBases(requirementAssessments, graph, caseState, profile, caseContext.subjectEntityId));
  }

  basisAssessments.sort((left, right) => left.assessmentId.localeCompare(right.assessmentId));
  const basisIdsByRequirement = new Map();
  basisAssessments.forEach((basis) => {
    if (!basisIdsByRequirement.has(basis.requirementId)) basisIdsByRequirement.set(basis.requirementId, []);
    basisIdsByRequirement.get(basis.requirementId).push(basis.assessmentId);
  });
  requirementAssessments.forEach((requirement) => {
    requirement.basisAssessmentIds = (basisIdsByRequirement.get(requirement.requirementId) || []).sort();
  });

  const pinnedPolicyIdentity = policyIdentity(loadedPolicyPack);
  const result = {
    policyIdentity: pinnedPolicyIdentity,
    policyApplicability: cloneData(packApplicability),
    graphVersion: graph.graphVersion,
    caseReference: { caseId: caseState.caseId, revisionId: caseState.revisionId },
    requirementAssessments,
    basisAssessments,
    qualifyingPersons: projectQualifyingPersons(policy, graph, basisAssessments, pinnedPolicyIdentity),
  };
  return deepFreeze(result);
}

module.exports = {
  BASIS_ASSESSMENT_STATE,
  BASIS_TYPE,
  POLICY_DETERMINATION_ALGORITHM,
  assessCalculationAgainstExclusiveThreshold,
  determinePolicyAssessment,
  evaluatePolicyApplicability,
  evaluateRequirementApplicability,
};
