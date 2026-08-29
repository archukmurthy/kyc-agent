"use strict";

const {
  APPLICABILITY_RESULT,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  CLAIM_STATE,
  IDENTITY_RESOLUTION_STATUS,
  RELATIONSHIP_TYPE,
  REQUIREMENT_STATE,
} = require("../contracts/constants");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const { CALCULATION_STATUS } = require("../domain/percentageCalculation");
const { validateOwnershipCase } = require("../domain/ownershipCase");
const {
  INFORMATION_NEED_CONCEPT,
  INFORMATION_NEED_STATE,
  createOperationalBlockers,
  createPolicyGap,
  reconcileInformationNeeds,
} = require("../domain/resolutionArtifacts");
const {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
  fail,
} = require("../internal/validation");
const { canonicalizeJson } = require("./canonicalJson");
const { POLICY_TRUTH_VALUE, evaluateConditionExpression } = require("./conditionEvaluator");
const {
  EVIDENCE_SUFFICIENCY_STATUS,
  EVIDENCE_SUPPORT_DIRECTION,
  assessEvidenceSufficiency,
  validateEvidencePolicyClassification,
} = require("./evidencePolicy");
const { hashPolicyPack, validatePolicyPack } = require("./policyPack");
const { BASIS_ASSESSMENT_STATE, BASIS_TYPE, POLICY_DETERMINATION_ALGORITHM } = require("./policyDetermination");

const REQUIREMENT_RESOLUTION_ALGORITHM = "ubo-requirement-resolution-v1";

const DEFERRED_REQUIREMENTS = new Set(["UBO-R09", "UBO-R10", "UBO-R13", "UBO-R14"]);

function validateTimestamp(value, path) {
  assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(value))) fail(`${path} must be an ISO-compatible timestamp`);
}

function policyIdentity(loadedPolicyPack) {
  assertPlainObject(loadedPolicyPack, "loadedPolicyPack");
  validatePolicyPack(loadedPolicyPack.policyPack);
  const hash = hashPolicyPack(loadedPolicyPack.policyPack);
  if (loadedPolicyPack.identity?.hash !== hash
    || loadedPolicyPack.identity.policyPackId !== loadedPolicyPack.policyPack.policyPackId
    || loadedPolicyPack.identity.version !== loadedPolicyPack.policyPack.version
    || loadedPolicyPack.identity.schemaVersion !== loadedPolicyPack.policyPack.schemaVersion) {
    fail("loaded Policy Pack identity does not match canonical content", "POLICY_CONFIGURATION_ERROR");
  }
  return {
    policyPackId: loadedPolicyPack.policyPack.policyPackId,
    policyVersion: loadedPolicyPack.policyPack.version,
    policyHash: hash,
    policySchemaVersion: loadedPolicyPack.policyPack.schemaVersion,
    requirementResolutionAlgorithm: REQUIREMENT_RESOLUTION_ALGORITHM,
  };
}

function uniqueSorted(values) {
  return [...new Set(values || [])].sort();
}

function uniqueData(values) {
  const map = new Map();
  (values || []).forEach((value) => map.set(canonicalizeJson(value), cloneData(value)));
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}

function parameterValues(policyPack) {
  return Object.fromEntries(Object.entries(policyPack.parameters).map(([key, parameter]) => [key, cloneData(parameter.value)]));
}

function requirementAssessment(policyAssessment, requirementId) {
  const assessment = policyAssessment.requirementAssessments.find((item) => item.requirementId === requirementId);
  if (!assessment) fail(`G2.3 policy assessment is missing ${requirementId}`);
  return assessment;
}

function basesFor(policyAssessment, requirementId) {
  return policyAssessment.basisAssessments.filter((basis) => basis.requirementId === requirementId);
}

function basisClaimIds(basis) {
  return uniqueSorted((basis.relationshipReferences || []).flatMap(({ supportingClaimIds }) => supportingClaimIds || []));
}

function basisRelationshipIds(basis) {
  return uniqueSorted((basis.relationshipReferences || []).map(({ relationshipId }) => relationshipId));
}

function classificationSupportsRequirement(classification, requirementId) {
  return classification.supports.some((support) => support.requirementId === requirementId);
}

function evidenceReferencesFor(classifications, requirementId) {
  return uniqueData(classifications
    .filter((classification) => classificationSupportsRequirement(classification, requirementId))
    .map(({ evidenceReference }) => evidenceReference));
}

function permittedStrategies(requirement, conditionContext) {
  return uniqueSorted(requirement.resolutionStrategies
    .filter((strategy) => !strategy.condition
      || evaluateConditionExpression(strategy.condition, conditionContext) === POLICY_TRUTH_VALUE.TRUE)
    .map(({ strategy }) => strategy));
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

function emptySufficiency(requirementId, status, reasonCode) {
  return {
    requirementId,
    status,
    consideredEvidence: [],
    distinctEligibleSourceIds: [],
    distinctIndependentSourceIds: [],
    reasonCodes: [reasonCode],
  };
}

function latestIdentityDecision(caseState, candidatePartyKey) {
  return [...caseState.identityDecisions].reverse()
    .find((decision) => decision.candidatePartyKey === candidatePartyKey);
}

function resolvedAttributeClaims(caseState, entityId) {
  return caseState.candidateClaims.filter((claim) => {
    if (claim.claimType !== CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE || claim.status !== CLAIM_STATE.OPERATIVE) return false;
    const decision = latestIdentityDecision(caseState, claim.subject.candidatePartyKey);
    return decision?.status === IDENTITY_RESOLUTION_STATUS.RESOLVED && decision.entityId === entityId;
  });
}

function relevantEvidenceSufficiency(context, requirementId, direction, supportFilter, independentCorroboration = false) {
  return assessEvidenceSufficiency({
    loadedPolicyPack: context.loadedPolicyPack,
    caseState: context.caseState,
    requirementId,
    classifications: context.evidenceClassifications,
    conditionContext: context.conditionContext,
    evaluationDate: context.evaluationDate,
    riskLevel: context.caseContext.riskLevel,
    direction,
    supportFilter,
    independentCorroboration,
  });
}

function sufficiencyForBasis(context, basis, direction = EVIDENCE_SUPPORT_DIRECTION.POSITIVE) {
  const claims = new Set(basisClaimIds(basis));
  return relevantEvidenceSufficiency(context, basis.requirementId, direction, (support) => {
    if ((support.basisAssessmentIds || []).includes(basis.assessmentId)) return true;
    if ((support.claimIds || []).some((claimId) => claims.has(claimId))) return true;
    return support.subjectEntityId === basis.holderEntityId;
  });
}

function makeNeed(context, requirementId, concept, reasonCode, target = {}, references = {}) {
  const requirement = context.policyPack.requirements.find((item) => item.requirementId === requirementId);
  return {
    ...(target.subjectEntityId ? { subjectEntityId: target.subjectEntityId } : {}),
    requiredBy: [requirementId],
    concept,
    ...(target.relationshipId ? { relationshipId: target.relationshipId } : {}),
    ...(target.attribute ? { attribute: target.attribute } : {}),
    reasonCodes: [reasonCode],
    claimIds: uniqueSorted(references.claimIds),
    calculationReferences: uniqueData(references.calculationReferences),
    conflictReferences: uniqueSorted(references.conflictReferences),
    existingEvidenceReferences: evidenceReferencesFor(context.evidenceClassifications, requirementId),
    permittedResolutionStrategies: permittedStrategies(requirement, context.conditionContext),
  };
}

function calculationNeeds(context, requirementId, calculations) {
  const needs = [];
  calculations.filter(({ status }) => status !== CALCULATION_STATUS.COMPLETE).forEach((calculation) => {
    const relationshipIds = uniqueSorted([
      ...(calculation.unresolvedPaths || []).flatMap((path) => path.relationshipIds || []),
      ...(calculation.cycles || []).flatMap((cycle) => cycle.relationshipIds || []),
    ]);
    if (relationshipIds.length === 0) {
      needs.push(makeNeed(context, requirementId, INFORMATION_NEED_CONCEPT.PERCENTAGE_OR_RANGE,
        calculation.status === CALCULATION_STATUS.NO_PATH ? "NO_ESTABLISHED_PATH_IS_NOT_NEGATIVE_PROOF" : "CALCULATION_NOT_COMPLETE",
        { subjectEntityId: calculation.subjectEntityId },
        { calculationReferences: [calculationReference(calculation)] }));
    } else {
      relationshipIds.forEach((relationshipId) => needs.push(makeNeed(context, requirementId,
        INFORMATION_NEED_CONCEPT.PERCENTAGE_OR_RANGE, "RELATIONSHIP_VALUE_REQUIRED_FOR_COMPLETE_CALCULATION",
        { relationshipId }, { calculationReferences: [calculationReference(calculation)] })));
    }
  });
  return needs;
}

function resolveR01(context) {
  const bases = basesFor(context.policyAssessment, "UBO-R01");
  const needs = [];
  const sufficiency = [];
  bases.filter(({ state }) => state === BASIS_ASSESSMENT_STATE.SATISFIED || state === BASIS_ASSESSMENT_STATE.INDETERMINATE)
    .forEach((basis) => {
      if (basis.holderCategory !== CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) {
        needs.push(makeNeed(context, "UBO-R01", INFORMATION_NEED_CONCEPT.CURRENT_OWNERSHIP_AND_CONTROL,
          "POTENTIALLY_QUALIFYING_LEGAL_ENTITY_NOT_RESOLVED_TO_NATURAL_PERSONS",
          { subjectEntityId: basis.holderEntityId },
          { claimIds: basisClaimIds(basis), calculationReferences: basis.calculationReference ? [basis.calculationReference] : [] }));
      } else if (basis.state === BASIS_ASSESSMENT_STATE.INDETERMINATE) {
        needs.push(makeNeed(context, "UBO-R01", INFORMATION_NEED_CONCEPT.PERCENTAGE_OR_RANGE,
          "ECONOMIC_QUALIFICATION_INDETERMINATE", { subjectEntityId: basis.holderEntityId },
          { claimIds: basisClaimIds(basis), calculationReferences: basis.calculationReference ? [basis.calculationReference] : [] }));
      } else {
        sufficiency.push({ assessmentId: basis.assessmentId, result: sufficiencyForBasis(context, basis) });
      }
    });
  const positive = bases.filter(({ state, holderCategory }) => state === BASIS_ASSESSMENT_STATE.SATISFIED
    && holderCategory === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON);
  if (needs.length === 0 && positive.length > 0
    && sufficiency.every(({ result }) => result.status === EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT)) {
    return { status: REQUIREMENT_STATE.RESOLVED, reasonCode: "ALL_QUALIFYING_ECONOMIC_HOLDERS_NATURAL_AND_EVIDENCED", resolvingMethod: "POLICY_BASIS_AND_EVIDENCE", needs, evidenceSufficiency: { status: EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT, basisAssessments: sufficiency } };
  }
  sufficiency.filter(({ result }) => result.status !== EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT).forEach(({ assessmentId }) => {
    const basis = bases.find((candidate) => candidate.assessmentId === assessmentId);
    needs.push(makeNeed(context, "UBO-R01", INFORMATION_NEED_CONCEPT.RELATIONSHIP_EVIDENCE,
      "QUALIFYING_ECONOMIC_BASIS_NOT_SUFFICIENTLY_EVIDENCED", { subjectEntityId: basis.holderEntityId }, { claimIds: basisClaimIds(basis) }));
  });
  if (needs.length === 0) {
    const negative = relevantEvidenceSufficiency(context, "UBO-R01", EVIDENCE_SUPPORT_DIRECTION.NEGATIVE, () => true);
    const completeNegative = bases.length > 0 && bases.every(({ state }) => state === BASIS_ASSESSMENT_STATE.NOT_SATISFIED);
    if (completeNegative && negative.status === EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT) {
      return { status: REQUIREMENT_STATE.RESOLVED, reasonCode: "COMPLETE_EVIDENCED_ECONOMIC_STRUCTURE_HAS_NO_QUALIFYING_PERSON", resolvingMethod: "POLICY_BASIS_AND_NEGATIVE_EVIDENCE", needs: [], evidenceSufficiency: negative };
    }
    needs.push(makeNeed(context, "UBO-R01", INFORMATION_NEED_CONCEPT.PERCENTAGE_OR_RANGE,
      "ULTIMATE_ECONOMIC_INTEREST_NOT_ESTABLISHED", { subjectEntityId: context.caseContext.subjectEntityId }));
  }
  return { status: REQUIREMENT_STATE.GAP, reasonCode: "SUBSTANTIVE_ECONOMIC_FACT_OR_EVIDENCE_MISSING", needs, evidenceSufficiency: { status: EVIDENCE_SUFFICIENCY_STATUS.INSUFFICIENT, basisAssessments: sufficiency } };
}

function resolveR02(context) {
  const bases = basesFor(context.policyAssessment, "UBO-R02");
  const relevant = context.calculations.filter(({ targetEntityId }) => targetEntityId === context.caseContext.subjectEntityId);
  if (bases.length > 0 && relevant.length > 0 && relevant.every(({ status }) => status === CALCULATION_STATUS.COMPLETE)) {
    return { status: REQUIREMENT_STATE.RESOLVED, reasonCode: "PINNED_G2_2_CALCULATIONS_COMPLETE", resolvingMethod: "DETERMINISTIC_CALCULATION", needs: [], evidenceSufficiency: emptySufficiency("UBO-R02", EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT, "CALCULATION_ONLY_REQUIREMENT") };
  }
  const needs = calculationNeeds(context, "UBO-R02", relevant);
  if (needs.length === 0) needs.push(makeNeed(context, "UBO-R02", INFORMATION_NEED_CONCEPT.PERCENTAGE_OR_RANGE,
    "RELEVANT_INDIRECT_CALCULATION_MISSING", { subjectEntityId: context.caseContext.subjectEntityId }));
  return { status: REQUIREMENT_STATE.GAP, reasonCode: "DETERMINISTIC_CALCULATION_INCOMPLETE", needs, evidenceSufficiency: emptySufficiency("UBO-R02", EVIDENCE_SUFFICIENCY_STATUS.INSUFFICIENT, "CALCULATION_NOT_COMPLETE") };
}

function materialChainTargets(context) {
  const relationshipIds = new Set();
  const intermediateEntityIds = new Set();
  context.calculations.filter(({ targetEntityId }) => targetEntityId === context.caseContext.subjectEntityId)
    .flatMap((calculation) => [...(calculation.knownPaths || []), ...(calculation.unresolvedPaths || [])])
    .forEach((path) => {
      const ids = path.relationshipIds || [];
      ids.forEach((id) => relationshipIds.add(id));
      ids.slice(0, -1).forEach((id) => {
        const relationship = context.graph.relationships.find(({ relationshipId }) => relationshipId === id);
        if (relationship) intermediateEntityIds.add(relationship.objectEntityId);
      });
    });
  return { relationshipIds: [...relationshipIds].sort(), intermediateEntityIds: [...intermediateEntityIds].sort() };
}

function resolveR03(context) {
  const targets = materialChainTargets(context);
  const needs = [];
  const assessments = [];
  targets.intermediateEntityIds.forEach((entityId) => {
    const result = relevantEvidenceSufficiency(context, "UBO-R03", EVIDENCE_SUPPORT_DIRECTION.POSITIVE,
      (support) => support.concept === INFORMATION_NEED_CONCEPT.ENTITY_EXISTENCE && support.subjectEntityId === entityId);
    assessments.push({ target: { concept: INFORMATION_NEED_CONCEPT.ENTITY_EXISTENCE, subjectEntityId: entityId }, result });
    if (result.status !== EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT) needs.push(makeNeed(context, "UBO-R03",
      INFORMATION_NEED_CONCEPT.ENTITY_EXISTENCE, "INTERMEDIATE_ENTITY_EXISTENCE_NOT_SUFFICIENTLY_EVIDENCED", { subjectEntityId: entityId }));
  });
  targets.relationshipIds.forEach((relationshipId) => {
    const result = relevantEvidenceSufficiency(context, "UBO-R03", EVIDENCE_SUPPORT_DIRECTION.POSITIVE,
      (support) => support.concept === INFORMATION_NEED_CONCEPT.RELATIONSHIP_EVIDENCE && support.relationshipId === relationshipId);
    assessments.push({ target: { concept: INFORMATION_NEED_CONCEPT.RELATIONSHIP_EVIDENCE, relationshipId }, result });
    if (result.status !== EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT) needs.push(makeNeed(context, "UBO-R03",
      INFORMATION_NEED_CONCEPT.RELATIONSHIP_EVIDENCE, "CHAIN_RELATIONSHIP_NOT_SUFFICIENTLY_EVIDENCED", { relationshipId }));
  });
  if (targets.intermediateEntityIds.length === 0 || targets.relationshipIds.length === 0) {
    needs.push(makeNeed(context, "UBO-R03", INFORMATION_NEED_CONCEPT.CURRENT_OWNERSHIP_AND_CONTROL,
      "MATERIAL_INTERMEDIATE_CHAIN_NOT_ESTABLISHED", { subjectEntityId: context.caseContext.subjectEntityId }));
  }
  return needs.length === 0
    ? { status: REQUIREMENT_STATE.RESOLVED, reasonCode: "INTERMEDIATE_EXISTENCE_AND_RELATIONSHIPS_SEPARATELY_EVIDENCED", resolvingMethod: "OPERATIVE_GRAPH_AND_EVIDENCE", needs, evidenceSufficiency: { status: EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT, targetAssessments: assessments } }
    : { status: REQUIREMENT_STATE.GAP, reasonCode: "INTERMEDIATE_ENTITY_OR_RELATIONSHIP_EVIDENCE_MISSING", needs, evidenceSufficiency: { status: EVIDENCE_SUFFICIENCY_STATUS.INSUFFICIENT, targetAssessments: assessments } };
}

function resolveControlRequirement(context, requirementId, concept) {
  const bases = basesFor(context.policyAssessment, requirementId);
  const needs = [];
  const sufficiency = [];
  bases.forEach((basis) => {
    if (basis.state === BASIS_ASSESSMENT_STATE.SATISFIED && basis.holderCategory !== CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) {
      needs.push(makeNeed(context, requirementId, INFORMATION_NEED_CONCEPT.CURRENT_OWNERSHIP_AND_CONTROL,
        "QUALIFYING_CONTROL_HELD_BY_UNRESOLVED_LEGAL_ENTITY", { subjectEntityId: basis.holderEntityId }, { claimIds: basisClaimIds(basis) }));
    } else if (basis.state === BASIS_ASSESSMENT_STATE.INDETERMINATE) {
      needs.push(makeNeed(context, requirementId, concept, "CONTROL_BASIS_NOT_DETERMINATELY_ESTABLISHED",
        { subjectEntityId: basis.holderEntityId }, { claimIds: basisClaimIds(basis) }));
    } else if (basis.state === BASIS_ASSESSMENT_STATE.SATISFIED) {
      sufficiency.push({ assessmentId: basis.assessmentId, result: sufficiencyForBasis(context, basis) });
    }
  });
  sufficiency.filter(({ result }) => result.status !== EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT).forEach(({ assessmentId }) => {
    const basis = bases.find((candidate) => candidate.assessmentId === assessmentId);
    needs.push(makeNeed(context, requirementId, concept, "QUALIFYING_CONTROL_BASIS_NOT_SUFFICIENTLY_EVIDENCED",
      { subjectEntityId: basis.holderEntityId }, { claimIds: basisClaimIds(basis) }));
  });
  const positive = bases.filter(({ state, holderCategory }) => state === BASIS_ASSESSMENT_STATE.SATISFIED
    && holderCategory === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON);
  if (needs.length === 0 && positive.length > 0
    && sufficiency.every(({ result }) => result.status === EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT)) {
    return { status: REQUIREMENT_STATE.RESOLVED, reasonCode: "QUALIFYING_CONTROL_BASES_NATURAL_AND_EVIDENCED", resolvingMethod: "POLICY_BASIS_AND_EVIDENCE", needs, evidenceSufficiency: { status: EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT, basisAssessments: sufficiency } };
  }
  if (needs.length === 0) {
    const negative = relevantEvidenceSufficiency(context, requirementId, EVIDENCE_SUPPORT_DIRECTION.NEGATIVE, () => true);
    if (negative.status === EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT) {
      return { status: REQUIREMENT_STATE.RESOLVED, reasonCode: "EXPLICIT_POLICY_PERMITTED_NEGATIVE_EVIDENCE", resolvingMethod: "NEGATIVE_EVIDENCE", needs: [], evidenceSufficiency: negative };
    }
    needs.push(makeNeed(context, requirementId, concept, "CONTROL_FACT_OR_PERMITTED_NEGATIVE_EVIDENCE_MISSING",
      { subjectEntityId: context.caseContext.subjectEntityId }));
  }
  return { status: REQUIREMENT_STATE.GAP, reasonCode: "SUBSTANTIVE_CONTROL_FACT_OR_EVIDENCE_MISSING", needs, evidenceSufficiency: { status: EVIDENCE_SUFFICIENCY_STATUS.INSUFFICIENT, basisAssessments: sufficiency } };
}

const IDENTITY_ATTRIBUTE_MAP = Object.freeze({
  full_legal_name: "full_legal_name",
  date_of_birth: "date_of_birth",
  date_of_birth_if_available_or_required: "date_of_birth",
  nationality: "nationality",
  nationality_if_available_or_required: "nationality",
  country_of_residence: "country_of_residence",
  country_of_residence_if_available_or_required: "country_of_residence",
  ownership_or_control_basis: "ownership_or_control_basis",
});

function resolveR07(context) {
  const policyAttributes = new Set(context.policyPack.requirements.find(({ requirementId }) => requirementId === "UBO-R07").minimumIdentityAttributes);
  const requested = context.caseContext.requiredIdentityAttributes || ["full_legal_name", "ownership_or_control_basis"];
  assertArray(requested, "caseContext.requiredIdentityAttributes");
  const required = uniqueSorted(requested.map((attribute) => {
    assertNonEmptyString(attribute, "caseContext.requiredIdentityAttributes[]");
    const mapped = IDENTITY_ATTRIBUTE_MAP[attribute];
    if (!mapped || (!policyAttributes.has(attribute) && !["date_of_birth", "nationality", "country_of_residence"].includes(attribute))) {
      fail(`identity attribute ${attribute} is not configured by UBO-R07`);
    }
    return mapped;
  }));
  const needs = [];
  const operativeClaimIds = [];
  context.policyAssessment.qualifyingPersons.forEach((person) => {
    const entity = context.caseState.canonicalEntities.find(({ entityId }) => entityId === person.entityId);
    const claims = resolvedAttributeClaims(context.caseState, person.entityId);
    const known = new Set(claims.filter(({ value }) => value !== null && value !== "").map(({ attribute }) => IDENTITY_ATTRIBUTE_MAP[attribute] || attribute));
    claims.forEach(({ claimId }) => operativeClaimIds.push(claimId));
    if (entity?.primaryName) known.add("full_legal_name");
    if (person.roles.length > 0 && person.bases.length > 0) known.add("ownership_or_control_basis");
    required.filter((attribute) => !known.has(attribute)).forEach((attribute) => {
      needs.push(makeNeed(context, "UBO-R07", INFORMATION_NEED_CONCEPT.IDENTITY_ATTRIBUTE,
        "QUALIFYING_PERSON_IDENTITY_ATTRIBUTE_MISSING", { subjectEntityId: person.entityId, attribute }, { claimIds: claims.map(({ claimId }) => claimId) }));
    });
  });
  if (context.policyAssessment.qualifyingPersons.length === 0) {
    needs.push(makeNeed(context, "UBO-R07", INFORMATION_NEED_CONCEPT.IDENTITY_ATTRIBUTE,
      "QUALIFYING_PERSON_SET_NOT_AVAILABLE", { subjectEntityId: context.caseContext.subjectEntityId }));
  }
  return needs.length === 0
    ? { status: REQUIREMENT_STATE.RESOLVED, reasonCode: "MINIMUM_CONFIGURED_IDENTITY_ATTRIBUTES_PRESENT", resolvingMethod: "CANONICAL_ENTITY_AND_OPERATIVE_ATTRIBUTE_CLAIMS", needs, operativeClaimIds, evidenceSufficiency: emptySufficiency("UBO-R07", EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT, "IDENTITY_FACT_PRESENCE_ONLY_NO_IDV") }
    : { status: REQUIREMENT_STATE.GAP, reasonCode: "REQUIRED_IDENTITY_ATTRIBUTE_MISSING", needs, operativeClaimIds, evidenceSufficiency: emptySufficiency("UBO-R07", EVIDENCE_SUFFICIENCY_STATUS.INSUFFICIENT, "IDENTITY_ATTRIBUTE_MISSING") };
}

function resolveR08(context) {
  const sufficiency = relevantEvidenceSufficiency(context, "UBO-R08", EVIDENCE_SUPPORT_DIRECTION.POSITIVE, () => true, true);
  if (sufficiency.status === EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT) {
    return { status: REQUIREMENT_STATE.RESOLVED, reasonCode: "DISTINCT_INDEPENDENT_CORROBORATION_COUNT_SATISFIED", resolvingMethod: "INDEPENDENT_EVIDENCE_CORROBORATION", needs: [], evidenceSufficiency: sufficiency };
  }
  return {
    status: REQUIREMENT_STATE.GAP,
    reasonCode: "INDEPENDENT_CORROBORATION_MISSING",
    needs: [makeNeed(context, "UBO-R08", INFORMATION_NEED_CONCEPT.INDEPENDENT_CORROBORATION,
      "DISTINCT_INDEPENDENT_SOURCE_COUNT_BELOW_POLICY_MINIMUM", { subjectEntityId: context.caseContext.subjectEntityId })],
    evidenceSufficiency: sufficiency,
  };
}

function trustPresent(context) {
  const trustTypes = new Set([
    RELATIONSHIP_TYPE.TRUST_OWNERSHIP,
    RELATIONSHIP_TYPE.SETTLOR,
    RELATIONSHIP_TYPE.TRUSTEE,
    RELATIONSHIP_TYPE.PROTECTOR,
    RELATIONSHIP_TYPE.BENEFICIARY,
    RELATIONSHIP_TYPE.CONTROL_OVER_TRUST_OR_INTERMEDIARY,
  ]);
  return context.caseState.canonicalEntities.some(({ category }) => category === CANONICAL_ENTITY_CATEGORY.TRUST_OR_LEGAL_ARRANGEMENT)
    || context.graph.relationships.some(({ relationshipType }) => trustTypes.has(relationshipType));
}

function resolveR11(context) {
  if (trustPresent(context)) {
    return { status: REQUIREMENT_STATE.REVIEW_REQUIRED, reasonCode: "TRUST_SPECIALIST_INTERPRETATION_REQUIRED", resolvingMethod: undefined, needs: [], reviewReferences: basesFor(context.policyAssessment, "UBO-R11").map(({ assessmentId }) => assessmentId), evidenceSufficiency: emptySufficiency("UBO-R11", EVIDENCE_SUFFICIENCY_STATUS.INDETERMINATE, "TRUST_SPECIALIST_SCOPE") };
  }
  if (context.facts.trust_in_chain === false) {
    return { status: REQUIREMENT_STATE.RESOLVED, reasonCode: "EXPLICIT_CURRENT_STRUCTURE_FACT_ESTABLISHES_NO_TRUST", resolvingMethod: "EXPLICIT_OPERATIVE_FACT", needs: [], evidenceSufficiency: emptySufficiency("UBO-R11", EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT, "EXPLICIT_NEGATIVE_FACT") };
  }
  return { status: REQUIREMENT_STATE.GAP, reasonCode: "TRUST_INVOLVEMENT_NOT_ESTABLISHED", needs: [makeNeed(context, "UBO-R11", INFORMATION_NEED_CONCEPT.TRUST_INVOLVEMENT,
    "INCOMPLETE_STRUCTURE_CANNOT_PROVE_ABSENCE_OF_TRUST", { subjectEntityId: context.caseContext.subjectEntityId })], evidenceSufficiency: emptySufficiency("UBO-R11", EVIDENCE_SUFFICIENCY_STATUS.INSUFFICIENT, "TRUST_STATUS_MISSING") };
}

function nomineeFacts(context) {
  const claims = context.caseState.candidateClaims.filter(({ status }) => status === CLAIM_STATE.OPERATIVE);
  const positive = [];
  let bearer = context.facts.bearer_shares === true || context.answers.DISCLOSE_NOMINEE_OR_BEARER_ARRANGEMENT === "bearer";
  claims.forEach((claim) => {
    if (claim.claimType === CANDIDATE_FACT_TYPE.RELATIONSHIP && claim.qualifiers?.nominee === true) {
      const decision = latestIdentityDecision(context.caseState, claim.subject.candidatePartyKey);
      positive.push({ claimId: claim.claimId, subjectEntityId: decision?.entityId, principalEntityId: claim.qualifiers.underlyingPrincipalEntityId });
    }
    if (claim.claimType === CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE && claim.attribute === "nominee_arrangement" && claim.value === true) {
      const decision = latestIdentityDecision(context.caseState, claim.subject.candidatePartyKey);
      positive.push({ claimId: claim.claimId, subjectEntityId: decision?.entityId });
    }
    if (claim.claimType === CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE && claim.attribute === "bearer_shares" && claim.value === true) bearer = true;
  });
  return { positive, bearer };
}

function resolveR12(context) {
  const { positive, bearer } = nomineeFacts(context);
  if (bearer) {
    return { status: REQUIREMENT_STATE.REVIEW_REQUIRED, reasonCode: "BEARER_SHARE_ACCEPTANCE_POLICY_OUTSIDE_G2_4A", needs: [], reviewReferences: [], evidenceSufficiency: emptySufficiency("UBO-R12", EVIDENCE_SUFFICIENCY_STATUS.INDETERMINATE, "WIDER_ACCEPTANCE_POLICY_REQUIRED") };
  }
  if (positive.length > 0) {
    const unresolved = positive.filter(({ principalEntityId }) => {
      const principal = context.caseState.canonicalEntities.find(({ entityId }) => entityId === principalEntityId);
      return principal?.category !== CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON;
    });
    if (unresolved.length > 0) {
      return { status: REQUIREMENT_STATE.GAP, reasonCode: "UNDERLYING_NOMINEE_PRINCIPAL_NOT_ESTABLISHED", needs: unresolved.map((fact) => makeNeed(context, "UBO-R12", INFORMATION_NEED_CONCEPT.UNDERLYING_NOMINEE_PRINCIPAL,
        "NOMINEE_HOLDER_REQUIRES_UNDERLYING_NATURAL_PERSON", { subjectEntityId: fact.subjectEntityId || context.caseContext.subjectEntityId }, { claimIds: [fact.claimId] })), evidenceSufficiency: emptySufficiency("UBO-R12", EVIDENCE_SUFFICIENCY_STATUS.INSUFFICIENT, "UNDERLYING_PRINCIPAL_MISSING") };
    }
    const positiveEvidence = relevantEvidenceSufficiency(context, "UBO-R12", EVIDENCE_SUPPORT_DIRECTION.POSITIVE, () => true);
    return positiveEvidence.status === EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT
      ? { status: REQUIREMENT_STATE.RESOLVED, reasonCode: "NOMINEE_ARRANGEMENT_AND_PRINCIPAL_EXPLICITLY_ESTABLISHED", resolvingMethod: "EXPLICIT_FACT_AND_EVIDENCE", needs: [], evidenceSufficiency: positiveEvidence }
      : { status: REQUIREMENT_STATE.GAP, reasonCode: "NOMINEE_FACT_EVIDENCE_INSUFFICIENT", needs: [makeNeed(context, "UBO-R12", INFORMATION_NEED_CONCEPT.RELATIONSHIP_EVIDENCE,
        "NOMINEE_RELATIONSHIP_NOT_SUFFICIENTLY_EVIDENCED", { subjectEntityId: positive[0].subjectEntityId || context.caseContext.subjectEntityId }, { claimIds: positive.map(({ claimId }) => claimId) })], evidenceSufficiency: positiveEvidence };
  }
  const explicitNegative = context.facts.nominee_or_bearer_arrangement === false
    || context.answers.DISCLOSE_NOMINEE_OR_BEARER_ARRANGEMENT === "no";
  if (explicitNegative) {
    const negative = relevantEvidenceSufficiency(context, "UBO-R12", EVIDENCE_SUPPORT_DIRECTION.NEGATIVE, () => true);
    if (negative.status === EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT) {
      return { status: REQUIREMENT_STATE.RESOLVED, reasonCode: "EXPLICIT_POLICY_PERMITTED_NEGATIVE_ATTESTATION", resolvingMethod: "NEGATIVE_ATTESTATION", needs: [], evidenceSufficiency: negative };
    }
  }
  return { status: REQUIREMENT_STATE.GAP, reasonCode: "NOMINEE_OR_BEARER_STATUS_NOT_ESTABLISHED", needs: [makeNeed(context, "UBO-R12", INFORMATION_NEED_CONCEPT.NOMINEE_OR_BEARER_STATUS,
    "ABSENCE_NOT_INFERRED_FROM_SILENCE", { subjectEntityId: context.caseContext.subjectEntityId })], evidenceSufficiency: emptySufficiency("UBO-R12", EVIDENCE_SUFFICIENCY_STATUS.INSUFFICIENT, "EXPLICIT_FACT_REQUIRED") };
}

function validateConflicts(relevantConflicts, caseState, policyPack) {
  assertArray(relevantConflicts, "relevantConflicts");
  relevantConflicts.forEach((conflict, index) => {
    assertPlainObject(conflict, `relevantConflicts[${index}]`);
    assertAllowedKeys(conflict, ["conflictId", "requirementIds", "claimIds", "reasonCode"], `relevantConflicts[${index}]`);
    assertNonEmptyString(conflict.conflictId, `relevantConflicts[${index}].conflictId`);
    assertNonEmptyString(conflict.reasonCode, `relevantConflicts[${index}].reasonCode`);
    assertArray(conflict.requirementIds, `relevantConflicts[${index}].requirementIds`);
    assertArray(conflict.claimIds, `relevantConflicts[${index}].claimIds`);
    conflict.requirementIds.forEach((requirementId) => {
      if (!policyPack.requirements.some((requirement) => requirement.requirementId === requirementId)) fail(`relevant conflict references unknown requirement ${requirementId}`);
    });
    const claims = conflict.claimIds.map((claimId) => {
      const claim = caseState.candidateClaims.find((candidate) => candidate.claimId === claimId);
      if (!claim) fail(`relevant conflict references unknown claim ${claimId}`);
      return claim;
    });
    if (!claims.some(({ status }) => status === CLAIM_STATE.DISPUTED)) fail(`relevantConflicts[${index}] must reference an unresolved DISPUTED claim`);
  });
}

function semanticResolution(context, requirementId) {
  if (requirementId === "UBO-R01") return resolveR01(context);
  if (requirementId === "UBO-R02") return resolveR02(context);
  if (requirementId === "UBO-R03") return resolveR03(context);
  if (requirementId === "UBO-R04") return resolveControlRequirement(context, requirementId, INFORMATION_NEED_CONCEPT.VOTING_RIGHTS);
  if (requirementId === "UBO-R05") return resolveControlRequirement(context, requirementId, INFORMATION_NEED_CONCEPT.APPOINTMENT_REMOVAL_RIGHTS);
  if (requirementId === "UBO-R06") return resolveControlRequirement(context, requirementId, INFORMATION_NEED_CONCEPT.OTHER_SIGNIFICANT_CONTROL);
  if (requirementId === "UBO-R07") return resolveR07(context);
  if (requirementId === "UBO-R08") return resolveR08(context);
  if (requirementId === "UBO-R11") return resolveR11(context);
  if (requirementId === "UBO-R12") return resolveR12(context);
  return { status: REQUIREMENT_STATE.UNRESOLVED, reasonCode: "REQUIREMENT_RESOLUTION_DEFERRED_TO_G2_4B", needs: [], evidenceSufficiency: emptySufficiency(requirementId, EVIDENCE_SUFFICIENCY_STATUS.INDETERMINATE, "G2_4B_DEFERRED") };
}

function resolvePolicyRequirements({
  loadedPolicyPack,
  caseContext,
  caseState,
  graph,
  calculations,
  policyAssessment,
  evidenceClassifications = [],
  evaluationDate,
  facts = {},
  answers = {},
  relevantConflicts = [],
  operationContexts = [],
  priorInformationNeedRecords = [],
}) {
  const identity = policyIdentity(loadedPolicyPack);
  const policyPack = loadedPolicyPack.policyPack;
  validateOwnershipCase(caseState);
  assertPlainObject(caseContext, "caseContext");
  assertDataOnly(caseContext, "caseContext");
  assertPlainObject(graph, "graph");
  assertArray(calculations, "calculations");
  assertPlainObject(policyAssessment, "policyAssessment");
  assertArray(evidenceClassifications, "evidenceClassifications");
  validateTimestamp(evaluationDate, "evaluationDate");
  assertDataOnly(facts, "facts");
  assertDataOnly(answers, "answers");
  if (graph.sourceCase.caseId !== caseState.caseId || graph.sourceCase.revisionId !== caseState.revisionId) fail("graph case revision mismatch");
  if (policyAssessment.caseReference.caseId !== caseState.caseId
    || policyAssessment.caseReference.revisionId !== caseState.revisionId
    || policyAssessment.graphVersion !== graph.graphVersion) fail("G2.3 policy assessment input identity mismatch");
  if (policyAssessment.policyIdentity.policyPackId !== identity.policyPackId
    || policyAssessment.policyIdentity.policyVersion !== identity.policyVersion
    || policyAssessment.policyIdentity.policyHash !== identity.policyHash
    || policyAssessment.policyIdentity.policySchemaVersion !== identity.policySchemaVersion
    || policyAssessment.policyIdentity.determinationAlgorithm !== POLICY_DETERMINATION_ALGORITHM) fail("G2.3 Policy Pack identity mismatch");
  calculations.forEach((calculation) => {
    if (calculation.graphVersion !== graph.graphVersion) fail("calculation graph version mismatch");
  });
  evidenceClassifications.forEach((classification) => validateEvidencePolicyClassification(classification, { loadedPolicyPack, caseState }));
  validateConflicts(relevantConflicts, caseState, policyPack);
  const operationalBlockers = createOperationalBlockers({ caseState, operationContexts });
  const conditionContext = {
    case: {
      ...cloneData(caseContext),
      ...(policyAssessment.policyApplicability.entityProfile
        ? { entity_profile: policyAssessment.policyApplicability.entityProfile }
        : {}),
    },
    facts: cloneData(facts),
    answers: cloneData(answers),
    params: parameterValues(policyPack),
  };
  const context = {
    loadedPolicyPack,
    policyPack,
    caseContext,
    caseState,
    graph,
    calculations,
    policyAssessment,
    evidenceClassifications,
    evaluationDate,
    facts,
    answers,
    conditionContext,
  };
  const provisional = [];
  const allNeedDrafts = [];
  policyPack.requirements.forEach((requirement) => {
    const g23 = requirementAssessment(policyAssessment, requirement.requirementId);
    const conflicts = relevantConflicts.filter(({ requirementIds }) => requirementIds.includes(requirement.requirementId));
    const reviewBases = basesFor(policyAssessment, requirement.requirementId)
      .filter(({ state }) => state === BASIS_ASSESSMENT_STATE.REVIEW_REQUIRED);
    const blockers = operationalBlockers.filter(({ affectedRequirementIds }) => affectedRequirementIds.includes(requirement.requirementId));
    let resolution;
    if (g23.applicability === APPLICABILITY_RESULT.DOES_NOT_APPLY) {
      resolution = { status: REQUIREMENT_STATE.N_A, reasonCode: "REQUIREMENT_DOES_NOT_APPLY", needs: [], evidenceSufficiency: emptySufficiency(requirement.requirementId, EVIDENCE_SUFFICIENCY_STATUS.INDETERMINATE, "NOT_APPLICABLE") };
    } else if (g23.applicability === APPLICABILITY_RESULT.UNKNOWN) {
      const needs = [];
      if (!caseContext.entityType) needs.push(makeNeed(context, requirement.requirementId, INFORMATION_NEED_CONCEPT.ENTITY_PROFILE,
        "APPLICABILITY_ENTITY_TYPE_MISSING", { subjectEntityId: caseContext.subjectEntityId }));
      resolution = { status: REQUIREMENT_STATE.UNRESOLVED, reasonCode: "REQUIREMENT_APPLICABILITY_UNKNOWN", needs, evidenceSufficiency: emptySufficiency(requirement.requirementId, EVIDENCE_SUFFICIENCY_STATUS.INDETERMINATE, "APPLICABILITY_UNKNOWN") };
    } else if (conflicts.length > 0) {
      resolution = { status: REQUIREMENT_STATE.CONFLICT, reasonCode: "MATERIALLY_RELEVANT_CLAIM_CONFLICT", needs: [], conflictReferences: conflicts.map(({ conflictId }) => conflictId), evidenceSufficiency: emptySufficiency(requirement.requirementId, EVIDENCE_SUFFICIENCY_STATUS.INDETERMINATE, "CONFLICT_PRECEDENCE") };
    } else if (reviewBases.length > 0) {
      resolution = { status: REQUIREMENT_STATE.REVIEW_REQUIRED, reasonCode: "G2_3_BASIS_REQUIRES_HUMAN_INTERPRETATION", needs: [], reviewReferences: reviewBases.map(({ assessmentId }) => assessmentId), evidenceSufficiency: emptySufficiency(requirement.requirementId, EVIDENCE_SUFFICIENCY_STATUS.INDETERMINATE, "REVIEW_REQUIRED_PRECEDENCE") };
    } else if (DEFERRED_REQUIREMENTS.has(requirement.requirementId)) {
      resolution = semanticResolution(context, requirement.requirementId);
    } else if (blockers.some(({ operationalOnly }) => operationalOnly)) {
      resolution = { status: REQUIREMENT_STATE.UNRESOLVED, reasonCode: "ONLY_CURRENT_BLOCKER_IS_OPERATIONAL", needs: [], evidenceSufficiency: emptySufficiency(requirement.requirementId, EVIDENCE_SUFFICIENCY_STATUS.INDETERMINATE, "OPERATIONAL_BLOCKER_NOT_EVIDENCE_GAP") };
    } else {
      resolution = semanticResolution(context, requirement.requirementId);
    }
    allNeedDrafts.push(...resolution.needs);
    provisional.push({ requirement, g23, conflicts, reviewBases, blockers, resolution });
  });
  const needState = reconcileInformationNeeds({ caseState, drafts: allNeedDrafts, priorRecords: priorInformationNeedRecords });
  const openNeeds = needState.current.filter(({ state }) => state === INFORMATION_NEED_STATE.OPEN);
  const gaps = [];
  provisional.forEach(({ requirement, resolution }) => {
    if (resolution.status !== REQUIREMENT_STATE.GAP) return;
    const needIds = openNeeds.filter(({ requiredBy }) => requiredBy.includes(requirement.requirementId)).map(({ needId }) => needId);
    gaps.push(createPolicyGap({
      caseState,
      requirementId: requirement.requirementId,
      informationNeedIds: needIds,
      reasonCode: resolution.reasonCode,
      references: {
        basisAssessmentIds: basesFor(policyAssessment, requirement.requirementId).map(({ assessmentId }) => assessmentId),
        calculationReferences: uniqueData(basesFor(policyAssessment, requirement.requirementId)
          .filter(({ calculationReference: reference }) => reference)
          .map(({ calculationReference: reference }) => reference)),
        evidenceClassificationIds: evidenceClassifications
          .filter((classification) => classificationSupportsRequirement(classification, requirement.requirementId))
          .map(({ classificationId }) => classificationId).sort(),
      },
    }));
  });
  const records = provisional.map(({ requirement, g23, conflicts, reviewBases, blockers, resolution }) => {
    const bases = basesFor(policyAssessment, requirement.requirementId);
    const needIds = openNeeds.filter(({ requiredBy }) => requiredBy.includes(requirement.requirementId)).map(({ needId }) => needId);
    const requirementGaps = gaps.filter(({ requirementId }) => requirementId === requirement.requirementId);
    const record = {
      requirementId: requirement.requirementId,
      policyIdentity: identity,
      caseReference: { caseId: caseState.caseId, revisionId: caseState.revisionId, revision: caseState.revision },
      applicability: g23.applicability,
      requirementStatus: resolution.status,
      reasonCode: resolution.reasonCode,
      basisAssessmentReferences: bases.map(({ assessmentId, state }) => ({ assessmentId, state })),
      operativeClaimReferences: uniqueSorted([
        ...bases.flatMap(basisClaimIds),
        ...(resolution.operativeClaimIds || []),
      ]),
      graphReference: { graphVersion: graph.graphVersion, relationshipIds: uniqueSorted(bases.flatMap(basisRelationshipIds)) },
      calculationReferences: uniqueData(bases.filter(({ calculationReference: reference }) => reference).map(({ calculationReference: reference }) => reference)),
      evidenceReferencesConsidered: evidenceReferencesFor(evidenceClassifications, requirement.requirementId),
      evidenceSufficiency: cloneData(resolution.evidenceSufficiency),
      informationNeedIds: needIds,
      policyGapIds: requirementGaps.map(({ gapId }) => gapId).sort(),
      conflictReferences: uniqueSorted([...(resolution.conflictReferences || []), ...conflicts.map(({ conflictId }) => conflictId)]),
      reviewReferences: uniqueSorted([...(resolution.reviewReferences || []), ...reviewBases.map(({ assessmentId }) => assessmentId)]),
      operationalBlockerIds: blockers.map(({ blockerId }) => blockerId).sort(),
    };
    if (resolution.resolvingMethod) record.resolvingMethod = resolution.resolvingMethod;
    return record;
  });
  return deepFreeze({
    policyIdentity: identity,
    caseReference: { caseId: caseState.caseId, revisionId: caseState.revisionId, revision: caseState.revision },
    graphVersion: graph.graphVersion,
    evaluationDate,
    requirementResolutions: records,
    evidenceClassifications: cloneData(evidenceClassifications).sort((left, right) => left.classificationId.localeCompare(right.classificationId)),
    informationNeeds: needState.current,
    informationNeedHistory: needState.history,
    policyGaps: gaps.sort((left, right) => left.gapId.localeCompare(right.gapId)),
    operationalBlockers,
  });
}

module.exports = {
  REQUIREMENT_RESOLUTION_ALGORITHM,
  resolvePolicyRequirements,
};
