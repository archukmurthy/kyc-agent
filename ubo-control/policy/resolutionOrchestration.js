"use strict";

const { createHash } = require("node:crypto");
const {
  APPLICABILITY_RESULT,
  CAPABILITY_OUTCOME_STATE,
  REQUIREMENT_STATE,
  RESOLUTION_STRATEGY,
} = require("../contracts/constants");
const { validateEvidenceReference } = require("../contracts/evidenceReference");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const { validateOwnershipCase } = require("../domain/ownershipCase");
const {
  INFORMATION_NEED_CONCEPT,
  INFORMATION_NEED_STATE,
  reconcileInformationNeeds,
  validateInformationNeedRecord,
} = require("../domain/resolutionArtifacts");
const {
  ACTION_INTENT_STATE,
  ACTION_INTENT_TYPE,
  FALLBACK_EXHAUSTION_DECISION,
  OPTION_APPLICABILITY_STATE,
  REVIEW_REQUIREMENT_STATE,
  createActionIntent,
  createResolutionOption,
  createReviewPackage,
  createReviewRequirement,
  validateFallbackExhaustionDecision,
  validateResolutionAttemptHistory,
} = require("../domain/resolutionOrchestrationArtifacts");
const {
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
const { hashPolicyPack, validatePolicyPack } = require("./policyPack");

const RESOLUTION_ORCHESTRATION_ALGORITHM = "ubo-resolution-orchestration-v1";

const PSC_DISCREPANCY_STATE = Object.freeze({
  NO_DISCREPANCY: "NO_DISCREPANCY",
  POTENTIAL_DISCREPANCY: "POTENTIAL_DISCREPANCY",
  NON_REPORTABLE_DEFINITION_DIFFERENCE: "NON_REPORTABLE_DEFINITION_DIFFERENCE",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
});

const RISK_SIGNAL_TYPE = Object.freeze({ RATING_FLOOR: "RATING_FLOOR", RATING_SET: "RATING_SET" });
const CUSTOMER_PROJECTION_STATE = Object.freeze({
  CUSTOMER_INPUT_REQUIRED: "CUSTOMER_INPUT_REQUIRED",
  CUSTOMER_INPUT_COMPLETE: "CUSTOMER_INPUT_COMPLETE",
  INTERNAL_REVIEW_REQUIRED: "INTERNAL_REVIEW_REQUIRED",
});
const UBO_TERMINAL_OUTCOME = Object.freeze({
  RESOLVED: "RESOLVED",
  RESOLVED_PROVISIONALLY: "RESOLVED_PROVISIONALLY",
  RESOLVED_VIA_SMO_FALLBACK: "RESOLVED_VIA_SMO_FALLBACK",
  SPECIALIST_REVIEW_REQUIRED: "SPECIALIST_REVIEW_REQUIRED",
  UNRESOLVABLE: "UNRESOLVABLE",
  CDD_FAILURE: "CDD_FAILURE",
});
const ORCHESTRATION_STATE = Object.freeze({ IN_PROGRESS: "IN_PROGRESS", TERMINAL: "TERMINAL" });

function digest(value) {
  return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}

function uniqueSorted(values) {
  return [...new Set(values || [])].sort();
}

function uniqueData(values) {
  const keyed = new Map();
  (values || []).forEach((value) => keyed.set(canonicalizeJson(value), cloneData(value)));
  return [...keyed.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}

function policyIdentity(loadedPolicyPack) {
  assertPlainObject(loadedPolicyPack, "loadedPolicyPack");
  validatePolicyPack(loadedPolicyPack.policyPack);
  const policyPack = loadedPolicyPack.policyPack;
  const hash = hashPolicyPack(policyPack);
  if (loadedPolicyPack.identity?.hash !== hash || !["1.1", "1.2"].includes(policyPack.schemaVersion)) {
    fail("G2.4B requires an exactly loaded schema 1.1 or 1.2 Policy Pack", "POLICY_CONFIGURATION_ERROR");
  }
  return {
    policyPackId: policyPack.policyPackId,
    policyVersion: policyPack.version,
    policyHash: hash,
    policySchemaVersion: policyPack.schemaVersion,
    resolutionOrchestrationAlgorithm: RESOLUTION_ORCHESTRATION_ALGORITHM,
  };
}

function parameterValues(policyPack) {
  return Object.fromEntries(Object.entries(policyPack.parameters).map(([key, value]) => [key, cloneData(value.value)]));
}

function resolvePolicyParameters(text, policyPack) {
  const values = parameterValues(policyPack);
  return text.replace(/\{param:([a-z][a-z0-9_]*)\}/g, (token, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token);
}

function requirementById(policyPack, requirementId) {
  const requirement = policyPack.requirements.find((candidate) => candidate.requirementId === requirementId);
  if (!requirement) fail(`unknown policy requirement ${requirementId}`);
  return requirement;
}

function resolutionById(requirementResolution, requirementId) {
  const resolution = requirementResolution.requirementResolutions.find((candidate) => candidate.requirementId === requirementId);
  if (!resolution) fail(`G2.4A result is missing ${requirementId}`);
  return resolution;
}

function validateInputIdentity(context) {
  const { caseState, graph, calculations, policyAssessment, requirementResolution, identity } = context;
  validateOwnershipCase(caseState);
  assertPlainObject(graph, "graph");
  assertArray(calculations, "calculations");
  assertPlainObject(policyAssessment, "policyAssessment");
  assertPlainObject(requirementResolution, "requirementResolution");
  if (graph.sourceCase?.caseId !== caseState.caseId || graph.sourceCase.revisionId !== caseState.revisionId) {
    fail("graph case revision mismatch");
  }
  if (policyAssessment.caseReference?.revisionId !== caseState.revisionId || policyAssessment.graphVersion !== graph.graphVersion) {
    fail("policy assessment does not pin the current graph/case revision");
  }
  if (requirementResolution.caseReference?.revisionId !== caseState.revisionId
    || requirementResolution.graphVersion !== graph.graphVersion) {
    fail("G2.4A requirement resolution does not pin the current graph/case revision");
  }
  [policyAssessment.policyIdentity, requirementResolution.policyIdentity].forEach((candidate) => {
    if (candidate.policyPackId !== identity.policyPackId
      || candidate.policyVersion !== identity.policyVersion
      || candidate.policyHash !== identity.policyHash
      || candidate.policySchemaVersion !== identity.policySchemaVersion) {
      fail("G2.4B input Policy Pack identity mismatch");
    }
  });
  calculations.forEach((calculation, index) => {
    if (calculation.graphVersion !== graph.graphVersion) fail(`calculations[${index}] graph version mismatch`);
  });
}

function conditionContext(context, derivedFacts = {}) {
  return {
    case: {
      ...cloneData(context.caseContext),
      ...(context.policyAssessment.policyApplicability.entityProfile
        ? { entity_profile: context.policyAssessment.policyApplicability.entityProfile }
        : {}),
    },
    facts: { ...cloneData(context.facts), ...cloneData(derivedFacts) },
    answers: cloneData(context.answers),
    params: parameterValues(context.policyPack),
  };
}

function strategyEntriesForNeed(context, need, strategy) {
  const entries = [];
  need.requiredBy.forEach((requirementId) => {
    const requirement = requirementById(context.policyPack, requirementId);
    (requirement.resolutionStrategies || []).forEach((entry, index) => {
      if (entry.strategy !== strategy) return;
      if (entry.condition
        && evaluateConditionExpression(entry.condition, conditionContext(context)) !== POLICY_TRUTH_VALUE.TRUE) return;
      entries.push({ requirementId, index, entry });
    });
  });
  return entries;
}

function explicitAvailability(context, needId, strategy) {
  return context.strategyAvailability.find((entry) => entry.informationNeedId === needId && entry.strategy === strategy)
    || context.strategyAvailability.find((entry) => entry.informationNeedId === undefined && entry.strategy === strategy);
}

function optionApplicability(context, need, strategy, entries) {
  const explicit = explicitAvailability(context, need.needId, strategy);
  if (explicit) return { state: explicit.state, reasonCode: explicit.reasonCode, constraints: explicit.constraints || [] };
  if (strategy === RESOLUTION_STRATEGY.EXISTING_EVIDENCE
    && need.existingEvidenceReferences.length === 0) {
    return { state: OPTION_APPLICABILITY_STATE.INAPPLICABLE, reasonCode: "NO_MATCHING_HELD_EVIDENCE", constraints: [] };
  }
  if (strategy === RESOLUTION_STRATEGY.CUSTOMER_QUESTION) {
    const templateIds = uniqueSorted(entries.map(({ entry }) => entry.actionTemplateId).filter(Boolean));
    if (templateIds.length === 0) return { state: OPTION_APPLICABILITY_STATE.REQUIRES_POLICY_CONTENT, reasonCode: "QUESTION_TEMPLATE_NOT_REFERENCED", constraints: [] };
    if (templateIds.length > 1) return { state: OPTION_APPLICABILITY_STATE.REQUIRES_POLICY_CONTENT, reasonCode: "NO_SINGLE_SEMANTIC_QUESTION_TEMPLATE", constraints: [] };
    if (templateIds.some((id) => context.policyPack.actionTemplates[id].contentStatus === "UNRESOLVED_SOURCE_REFERENCE")) {
      return { state: OPTION_APPLICABILITY_STATE.REQUIRES_POLICY_CONTENT, reasonCode: "QUESTION_WORDING_UNRESOLVED_IN_POLICY", constraints: [] };
    }
  }
  return { state: OPTION_APPLICABILITY_STATE.APPLICABLE, reasonCode: "POLICY_PERMITS_STRATEGY", constraints: [] };
}

function planResolutionOptions(context, informationNeeds) {
  const options = [];
  informationNeeds.filter(({ state }) => state === INFORMATION_NEED_STATE.OPEN).forEach((need) => {
    need.permittedResolutionStrategies.forEach((strategy) => {
      const entries = strategyEntriesForNeed(context, need, strategy);
      if (entries.length === 0) return;
      const applicability = optionApplicability(context, need, strategy, entries);
      const templateIds = uniqueSorted(entries.map(({ entry }) => entry.actionTemplateId).filter(Boolean));
      const evidenceTypes = uniqueSorted(entries.map(({ entry }) => entry.evidence).filter(Boolean));
      const template = templateIds.length === 1 ? context.policyPack.actionTemplates[templateIds[0]] : undefined;
      const entityProfile = context.policyAssessment.policyApplicability.entityProfile;
      const schema12 = context.policyPack.schemaVersion === "1.2";
      const wordingSource = schema12 && template && (template.textByEntityProfile?.[entityProfile] || template.text);
      const wording = wordingSource ? resolvePolicyParameters(wordingSource, context.policyPack) : undefined;
      const actionTemplateReference = template
        ? {
          actionTemplateId: templateIds[0],
          contentStatus: template.contentStatus,
          ...(template.sourceReference ? { sourceReference: template.sourceReference } : {}),
          ...(wording ? { wording } : {}),
          ...(schema12 && template.submissionContract ? { submissionContract: cloneData(template.submissionContract) } : {}),
        }
        : undefined;
      options.push(createResolutionOption({
        caseState: context.caseState,
        policyIdentity: context.identity,
        informationNeedId: need.needId,
        requirementIds: need.requiredBy,
        strategy,
        applicabilityState: applicability.state,
        policyBasisReferences: entries.map(({ requirementId, index }) => `${requirementId}.resolutionStrategies[${index}]`),
        actionTemplateReference,
        acceptableEvidenceTypes: evidenceTypes,
        constraints: applicability.constraints,
        reasonCode: applicability.reasonCode,
      }));
    });
  });
  return options.sort((left, right) => left.optionId.localeCompare(right.optionId));
}

function actionTypeForStrategy(strategy) {
  return {
    [RESOLUTION_STRATEGY.DISCOVERY]: ACTION_INTENT_TYPE.DISCOVER_INFORMATION,
    [RESOLUTION_STRATEGY.EXISTING_EVIDENCE]: ACTION_INTENT_TYPE.INTERPRET_EXISTING_ARTIFACT,
    [RESOLUTION_STRATEGY.CUSTOMER_DOCUMENT]: ACTION_INTENT_TYPE.REQUEST_CUSTOMER_EVIDENCE,
    [RESOLUTION_STRATEGY.CUSTOMER_QUESTION]: ACTION_INTENT_TYPE.REQUEST_CUSTOMER_INFORMATION,
    [RESOLUTION_STRATEGY.CUSTOMER_ATTESTATION]: ACTION_INTENT_TYPE.REQUEST_ATTESTATION,
    [RESOLUTION_STRATEGY.ANALYST_REVIEW]: ACTION_INTENT_TYPE.ANALYST_REVIEW,
  }[strategy];
}

function semanticTarget(need) {
  return {
    concept: need.concept,
    ...(need.subjectEntityId ? { subjectEntityId: need.subjectEntityId } : {}),
    ...(need.relationshipId ? { relationshipId: need.relationshipId } : {}),
    ...(need.attribute ? { attribute: need.attribute } : {}),
  };
}

function coalesceIntentDrafts(drafts) {
  const grouped = new Map();
  drafts.forEach((draft) => {
    const identity = {
      type: draft.type,
      semanticTarget: draft.semanticTarget,
      acceptableEvidenceTypes: uniqueSorted(draft.acceptableEvidenceTypes),
      reasonCode: draft.reasonCode,
      ...(draft.strategy ? { strategy: draft.strategy } : {}),
      ...(draft.actionTemplateReference ? { actionTemplateReference: draft.actionTemplateReference } : {}),
    };
    const key = canonicalizeJson(identity);
    if (!grouped.has(key)) grouped.set(key, { ...draft });
    else {
      const existing = grouped.get(key);
      ["informationNeedIds", "policyGapIds", "requirementIds", "resolutionOptionIds", "constraints"]
        .forEach((field) => { existing[field] = uniqueSorted([...existing[field], ...draft[field]]); });
    }
  });
  return [...grouped.values()];
}

function planActionIntents(context, informationNeeds, options) {
  const drafts = [];
  informationNeeds.filter(({ state }) => state === INFORMATION_NEED_STATE.OPEN).forEach((need) => {
    const applicable = options.filter(({ informationNeedId, applicabilityState }) => informationNeedId === need.needId
      && applicabilityState === OPTION_APPLICABILITY_STATE.APPLICABLE);
    if (applicable.length !== 1) return;
    const option = applicable[0];
    const type = actionTypeForStrategy(option.strategy);
    if (!type) return;
    drafts.push({
      type,
      informationNeedIds: [need.needId],
      policyGapIds: context.requirementResolution.policyGaps
        .filter(({ informationNeedIds }) => informationNeedIds.includes(need.needId)).map(({ gapId }) => gapId),
      requirementIds: need.requiredBy,
      resolutionOptionIds: [option.optionId],
      strategy: option.strategy,
      semanticTarget: semanticTarget(need),
      actionTemplateReference: option.actionTemplateReference,
      acceptableEvidenceTypes: option.acceptableEvidenceTypes,
      constraints: option.constraints,
      reasonCode: "ONLY_CURRENTLY_APPLICABLE_POLICY_OPTION",
    });
  });

  context.requirementResolution.operationalBlockers.forEach((blocker) => {
    drafts.push({
      type: ACTION_INTENT_TYPE.OPERATIONAL_RETRY_OR_HOLD,
      informationNeedIds: blocker.affectedInformationNeedIds,
      policyGapIds: [],
      requirementIds: blocker.affectedRequirementIds,
      resolutionOptionIds: [],
      semanticTarget: { capabilityOperationId: blocker.capabilityOperation.operationId },
      acceptableEvidenceTypes: [],
      constraints: blocker.retryable === true ? ["RETRYABLE"] : ["HOLD_UNTIL_CAPABILITY_RECOVERS_OR_ROUTE_BECOMES_IRRELEVANT"],
      reasonCode: blocker.reasonCode,
    });
  });

  context.requirementResolution.requirementResolutions
    .filter(({ requirementStatus }) => [REQUIREMENT_STATE.CONFLICT, REQUIREMENT_STATE.REVIEW_REQUIRED].includes(requirementStatus))
    .forEach((resolution) => {
      const specialist = context.policyPack.resolutionOrchestrationPolicy.specialistReviewRequirementIds.includes(resolution.requirementId);
      drafts.push({
        type: specialist ? ACTION_INTENT_TYPE.SPECIALIST_REVIEW : ACTION_INTENT_TYPE.ANALYST_REVIEW,
        informationNeedIds: resolution.informationNeedIds,
        policyGapIds: resolution.policyGapIds,
        requirementIds: [resolution.requirementId],
        resolutionOptionIds: [],
        semanticTarget: { requirementId: resolution.requirementId, conflictReferences: resolution.conflictReferences },
        acceptableEvidenceTypes: [],
        constraints: [],
        reasonCode: resolution.reasonCode,
      });
    });

  return coalesceIntentDrafts(drafts).map((draft) => createActionIntent({
    caseState: context.caseState,
    policyIdentity: context.identity,
    state: ACTION_INTENT_STATE.OPEN,
    ...draft,
  })).sort((left, right) => left.actionIntentId.localeCompare(right.actionIntentId));
}

function factIdentity(fact) {
  return canonicalizeJson({
    personEntityId: fact.personEntityId,
    basis: fact.basis,
    ...(fact.value !== undefined ? { value: fact.value } : {}),
  });
}

function assessPscDiscrepancy(context) {
  const input = context.pscComparison;
  if (!input) return { requirementStatus: REQUIREMENT_STATE.UNRESOLVED, state: PSC_DISCREPANCY_STATE.REVIEW_REQUIRED, reasonCode: "PSC_COMPARISON_INPUT_NOT_SUPPLIED", differences: [] };
  assertPlainObject(input, "pscComparison");
  assertArray(input.firmFacts, "pscComparison.firmFacts");
  assertArray(input.pscFacts, "pscComparison.pscFacts");
  assertArray(input.explicitDifferenceAssessments || [], "pscComparison.explicitDifferenceAssessments");
  [...input.firmFacts, ...input.pscFacts].forEach((fact, index) => {
    assertPlainObject(fact, `pscComparison.fact[${index}]`);
    assertNonEmptyString(fact.factId, `pscComparison.fact[${index}].factId`);
    assertNonEmptyString(fact.personEntityId, `pscComparison.fact[${index}].personEntityId`);
    assertNonEmptyString(fact.basis, `pscComparison.fact[${index}].basis`);
    assertDataOnly(fact, `pscComparison.fact[${index}]`);
  });
  if (input.pscFacts.length === 0) {
    return { requirementStatus: REQUIREMENT_STATE.REVIEW_REQUIRED, state: PSC_DISCREPANCY_STATE.REVIEW_REQUIRED, reasonCode: "PSC_SILENCE_IS_NOT_NEGATIVE_EVIDENCE", differences: [] };
  }
  const firm = new Map(input.firmFacts.map((fact) => [factIdentity(fact), fact]));
  const psc = new Map(input.pscFacts.map((fact) => [factIdentity(fact), fact]));
  const differenceFacts = [
    ...[...firm.entries()].filter(([key]) => !psc.has(key)).map(([, fact]) => fact),
    ...[...psc.entries()].filter(([key]) => !firm.has(key)).map(([, fact]) => fact),
  ];
  const differences = uniqueData(differenceFacts).map((fact) => ({
    differenceId: `psc-difference:${digest(fact)}`,
    factId: fact.factId,
    personEntityId: fact.personEntityId,
    basis: fact.basis,
  }));
  if (differences.length === 0) {
    return { requirementStatus: REQUIREMENT_STATE.RESOLVED, state: PSC_DISCREPANCY_STATE.NO_DISCREPANCY, reasonCode: "EXPLICIT_PSC_AND_MLR_FACTS_MATCH", differences };
  }
  const assessments = input.explicitDifferenceAssessments || [];
  assessments.forEach((assessment, index) => {
    assertPlainObject(assessment, `pscComparison.explicitDifferenceAssessments[${index}]`);
    assertArray(assessment.factIds, `pscComparison.explicitDifferenceAssessments[${index}].factIds`);
    assertNonEmptyString(assessment.classification, `pscComparison.explicitDifferenceAssessments[${index}].classification`);
    assertNonEmptyString(assessment.rationale, `pscComparison.explicitDifferenceAssessments[${index}].rationale`);
  });
  const differingFactIds = new Set(differences.map(({ factId }) => factId));
  const covered = (classification) => {
    const ids = new Set(assessments.filter((assessment) => assessment.classification === classification).flatMap(({ factIds }) => factIds));
    return [...differingFactIds].every((id) => ids.has(id));
  };
  if (covered("PSC_MLR_DEFINITION_DIFFERENCE")) {
    return { requirementStatus: REQUIREMENT_STATE.RESOLVED, state: PSC_DISCREPANCY_STATE.NON_REPORTABLE_DEFINITION_DIFFERENCE, reasonCode: "EXPLICIT_PSC_MLR_DEFINITION_DIFFERENCE", differences, assessments: cloneData(assessments) };
  }
  if (covered("NON_MATERIAL")) {
    return { requirementStatus: REQUIREMENT_STATE.RESOLVED, state: PSC_DISCREPANCY_STATE.NO_DISCREPANCY, reasonCode: "EXPLICIT_NON_MATERIAL_DIFFERENCE_WITH_RATIONALE", differences, assessments: cloneData(assessments) };
  }
  return { requirementStatus: REQUIREMENT_STATE.REVIEW_REQUIRED, state: PSC_DISCREPANCY_STATE.POTENTIAL_DISCREPANCY, reasonCode: "EXPLICIT_PSC_AND_MLR_FACTS_DIFFER", differences, assessments: cloneData(assessments) };
}

function deriveGraphRiskFacts(context) {
  const relevantPaths = context.calculations.flatMap((calculation) => [
    ...(calculation.knownPaths || []),
    ...(calculation.unresolvedPaths || []),
  ]);
  const ownershipLayers = relevantPaths.reduce((maximum, path) => Math.max(maximum, (path.relationshipIds || []).length), 0);
  const entities = new Map(context.caseState.canonicalEntities.map((entity) => [entity.entityId, entity]));
  const crossBorderRelationshipIds = context.graph.relationships.filter((relationship) => {
    const subject = entities.get(relationship.subjectEntityId);
    const object = entities.get(relationship.objectEntityId);
    return subject?.jurisdiction && object?.jurisdiction && subject.jurisdiction !== object.jurisdiction;
  }).map(({ relationshipId }) => relationshipId).sort();
  return { ownership_layers: ownershipLayers, cross_border_layer: crossBorderRelationshipIds.length > 0, crossBorderRelationshipIds };
}

function riskSignals(context, facts, fallbackApplied) {
  const signals = [];
  const riskFacts = { ...facts, smo_fallback_applied: fallbackApplied === true };
  ["UBO-R10", "UBO-R11", "UBO-R13"].forEach((requirementId) => {
    const requirement = requirementById(context.policyPack, requirementId);
    (requirement.riskSignals || []).forEach((signal, index) => {
      if (signal.condition && evaluateConditionExpression(signal.condition, conditionContext(context, riskFacts)) !== POLICY_TRUTH_VALUE.TRUE) return;
      if (requirementId === "UBO-R10" && fallbackApplied !== true) return;
      if (requirementId === "UBO-R11" && riskFacts.trust_in_chain !== true) return;
      const level = signal.level || parameterValues(context.policyPack)[signal.levelRef];
      const payload = {
        policyIdentity: cloneData(context.identity),
        caseReference: cloneData(context.requirementResolution.caseReference),
        requirementId,
        type: signal.emit,
        level,
        policyBasisReference: `${requirementId}.riskSignals[${index}]`,
        graphReference: {
          graphVersion: context.graph.graphVersion,
          relationshipIds: requirementId === "UBO-R13" ? riskFacts.crossBorderRelationshipIds : [],
        },
        calculationReferences: requirementId === "UBO-R13"
          ? context.calculations.map(({ calculationAlgorithm, graphVersion, subjectEntityId, targetEntityId, dimension, status }) => ({ calculationAlgorithm, graphVersion, subjectEntityId, targetEntityId, dimension, status }))
          : [],
      };
      signals.push({ riskSignalId: `ubo-risk-signal:${digest(payload)}`, ...payload });
    });
  });
  return uniqueData(signals);
}

function candidateSeniorManagementNeed(context, fallbackReviewCandidate) {
  if (!fallbackReviewCandidate || context.seniorManagementCandidatesComplete) return [];
  return [{
    subjectEntityId: context.caseContext.subjectEntityId,
    requiredBy: ["UBO-R10"],
    concept: INFORMATION_NEED_CONCEPT.SENIOR_MANAGEMENT_CANDIDATE,
    reasonCodes: ["FALLBACK_REVIEW_PREPARATION_REQUIRES_SENIOR_MANAGEMENT_CANDIDATES"],
    claimIds: [],
    calculationReferences: [],
    conflictReferences: [],
    existingEvidenceReferences: context.seniorManagementCandidates.flatMap(({ evidenceReferences = [] }) => evidenceReferences),
    permittedResolutionStrategies: [RESOLUTION_STRATEGY.EXISTING_EVIDENCE, RESOLUTION_STRATEGY.CUSTOMER_QUESTION],
  }];
}

function fallbackCandidateAssessment(context, informationNeeds) {
  const policy = context.policyPack.fallbackReviewPolicy;
  const requiredIds = [...policy.requiredPreFallbackRequirementIds];
  policy.conditionalPreFallbackRequirementIds.forEach((requirementId) => {
    if (resolutionById(context.requirementResolution, requirementId).applicability !== APPLICABILITY_RESULT.DOES_NOT_APPLY) requiredIds.push(requirementId);
  });
  const blockingRequirements = uniqueSorted(requiredIds.filter((requirementId) => {
    const resolution = resolutionById(context.requirementResolution, requirementId);
    return !policy.satisfactoryRequirementStates.includes(resolution.requirementStatus);
  }));
  const customerStrategies = new Set(policy.customerResolvableStrategies);
  const customerResolvableOpenNeedIds = informationNeeds.filter(({ state, permittedResolutionStrategies }) => state === INFORMATION_NEED_STATE.OPEN
    && permittedResolutionStrategies.some((strategy) => customerStrategies.has(strategy)))
    .map(({ needId }) => needId).sort();
  const specialistBlocked = policy.specialistRequirementIds.some((requirementId) => {
    const resolution = resolutionById(context.requirementResolution, requirementId);
    return resolution.requirementStatus === REQUIREMENT_STATE.REVIEW_REQUIRED;
  });
  const openNeedIds = new Set(informationNeeds.filter(({ state }) => state === INFORMATION_NEED_STATE.OPEN).map(({ needId }) => needId));
  const relevantBlockerIds = context.requirementResolution.operationalBlockers.filter((blocker) =>
    blocker.affectedRequirementIds.some((id) => requiredIds.includes(id)
      && !policy.satisfactoryRequirementStates.includes(resolutionById(context.requirementResolution, id).requirementStatus))
      || blocker.affectedInformationNeedIds.some((id) => openNeedIds.has(id)))
    .map(({ blockerId }) => blockerId).sort();
  const noQualifyingPerson = context.policyAssessment.qualifyingPersons.length === 0;
  const firmUnsatisfied = context.facts.firm_unsatisfied_with_identified_beneficial_owner === true;
  const fallbackStillRequired = noQualifyingPerson || firmUnsatisfied;
  const isCandidate = fallbackStillRequired
    && blockingRequirements.length === 0
    && customerResolvableOpenNeedIds.length === 0
    && !specialistBlocked
    && relevantBlockerIds.length === 0;
  return {
    state: isCandidate ? policy.candidateState : "NOT_READY_FOR_FALLBACK_REVIEW",
    isCandidate,
    requiredPreFallbackRequirementIds: uniqueSorted(requiredIds),
    blockingRequirementIds: blockingRequirements,
    customerResolvableOpenNeedIds,
    relevantOperationalBlockerIds: relevantBlockerIds,
    specialistRouteActive: specialistBlocked,
    fallbackStillRequired,
    fallbackNecessityState: noQualifyingPerson
      ? "NO_QUALIFYING_PERSON_ESTABLISHED"
      : (firmUnsatisfied ? "FIRM_UNSATISFIED_WITH_IDENTIFIED_PERSON" : "NOT_REQUIRED"),
    reasonCodes: uniqueSorted([
      ...(blockingRequirements.length > 0 ? ["PRE_FALLBACK_REQUIREMENTS_NOT_COMPLETE"] : []),
      ...(customerResolvableOpenNeedIds.length > 0 ? ["CUSTOMER_RESOLVABLE_INFORMATION_NEEDS_REMAIN_OPEN"] : []),
      ...(specialistBlocked ? ["SPECIALIST_ROUTE_CANNOT_BE_BYPASSED"] : []),
      ...(relevantBlockerIds.length > 0 ? ["OPERATIONAL_FAILURE_DOES_NOT_PROVE_EXHAUSTION"] : []),
      ...(!fallbackStillRequired ? ["SATISFACTORY_QUALIFYING_PERSON_ALREADY_ESTABLISHED"] : []),
      ...(isCandidate ? [policy.readyRecommendation] : []),
    ]),
  };
}

function reviewPackageFor(context, informationNeeds, candidateAssessment) {
  const requirementSummaries = context.requirementResolution.requirementResolutions.map((resolution) => ({
    requirementResolutionId: `requirement-resolution:${digest(resolution)}`,
    requirementId: resolution.requirementId,
    requirementStatus: resolution.requirementStatus,
    reasonCode: resolution.reasonCode,
  }));
  const informationNeedSummaries = informationNeeds.map((need) => ({ needId: need.needId, state: need.state, requiredBy: need.requiredBy, concept: need.concept }));
  const attemptSummaries = context.resolutionAttempts.map((attempt) => ({
    attemptId: attempt.attemptId,
    informationNeedIds: attempt.informationNeedIds,
    strategy: attempt.strategy,
    outcome: attempt.outcome,
    ...(attempt.capabilityOutcomeState ? { capabilityOutcomeState: attempt.capabilityOutcomeState } : {}),
  }));
  const evidenceReferences = uniqueData([
    ...context.requirementResolution.evidenceClassifications.map(({ evidenceReference }) => evidenceReference),
    ...context.resolutionAttempts.flatMap(({ resultingEvidenceReferences = [] }) => resultingEvidenceReferences),
    ...context.seniorManagementCandidates.flatMap(({ evidenceReferences = [] }) => evidenceReferences),
  ]);
  return createReviewPackage({
    caseState: context.caseState,
    policyIdentity: context.identity,
    graphVersion: context.graph.graphVersion,
    qualifyingPersonReferences: context.policyAssessment.qualifyingPersons.map(({ personEntityId }) => personEntityId),
    requirementSummaries,
    informationNeedSummaries,
    resolutionAttemptSummaries: attemptSummaries,
    capabilityOutcomeReferences: context.caseState.capabilityOperations.map(({ operationId, outcome }) => `${operationId}:${outcome.state}`),
    evidenceReferences,
    calculationReferences: context.calculations.map(({ calculationAlgorithm, graphVersion, subjectEntityId, targetEntityId, dimension, status }) => ({ calculationAlgorithm, graphVersion, subjectEntityId, targetEntityId, dimension, status })),
    conflictAndReviewReferences: context.requirementResolution.requirementResolutions.flatMap(({ conflictReferences, reviewReferences }) => [...conflictReferences, ...reviewReferences]),
    seniorManagementCandidates: context.seniorManagementCandidates.map(({ personEntityId, factReferences = [], evidenceReferences: ignored }) => ({ personEntityId, factReferences: uniqueSorted(factReferences) })),
    readinessReasons: candidateAssessment.reasonCodes,
  });
}

function currentFallbackReview(context, informationNeeds, candidateAssessment) {
  if (!candidateAssessment.isCandidate || !context.seniorManagementCandidatesComplete) return { reviewPackage: undefined, reviewRequirement: undefined, supersededReviewRequirementIds: [] };
  const reviewPackage = reviewPackageFor(context, informationNeeds, candidateAssessment);
  const pending = createReviewRequirement({
    caseState: context.caseState,
    policyIdentity: context.identity,
    graphVersion: context.graph.graphVersion,
    reviewPackage,
    state: REVIEW_REQUIREMENT_STATE.PENDING,
    reasonCode: "MACHINE_ROUTES_COMPLETE_READY_FOR_ASYNCHRONOUS_EXHAUSTION_REVIEW",
  });
  const reviewRequirement = pending;
  const supersededReviewRequirementIds = context.priorReviewRequirements
    .filter(({ reviewRequirementId, state }) => reviewRequirementId !== pending.reviewRequirementId && state !== REVIEW_REQUIREMENT_STATE.SUPERSEDED)
    .map(({ reviewRequirementId }) => reviewRequirementId).sort();
  return { reviewPackage, reviewRequirement, supersededReviewRequirementIds };
}

function validateSeniorManagementCandidates(context) {
  assertArray(context.seniorManagementCandidates, "seniorManagementCandidates");
  context.seniorManagementCandidates.forEach((candidate, index) => {
    assertPlainObject(candidate, `seniorManagementCandidates[${index}]`);
    assertNonEmptyString(candidate.personEntityId, `seniorManagementCandidates[${index}].personEntityId`);
    const entity = context.caseState.canonicalEntities.find(({ entityId }) => entityId === candidate.personEntityId);
    if (!entity || entity.category !== CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) fail("senior-management candidate must be an explicit canonical natural person");
    assertArray(candidate.factReferences || [], `seniorManagementCandidates[${index}].factReferences`);
    assertArray(candidate.evidenceReferences || [], `seniorManagementCandidates[${index}].evidenceReferences`);
    (candidate.evidenceReferences || []).forEach((reference, referenceIndex) => validateEvidenceReference(reference, `seniorManagementCandidates[${index}].evidenceReferences[${referenceIndex}]`));
    if ((candidate.factReferences || []).length === 0 && (candidate.evidenceReferences || []).length === 0) fail("senior-management candidate requires explicit fact or evidence references");
  });
  if (context.seniorManagementCandidatesComplete && context.seniorManagementCandidates.length === 0) fail("complete senior-management candidate data requires at least one explicit candidate");
}

function fallbackDecisionAssessment(context, reviewRequirement) {
  if (!reviewRequirement) return { eligible: false, currentDecision: undefined, rejectedDecisionIds: [] };
  const rejected = [];
  const currentDecisions = [];
  const decisionIds = new Set();
  context.fallbackExhaustionDecisions.forEach((decision) => {
    validateFallbackExhaustionDecision(decision);
    if (decisionIds.has(decision.decisionId)) fail("fallback exhaustion decision history cannot contain duplicates");
    decisionIds.add(decision.decisionId);
    const pinsCurrent = decision.reviewRequirementId === reviewRequirement.reviewRequirementId
      && decision.reviewRequirementRecordId === reviewRequirement.reviewRequirementRecordId
      && decision.caseReference?.revisionId === context.caseState.revisionId
      && decision.policyIdentity?.policyHash === context.identity.policyHash
      && decision.graphVersion === context.graph.graphVersion
      && decision.reasoningManifestHash === reviewRequirement.reviewPackageReference.reasoningManifestHash;
    if (!pinsCurrent) rejected.push(decision.decisionId);
    else currentDecisions.push(decision);
  });
  if (currentDecisions.length > 1) fail("multiple current fallback exhaustion decisions require explicit supersession before orchestration");
  const current = currentDecisions[0];
  return {
    eligible: current?.decision === FALLBACK_EXHAUSTION_DECISION.ALL_POSSIBLE_MEANS_EXHAUSTED,
    currentDecision: current,
    rejectedDecisionIds: uniqueSorted(rejected),
  };
}

function applySmoFallback(context, decisionAssessment) {
  if (!decisionAssessment.eligible || !context.smoApplication) return { applied: false, roles: [] };
  const application = context.smoApplication;
  assertPlainObject(application, "smoApplication");
  if (application.decisionId !== decisionAssessment.currentDecision.decisionId) fail("SMO application must reference the current positive exhaustion decision");
  assertArray(application.personEntityIds, "smoApplication.personEntityIds");
  assertNonEmptyString(application.reasonCode, "smoApplication.reasonCode");
  const candidates = new Set(context.seniorManagementCandidates.map(({ personEntityId }) => personEntityId));
  application.personEntityIds.forEach((id) => {
    if (!candidates.has(id)) fail("SMO application may use only explicit senior-management candidates");
  });
  if (application.personEntityIds.length === 0) fail("SMO application requires at least one explicit person");
  const roles = uniqueSorted(application.personEntityIds).map((personEntityId) => ({
    personEntityId,
    role: context.policyPack.fallbackReviewPolicy.fallbackRole,
    requirementId: "UBO-R10",
    fallbackReason: application.reasonCode,
    measuresTakenAttemptIds: context.resolutionAttempts.map(({ attemptId }) => attemptId).sort(),
    fallbackExhaustionDecisionId: decisionAssessment.currentDecision.decisionId,
    policyIdentity: cloneData(context.identity),
  }));
  return { applied: true, roles };
}

function residualCompleteness(context, effectiveResolutions) {
  const priorRequirements = effectiveResolutions.filter(({ requirementId, applicability }) => requirementId !== "UBO-R14"
    && !(requirementId === "UBO-R10" && applicability === APPLICABILITY_RESULT.DOES_NOT_APPLY));
  const ready = priorRequirements.every(({ requirementStatus }) => [REQUIREMENT_STATE.RESOLVED, REQUIREMENT_STATE.N_A].includes(requirementStatus));
  if (!ready) return { requirementStatus: REQUIREMENT_STATE.UNRESOLVED, state: "NOT_READY_FOR_COMPLETENESS_ATTESTATION", reasonCode: "UNDERLYING_REQUIREMENTS_NOT_COMPLETE", evidenceReferences: [] };
  if (!context.residualCompletenessAttestation) {
    return { requirementStatus: REQUIREMENT_STATE.GAP, state: "READY_FOR_COMPLETENESS_ATTESTATION", reasonCode: "RESIDUAL_ATTESTATION_REQUIRED", evidenceReferences: [] };
  }
  const attestation = context.residualCompletenessAttestation;
  assertPlainObject(attestation, "residualCompletenessAttestation");
  assertNonEmptyString(attestation.factReference, "residualCompletenessAttestation.factReference");
  validateEvidenceReference(attestation.evidenceReference, "residualCompletenessAttestation.evidenceReference");
  if (attestation.accepted === true) {
    return { requirementStatus: REQUIREMENT_STATE.RESOLVED, state: "COMPLETENESS_ATTESTED", reasonCode: "VALID_RESIDUAL_COMPLETENESS_ATTESTATION", factReference: attestation.factReference, evidenceReferences: [cloneData(attestation.evidenceReference)] };
  }
  return { requirementStatus: REQUIREMENT_STATE.GAP, state: "COMPLETENESS_ATTESTATION_REFUSED", reasonCode: "REQUIRED_CLOSING_ATTESTATION_REFUSED", factReference: attestation.factReference, evidenceReferences: [cloneData(attestation.evidenceReference)] };
}

function terminalOutcome(context, effectiveResolutions, fallbackApplied, fallbackCandidate) {
  if (context.cddUnableToComplete?.established === true) {
    assertNonEmptyString(context.cddUnableToComplete.reasonCode, "cddUnableToComplete.reasonCode");
    assertArray(context.cddUnableToComplete.informationNeedIds, "cddUnableToComplete.informationNeedIds");
    assertArray(context.cddUnableToComplete.resolutionAttemptIds, "cddUnableToComplete.resolutionAttemptIds");
    if (context.cddUnableToComplete.informationNeedIds.length === 0
      || context.cddUnableToComplete.resolutionAttemptIds.length === 0) {
      fail("CDD_UNABLE_TO_COMPLETE requires explicit unresolved needs and attempted-measure references");
    }
    return { orchestrationState: ORCHESTRATION_STATE.TERMINAL, terminalOutcome: UBO_TERMINAL_OUTCOME.CDD_FAILURE, reasonCode: context.cddUnableToComplete.reasonCode };
  }
  const specialistIds = new Set(context.policyPack.resolutionOrchestrationPolicy.specialistReviewRequirementIds);
  const specialist = effectiveResolutions.find(({ requirementId, requirementStatus }) => specialistIds.has(requirementId)
    && requirementStatus === REQUIREMENT_STATE.REVIEW_REQUIRED);
  if (specialist) return { orchestrationState: ORCHESTRATION_STATE.TERMINAL, terminalOutcome: UBO_TERMINAL_OUTCOME.SPECIALIST_REVIEW_REQUIRED, reasonCode: `${specialist.requirementId}_SPECIALIST_POLICY_ROUTE` };
  const allComplete = effectiveResolutions.every(({ applicability, requirementStatus }) => applicability === APPLICABILITY_RESULT.DOES_NOT_APPLY
    || [REQUIREMENT_STATE.RESOLVED, REQUIREMENT_STATE.N_A].includes(requirementStatus));
  if (fallbackApplied && allComplete) return { orchestrationState: ORCHESTRATION_STATE.TERMINAL, terminalOutcome: UBO_TERMINAL_OUTCOME.RESOLVED_VIA_SMO_FALLBACK, reasonCode: "CURRENT_POSITIVE_EXHAUSTION_DECISION_AND_SMO_APPLICATION" };
  if (fallbackCandidate.isCandidate) {
    return { orchestrationState: ORCHESTRATION_STATE.IN_PROGRESS, reasonCode: "FALLBACK_REVIEW_OR_APPLICATION_REMAINS_OUTSTANDING" };
  }
  const provisionalIds = new Set(context.policyPack.resolutionOrchestrationPolicy.provisionalRequirementIds);
  const onlyPermittedProvisional = effectiveResolutions.every(({ applicability, requirementId, requirementStatus }) => applicability === APPLICABILITY_RESULT.DOES_NOT_APPLY
    || [REQUIREMENT_STATE.RESOLVED, REQUIREMENT_STATE.N_A].includes(requirementStatus)
    || (provisionalIds.has(requirementId) && requirementStatus === REQUIREMENT_STATE.REVIEW_REQUIRED));
  if (provisionalIds.size > 0 && onlyPermittedProvisional) return { orchestrationState: ORCHESTRATION_STATE.TERMINAL, terminalOutcome: UBO_TERMINAL_OUTCOME.RESOLVED_PROVISIONALLY, reasonCode: "POLICY_EXPRESSLY_PERMITS_PROVISIONAL_REQUIREMENTS" };
  if (allComplete) return { orchestrationState: ORCHESTRATION_STATE.TERMINAL, terminalOutcome: UBO_TERMINAL_OUTCOME.RESOLVED, reasonCode: "ALL_APPLICABLE_REQUIREMENTS_COMPLETE" };
  if (context.unresolvableAssessment?.established === true) {
    assertNonEmptyString(context.unresolvableAssessment.reasonCode, "unresolvableAssessment.reasonCode");
    assertArray(context.unresolvableAssessment.informationNeedIds, "unresolvableAssessment.informationNeedIds");
    assertArray(context.unresolvableAssessment.resolutionAttemptIds, "unresolvableAssessment.resolutionAttemptIds");
    if (context.unresolvableAssessment.informationNeedIds.length === 0
      || context.unresolvableAssessment.resolutionAttemptIds.length === 0) {
      fail("UNRESOLVABLE requires explicit unresolved needs and attempted-measure references");
    }
    return { orchestrationState: ORCHESTRATION_STATE.TERMINAL, terminalOutcome: UBO_TERMINAL_OUTCOME.UNRESOLVABLE, reasonCode: context.unresolvableAssessment.reasonCode };
  }
  return { orchestrationState: ORCHESTRATION_STATE.IN_PROGRESS, reasonCode: "NO_POLICY_TERMINAL_OUTCOME_ESTABLISHED" };
}

function orchestrationRequirementUpdates(context, pscAssessment, graphRiskFacts, decisionAssessment, fallbackApplication) {
  const updates = {
    "UBO-R09": { requirementStatus: pscAssessment.requirementStatus, reasonCode: pscAssessment.reasonCode },
    "UBO-R10": decisionAssessment.eligible && fallbackApplication.applied
      ? { requirementStatus: REQUIREMENT_STATE.RESOLVED, reasonCode: "CURRENT_EXHAUSTION_DECISION_AND_EXPLICIT_SMO_APPLICATION" }
      : { requirementStatus: REQUIREMENT_STATE.N_A, reasonCode: "FALLBACK_NOT_VALIDLY_APPLIED" },
    "UBO-R13": { requirementStatus: REQUIREMENT_STATE.RESOLVED, reasonCode: "GRAPH_CHAIN_DEPTH_AND_CROSS_BORDER_CHARACTER_DETERMINISTICALLY_ASSESSED" },
  };
  return context.requirementResolution.requirementResolutions.map((resolution) => ({
    ...cloneData(resolution),
    ...(updates[resolution.requirementId] || {}),
    ...(resolution.requirementId === "UBO-R13" ? { riskBasis: cloneData(graphRiskFacts) } : {}),
  }));
}

function projectionFor(informationNeeds, actionIntents, reviewRequirement) {
  const customerActionTypes = new Set([
    ACTION_INTENT_TYPE.REQUEST_CUSTOMER_INFORMATION,
    ACTION_INTENT_TYPE.REQUEST_CUSTOMER_EVIDENCE,
    ACTION_INTENT_TYPE.REQUEST_ATTESTATION,
  ]);
  const openCustomerActions = actionIntents.filter(({ state, type }) => state === ACTION_INTENT_STATE.OPEN && customerActionTypes.has(type));
  if (openCustomerActions.length > 0) return { state: CUSTOMER_PROJECTION_STATE.CUSTOMER_INPUT_REQUIRED, customerInputComplete: false, actionIntentIds: openCustomerActions.map(({ actionIntentId }) => actionIntentId).sort() };
  const customerStrategies = new Set([RESOLUTION_STRATEGY.CUSTOMER_DOCUMENT, RESOLUTION_STRATEGY.CUSTOMER_QUESTION, RESOLUTION_STRATEGY.CUSTOMER_ATTESTATION]);
  const openCustomerNeeds = informationNeeds.filter(({ state, permittedResolutionStrategies }) => state === INFORMATION_NEED_STATE.OPEN
    && permittedResolutionStrategies.some((strategy) => customerStrategies.has(strategy)));
  if (openCustomerNeeds.length > 0) return { state: CUSTOMER_PROJECTION_STATE.CUSTOMER_INPUT_REQUIRED, customerInputComplete: false, informationNeedIds: openCustomerNeeds.map(({ needId }) => needId).sort() };
  if (reviewRequirement?.state === REVIEW_REQUIREMENT_STATE.PENDING) return { state: CUSTOMER_PROJECTION_STATE.INTERNAL_REVIEW_REQUIRED, customerInputComplete: true, reviewRequirementId: reviewRequirement.reviewRequirementId };
  return { state: CUSTOMER_PROJECTION_STATE.CUSTOMER_INPUT_COMPLETE, customerInputComplete: true };
}

function orchestrateResolution({
  loadedPolicyPack,
  caseContext,
  caseState,
  graph,
  calculations,
  policyAssessment,
  requirementResolution,
  facts = {},
  answers = {},
  strategyAvailability = [],
  resolutionAttempts = [],
  priorReviewRequirements = [],
  fallbackExhaustionDecisions = [],
  seniorManagementCandidates = [],
  seniorManagementCandidatesComplete = false,
  smoApplication,
  pscComparison,
  residualCompletenessAttestation,
  cddUnableToComplete,
  unresolvableAssessment,
}) {
  const identity = policyIdentity(loadedPolicyPack);
  const context = {
    loadedPolicyPack,
    policyPack: loadedPolicyPack.policyPack,
    identity,
    caseContext,
    caseState,
    graph,
    calculations,
    policyAssessment,
    requirementResolution,
    facts,
    answers,
    strategyAvailability,
    resolutionAttempts,
    priorReviewRequirements,
    fallbackExhaustionDecisions,
    seniorManagementCandidates,
    seniorManagementCandidatesComplete,
    smoApplication,
    pscComparison,
    residualCompletenessAttestation,
    cddUnableToComplete,
    unresolvableAssessment,
  };
  assertPlainObject(caseContext, "caseContext");
  assertDataOnly(caseContext, "caseContext");
  assertDataOnly(facts, "facts");
  assertDataOnly(answers, "answers");
  assertArray(strategyAvailability, "strategyAvailability");
  assertArray(priorReviewRequirements, "priorReviewRequirements");
  assertArray(fallbackExhaustionDecisions, "fallbackExhaustionDecisions");
  if (typeof seniorManagementCandidatesComplete !== "boolean") fail("seniorManagementCandidatesComplete must be boolean");
  validateInputIdentity(context);
  validateResolutionAttemptHistory(resolutionAttempts, caseState);
  validateSeniorManagementCandidates(context);
  requirementResolution.informationNeeds.forEach((need, index) => validateInformationNeedRecord(need, `requirementResolution.informationNeeds[${index}]`));

  const baseNeeds = requirementResolution.informationNeeds;
  const preliminaryCandidate = fallbackCandidateAssessment(context, baseNeeds);
  const preparatoryDrafts = candidateSeniorManagementNeed(context, preliminaryCandidate.isCandidate);
  const preparatoryState = reconcileInformationNeeds({ caseState, drafts: preparatoryDrafts, priorRecords: [] });
  const informationNeeds = [...baseNeeds, ...preparatoryState.current].sort((left, right) => left.needId.localeCompare(right.needId));
  const candidateAssessment = fallbackCandidateAssessment(context, baseNeeds);
  const planningContext = {
    ...context,
    facts: {
      ...context.facts,
      fallback_review_candidate: candidateAssessment.isCandidate,
      senior_management_candidates_complete: seniorManagementCandidatesComplete,
    },
  };
  const options = planResolutionOptions(planningContext, informationNeeds);
  let actionIntents = planActionIntents(planningContext, informationNeeds, options);
  const review = currentFallbackReview(context, informationNeeds, candidateAssessment);
  const decisionAssessment = fallbackDecisionAssessment(context, review.reviewRequirement);
  const reviewDecisionNeedState = reconcileInformationNeeds({
    caseState,
    drafts: decisionAssessment.currentDecision?.decision === FALLBACK_EXHAUSTION_DECISION.FURTHER_MEASURES_AVAILABLE
      ? decisionAssessment.currentDecision.furtherInformationNeedDrafts
      : [],
    priorRecords: [],
  });
  const reportedReviewRequirement = decisionAssessment.currentDecision && review.reviewPackage
    ? createReviewRequirement({
      caseState,
      policyIdentity: identity,
      graphVersion: graph.graphVersion,
      reviewPackage: review.reviewPackage,
      state: REVIEW_REQUIREMENT_STATE.RESOLVED,
      reasonCode: "MACHINE_ROUTES_COMPLETE_READY_FOR_ASYNCHRONOUS_EXHAUSTION_REVIEW",
    })
    : review.reviewRequirement;
  if (review.reviewRequirement) {
    actionIntents.push(createActionIntent({
      caseState,
      policyIdentity: identity,
      type: ACTION_INTENT_TYPE.ANALYST_REVIEW,
      state: decisionAssessment.currentDecision ? ACTION_INTENT_STATE.SATISFIED : ACTION_INTENT_STATE.OPEN,
      informationNeedIds: review.reviewRequirement.relevantInformationNeedIds,
      policyGapIds: [],
      requirementIds: ["UBO-R10"],
      resolutionOptionIds: [],
      semanticTarget: {
        reviewRequirementId: review.reviewRequirement.reviewRequirementId,
        reviewType: review.reviewRequirement.reviewType,
      },
      acceptableEvidenceTypes: [],
      constraints: ["ASYNCHRONOUS_INTERNAL_REVIEW", "NO_SYNCHRONOUS_CUSTOMER_JOURNEY_DEPENDENCY"],
      reasonCode: review.reviewRequirement.reasonCode,
    }));
  }
  const fallbackApplication = applySmoFallback(context, decisionAssessment);

  const pscAssessment = assessPscDiscrepancy(context);
  if ([PSC_DISCREPANCY_STATE.POTENTIAL_DISCREPANCY, PSC_DISCREPANCY_STATE.REVIEW_REQUIRED].includes(pscAssessment.state)) {
    actionIntents = coalesceIntentDrafts([
      ...actionIntents.map((intent) => ({
        type: intent.type,
        state: intent.state,
        informationNeedIds: intent.informationNeedIds,
        policyGapIds: intent.policyGapIds,
        requirementIds: intent.requirementIds,
        resolutionOptionIds: intent.resolutionOptionIds,
        strategy: intent.strategy,
        semanticTarget: intent.semanticTarget,
        actionTemplateReference: intent.actionTemplateReference,
        acceptableEvidenceTypes: intent.acceptableEvidenceTypes,
        constraints: intent.constraints,
        reasonCode: intent.reasonCode,
      })),
      {
        type: ACTION_INTENT_TYPE.ANALYST_REVIEW,
        informationNeedIds: [], policyGapIds: [], requirementIds: ["UBO-R09"], resolutionOptionIds: [],
        semanticTarget: { discrepancyState: pscAssessment.state, differenceIds: pscAssessment.differences.map(({ differenceId }) => differenceId) },
        acceptableEvidenceTypes: [], constraints: ["DO_NOT_SUBMIT_REGULATORY_REPORT"], reasonCode: pscAssessment.reasonCode,
      },
    ]).map((draft) => draft.actionIntentId ? draft : createActionIntent({ caseState, policyIdentity: identity, state: ACTION_INTENT_STATE.OPEN, ...draft }));
  }

  const graphRiskFacts = deriveGraphRiskFacts(context);
  const trustResolution = resolutionById(requirementResolution, "UBO-R11");
  const derivedFacts = {
    ...graphRiskFacts,
    trust_in_chain: trustResolution.requirementStatus === REQUIREMENT_STATE.REVIEW_REQUIRED,
    fallback_eligible_after_exhausted_measures: decisionAssessment.eligible,
  };
  let effectiveResolutions = orchestrationRequirementUpdates(context, pscAssessment, graphRiskFacts, decisionAssessment, fallbackApplication);
  const r14 = residualCompleteness(context, effectiveResolutions);
  effectiveResolutions = effectiveResolutions.map((resolution) => resolution.requirementId === "UBO-R14"
    ? { ...resolution, requirementStatus: r14.requirementStatus, reasonCode: r14.reasonCode }
    : resolution);
  if (r14.state === "READY_FOR_COMPLETENESS_ATTESTATION") {
    const requirement = requirementById(context.policyPack, "UBO-R14");
    const option = createResolutionOption({
      caseState, policyIdentity: identity, informationNeedId: `closing-condition:${caseState.caseId}:UBO-R14`, requirementIds: ["UBO-R14"],
      strategy: RESOLUTION_STRATEGY.CUSTOMER_ATTESTATION, applicabilityState: OPTION_APPLICABILITY_STATE.APPLICABLE,
      policyBasisReferences: ["UBO-R14.resolutionStrategies[0]"], constraints: ["RESOLVES_R14_ONLY"], reasonCode: "CLOSING_COMPLETENESS_BACKSTOP_READY",
    });
    options.push(option);
    actionIntents.push(createActionIntent({
      caseState, policyIdentity: identity, type: ACTION_INTENT_TYPE.REQUEST_ATTESTATION, state: ACTION_INTENT_STATE.OPEN,
      informationNeedIds: [], policyGapIds: [], requirementIds: ["UBO-R14"], resolutionOptionIds: [option.optionId], strategy: RESOLUTION_STRATEGY.CUSTOMER_ATTESTATION,
      semanticTarget: { requirementId: "UBO-R14", factKey: requirement.factKey }, acceptableEvidenceTypes: ["customer_attestation"], constraints: ["RESOLVES_R14_ONLY"], reasonCode: "RESIDUAL_COMPLETENESS_ATTESTATION_REQUIRED",
    }));
  }

  const terminal = terminalOutcome(context, effectiveResolutions, fallbackApplication.applied, candidateAssessment);
  const signals = riskSignals(context, derivedFacts, fallbackApplication.applied);
  const customerProjection = projectionFor(
    [...informationNeeds, ...reviewDecisionNeedState.current],
    actionIntents,
    reportedReviewRequirement,
  );
  const result = {
    policyIdentity: identity,
    caseReference: cloneData(requirementResolution.caseReference),
    graphVersion: graph.graphVersion,
    requirementResolutions: effectiveResolutions,
    resolutionOptions: options.sort((left, right) => left.optionId.localeCompare(right.optionId)),
    actionIntents: uniqueData(actionIntents).sort((left, right) => left.actionIntentId.localeCompare(right.actionIntentId)),
    resolutionAttempts: cloneData(resolutionAttempts).sort((left, right) => left.sequence - right.sequence),
    fallbackReviewCandidate: candidateAssessment,
    preparatoryInformationNeeds: preparatoryState.current,
    reviewGeneratedInformationNeeds: reviewDecisionNeedState.current,
    ...(review.reviewPackage ? { fallbackReviewPackage: review.reviewPackage } : {}),
    ...(reportedReviewRequirement ? { reviewRequirement: reportedReviewRequirement } : {}),
    supersededReviewRequirementIds: review.supersededReviewRequirementIds,
    fallbackDecisionAssessment: {
      eligible: decisionAssessment.eligible,
      ...(decisionAssessment.currentDecision ? { currentDecisionId: decisionAssessment.currentDecision.decisionId } : {}),
      rejectedDecisionIds: decisionAssessment.rejectedDecisionIds,
      callerSuppliedEligibilityIgnored: Object.prototype.hasOwnProperty.call(facts, "fallback_eligible_after_exhausted_measures"),
    },
    fallbackApplication,
    pscDiscrepancyAssessment: pscAssessment,
    riskSignals: signals,
    residualCompleteness: r14,
    customerProjection,
    terminal,
  };
  assertDataOnly(result, "resolutionOrchestrationResult");
  return deepFreeze(result);
}

module.exports = {
  CUSTOMER_PROJECTION_STATE,
  ORCHESTRATION_STATE,
  PSC_DISCREPANCY_STATE,
  RESOLUTION_ORCHESTRATION_ALGORITHM,
  RISK_SIGNAL_TYPE,
  UBO_TERMINAL_OUTCOME,
  orchestrateResolution,
};
