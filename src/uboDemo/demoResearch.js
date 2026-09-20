export const DEMO_SOURCE_MODES = Object.freeze({ LIVE: "LIVE", FIXTURE: "FIXTURE", REPLAY: "REPLAY" });
export const REVIEWED_FIXTURE_ID = "V2-LAB-08";
export const DEMO_GRAPH_SCOPES = Object.freeze({ RELEVANT: "RELEVANT", FULL: "FULL" });
export const DEMO_GRAPH_DIMENSIONS = Object.freeze({ ALL: "ALL", OWNERSHIP: "OWNERSHIP", VOTING: "VOTING", CONTROL: "CONTROL" });
export const DEMO_CALCULATION_FIXTURES = Object.freeze({ ALICE_28: "DEMO-ALICE-28", METHOD_60_40: "V2-LAB-02" });

function entityProfile(ownershipType) {
  return ["LLP", "PARTNERSHIP"].includes(ownershipType) ? "LLP" : "COMPANY";
}

export function buildResearchRequest({ demoCase, sourceMode, replayRecord, demoFixtureId }) {
  if (demoFixtureId) return { operation: "START_DEMO_CALCULATION_FIXTURE", payload: { fixtureId: demoFixtureId } };
  if (sourceMode === DEMO_SOURCE_MODES.FIXTURE) {
    return { operation: "START_REVIEW_FIXTURE", payload: { fixtureId: REVIEWED_FIXTURE_ID } };
  }
  if (sourceMode === DEMO_SOURCE_MODES.REPLAY) {
    return { operation: "START_DEMO_REVIEW_REPLAY", payload: { replayRecord, profileId: "NOT_PROVIDED" } };
  }
  return {
    operation: "START_DEMO_REVIEW_LIVE",
    payload: {
      companyContext: {
        legalEntityName: demoCase.company.legalName,
        registrationNumber: demoCase.company.registrationNumber,
        jurisdiction: demoCase.company.countryCode,
        entityProfile: entityProfile(demoCase.company.ownershipType),
        riskLevel: "MEDIUM",
      },
      profileId: "NOT_PROVIDED",
    },
  };
}

export async function runDemoResearch(input, fetchImpl = window.fetch) {
  const request = buildResearchRequest(input);
  const response = await fetchImpl("/api/ubo-control-lab", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result?.message || result?.error || "Research could not be completed safely.");
    error.code = result?.code;
    throw error;
  }
  return result;
}

export function latestReviewView(session) {
  return session?.snapshots?.[session.snapshots.length - 1]?.view || null;
}

export function compactResearchResult(session, sourceMode, calculationMethod = "EFFECTIVE_INTEREST") {
  const replayCapture = session?.replayCapture || null;
  const entityLabels = Object.fromEntries((session?.entityDirectory || [])
    .filter(({ entityId, party }) => entityId && party?.name)
    .map(({ entityId, party }) => [entityId, party.name]));
  const registryContexts = registryContextsForSession(session);
  const entityContexts = Object.fromEntries((session?.entityDirectory || []).map(({ entityId, party }) => {
    const registry = registryContexts[entityId] || {};
    const registrationNumber = registry.registrationNumber || (party?.externalIdentifiers || []).find(({ namespace, system, identifierType }) => /COMPANIES_HOUSE|COMPANY_NUMBER|COMPANY_REGISTER/i.test(namespace || system || identifierType || ""))?.value || null;
    return [entityId, {
      entityId,
      legalName: party?.name || entityLabels[entityId] || entityId,
      registrationNumber: registrationNumber ? String(registrationNumber).trim().toUpperCase() : null,
      jurisdiction: registry.incorporatedIn || party?.jurisdiction || null,
      legalForm: registry.legalForm || party?.entityType || null,
    }];
  }));
  return {
    status: "COMPLETE",
    sourceMode,
    sourceLabel: session?.sourceLabel || sourceMode,
    candidateSources: session?.candidateSources || [],
    decisionTargets: session?.decisionTargets || { candidateParties: [], candidateClaims: [] },
    view: latestReviewView(session),
    completedAt: new Date().toISOString(),
    replayReference: replayCapture ? { replayId: replayCapture.replayId, savedAt: replayCapture.savedAt } : null,
    replay: session?.replay || null,
    demoAutoReview: session?.demoAutoReview || null,
    canonicalCompanyTypeLabel: session?.demoAutoReview?.profileReconciliation?.registryLegalForm || null,
    selectedFixtureId: session?.selectedFixtureId || null,
    entityLabels,
    registryContexts,
    entityContexts,
    analysisContext: { calculationMethod },
  };
}

function normalized(value) { return String(value || "").trim().toUpperCase(); }

function identifiers(party) {
  return new Set((party?.externalIdentifiers || []).map((item) => `${normalized(item.namespace || item.system || item.identifierType)}:${normalized(item.value)}`));
}

function sameParty(left, right) {
  const leftIds = identifiers(left);
  if ([...identifiers(right)].some((item) => leftIds.has(item))) return true;
  return normalized(left?.name) === normalized(right?.name)
    && (!left?.jurisdiction || !right?.jurisdiction || normalized(left.jurisdiction) === normalized(right.jurisdiction));
}

function isUkContext(context) {
  const country = normalized(context.incorporatedIn || context.jurisdiction);
  return ["GB", "UNITED KINGDOM", "GREAT BRITAIN", "ENGLAND", "WALES", "SCOTLAND", "NORTHERN IRELAND", "ENGLAND-WALES"].includes(country);
}

function registryPresentation(context) {
  const legalForm = String(context.legalForm || "");
  const country = context.incorporatedIn || context.jurisdiction || null;
  const badges = [];
  if (context.pscStatus === "EXEMPT") {
    if (/public limited|\bplc\b/i.test(legalForm)) badges.push({ semantic: "REGISTRY_PLC", label: "PLC", css: "registry" });
    badges.push({ semantic: "PSC_EXEMPT", label: "PSC exempt", css: "special" });
  } else if (!isUkContext(context) && country) {
    badges.push({ semantic: "REGISTRY_COUNTRY", label: String(country).toUpperCase(), css: "registry" });
    if (/public company|sociedad anonima/i.test(legalForm)) badges.push({ semantic: "PUBLIC_COMPANY", label: "Public company", css: "registry" });
    badges.push({ semantic: "RESEARCH_FRONTIER", label: "Research frontier", css: "unresolved" });
  }
  const researchCoverage = context.pscStatus === "EXEMPT"
    ? { state: "TERMINAL_SOURCE_STATUS", reason: "Companies House records a current PSC-information exemption." }
    : !isUkContext(context) && country
      ? { state: "UNSUPPORTED_JURISDICTION", reason: "Further ownership research is not available in the current UK demo research capability." }
      : { state: "EXPANDABLE", reason: "The current UK Companies House demo capability supports this jurisdiction." };
  return { ...context, registrationNumber: context.registrationNumber ? String(context.registrationNumber).trim().toUpperCase() : context.registrationNumber, badges: badges.slice(0, 3), researchCoverage };
}

export function registryContextsForSession(session) {
  const entries = session?.entityDirectory || [];
  const merged = new Map();
  allCandidateFacts({ candidateSources: session?.candidateSources || [] }).forEach(({ fact }) => {
    if (fact.type !== "ENTITY_ATTRIBUTE" || fact.attribute !== "REGISTRY_CONTEXT") return;
    const entity = entries.find(({ party }) => sameParty(party, fact.subject));
    if (!entity) return;
    const current = merged.get(entity.entityId) || { sources: [] };
    merged.set(entity.entityId, {
      ...current,
      ...fact.value,
      sources: [...current.sources, ...(fact.evidenceReferences || [])],
    });
  });
  return Object.fromEntries([...merged].map(([entityId, context]) => [entityId, registryPresentation(context)]));
}

export function allCandidateFacts(result) {
  return (result?.candidateSources || []).flatMap((source) =>
    (source.candidateFacts || []).map((fact) => ({ fact, source })));
}

export function assertionSourceState(result, source) {
  return result?.sourceMode === DEMO_SOURCE_MODES.LIVE
    ? "LIVE"
    : source?.sourceState || source?.capability || "Source";
}

export function relationshipCategory(relationship = "") {
  if (/ECONOMIC|OWNERSHIP|SURPLUS_ASSET/.test(relationship)) return "Ownership";
  if (/VOT/.test(relationship)) return "Voting";
  if (/CONTROL|APPOINT|REMOV|INFLUENCE/.test(relationship)) return "Control";
  if (/OFFICER/.test(relationship)) return "Officer";
  return "Other";
}

export function formatMeasurement(measurement) {
  if (!measurement || measurement.type === "UNKNOWN") return "Value not established";
  if (measurement.type === "EXACT") return `${measurement.value}%`;
  if (measurement.type === "RANGE") {
    const left = measurement.lowerInclusive ? "[" : "(";
    const right = measurement.upperInclusive ? "]" : ")";
    return `${left}${measurement.lowerBound}%, ${measurement.upperBound}%${right}`;
  }
  return measurement.value == null ? measurement.type : `${measurement.value}%`;
}

function combinedControlRightLabel(fact) {
  const sourceNature = String(fact?.qualifiers?.sourceNatureOfControl || "").toLowerCase();
  if (sourceNature.includes("right-to-appoint-and-remove-directors")) return "Right to appoint or remove directors";
  if (sourceNature.includes("right-to-appoint-and-remove-person")) return "Right to appoint or remove persons";
  return null;
}

export function relationshipAssertionPresentation(fact) {
  const specificControlRight = fact?.relationship === "FORMAL_CONTROL_RIGHT"
    ? combinedControlRightLabel(fact)
    : null;
  const description = specificControlRight
    || (fact?.relationship === "FORMAL_CONTROL_RIGHT"
      ? "Formal control right reported — details not available in this result"
      : String(fact?.relationship || fact?.type || "Source assertion").replaceAll("_", " "));
  const evidence = fact?.evidenceReferences?.[0];
  const sourceText = [evidence?.system, evidence?.referenceId, evidence?.locator?.source, evidence?.locator?.sourceUrl]
    .filter(Boolean).join(" ").toLowerCase();
  return {
    category: relationshipCategory(fact?.relationship),
    description,
    measurement: fact?.relationship === "FORMAL_CONTROL_RIGHT" && !fact?.measurement
      ? null
      : formatMeasurement(fact?.measurement),
    sourceDescription: sourceText.includes("companies-house") || sourceText.includes("companies house")
      ? "Recorded in Companies House PSC information"
      : null,
  };
}

function recordedStateCopy(state, route) {
  if (state === "SATISFIED" || state === "ROUTE_SATISFIED") return route === "EFFECTIVE_INTEREST"
    ? "Threshold satisfied under effective ownership"
    : route === "PSC_CONDITION_ATTRIBUTION" ? "Control-attribution route satisfied" : "At least one policy route is satisfied";
  if (state === "NOT_SATISFIED") return "This route does not meet the threshold";
  if (state === "ROUTE_NOT_SATISFIED") return "No assessed policy route meets its threshold";
  if (state === "INDETERMINATE" || state === "ROUTE_INDETERMINATE") return "Cannot determine from the available facts";
  return "Not supported / review required";
}

function calculationRoute(path, relationshipById, entityName) {
  const relationships = (path.relationshipIds || []).map((id) => relationshipById.get(id)).filter(Boolean);
  const route = relationships.length
    ? [entityName(relationships[0].subjectEntityId), ...relationships.map((item) => entityName(item.objectEntityId))].join(" → ")
    : "Recorded route";
  return {
    pathId: path.pathId,
    relationshipIds: path.relationshipIds || [],
    route,
    inputs: relationships.map(({ measurement }) => formatMeasurement(measurement)),
    contribution: path.contribution ? formatMeasurement(path.contribution) : null,
    state: path.state,
    directness: relationships.length === 1 ? "Direct" : "Indirect",
  };
}

function basisPresentation(basis, relationshipById, entityName) {
  const effectivePaths = basis.route === "EFFECTIVE_INTEREST"
    ? (basis.orderedPathReferences || []).map((path) => calculationRoute(path, relationshipById, entityName))
    : [];
  const attributionChains = (basis.attributionChains || []).map((chain) => {
    const route = calculationRoute(chain, relationshipById, entityName);
    return {
      ...route,
      state: chain.state,
      majoritySteps: (chain.majoritySteps || []).map((step) => ({
        relationshipId: step.relationshipId,
        relationshipType: step.relationshipType,
        measurement: formatMeasurement(step.measurement),
        from: entityName(step.fromEntityId),
        to: entityName(step.toEntityId),
      })),
    };
  });
  return {
    basisId: basis.basisId,
    route: basis.route,
    condition: basis.condition || null,
    dimension: basis.dimension,
    assessmentState: basis.assessmentState,
    resultLabel: recordedStateCopy(basis.assessmentState, basis.route),
    threshold: basis.threshold || null,
    aggregate: basis.recordedCalculation?.value || basis.aggregatedTargetRightValue || null,
    effectivePaths,
    attributionChains,
    relationshipIds: unique([...(basis.orderedPathReferences || []).flatMap(({ relationshipIds }) => relationshipIds || []), ...(basis.attributionChains || []).flatMap(({ relationshipIds }) => relationshipIds || [])]),
    limitations: unique([...(basis.reviewDependencies || []), ...(basis.governance?.requiredSignoffIds || []), ...((basis.recordedCalculation?.cycles || []).map(({ cycleId }) => cycleId || "Cycle recorded"))]),
    method: basis.method,
  };
}

export function demoCalculationPeople(view, calculationMethod = "EFFECTIVE_INTEREST", entityLabels = {}) {
  if (!view?.graph) return [];
  const nodes = new Map((view.graph.nodes || []).map((node) => [node.entityId, node.primaryName || node.name || node.entityId]));
  const entityName = (entityId) => entityLabels[entityId] || nodes.get(entityId) || entityId;
  const relationshipById = new Map((view.graph.relationships || []).map((relationship) => [relationship.relationshipId, relationship]));
  const bases = view.qualificationBases || view.graph.qualificationBasisRecords || [];
  return (view.qualifications || view.graph.personQualificationAssessments || []).map((assessment) => {
    const personBases = bases.filter(({ personEntityId }) => personEntityId === assessment.personEntityId);
    const selectedBases = calculationMethod === "POLICY_ALL_ROUTES"
      ? personBases
      : personBases.filter(({ route, dimension }) => route === calculationMethod && (route !== "EFFECTIVE_INTEREST" || dimension === "ECONOMIC"));
    const presentations = selectedBases.map((basis) => basisPresentation(basis, relationshipById, entityName));
    const selectedState = calculationMethod === "POLICY_ALL_ROUTES"
      ? assessment.routeStatus
      : presentations.some(({ assessmentState }) => assessmentState === "SATISFIED") ? "SATISFIED"
        : presentations.some(({ assessmentState }) => assessmentState === "INDETERMINATE") ? "INDETERMINATE"
          : presentations.length && presentations.every(({ assessmentState }) => assessmentState === "NOT_SATISFIED") ? "NOT_SATISFIED" : "REVIEW_REQUIRED";
    return {
      personEntityId: assessment.personEntityId,
      personName: entityName(assessment.personEntityId),
      overallPolicyState: assessment.routeStatus,
      overallPolicyLabel: recordedStateCopy(assessment.routeStatus, "POLICY_ALL_ROUTES"),
      selectedState,
      selectedResultLabel: recordedStateCopy(selectedState, calculationMethod),
      selectedBases: presentations,
      assessedRoutes: assessment.assessedRoutes || [],
      unassessedRoutes: assessment.unassessedRoutes || [],
    };
  });
}

export function executableCustomerBundles(view) {
  return (view?.journeyProjection?.customerWorkBundles || []).filter((bundle) =>
    bundle.state === "OPEN" && (bundle.permittedSemanticActions || []).some((action) => action.executable === true));
}

const QUESTION_GROUP = Object.freeze({
  TRUST_STATUS: "TRUST",
  NOMINEE_BEARER_STATUS: "NOMINEE",
  OTHER_SIGNIFICANT_CONTROL_STATUS: "CONTROL",
  INDEPENDENT_CORROBORATION: "EVIDENCE",
  LAYER_QUALIFIER: "STRUCTURE",
  CURRENT_OWNERSHIP_AND_CONTROL: "STRUCTURE",
  RELATIONSHIP_CURRENTNESS: "STRUCTURE",
});

function questionCopy(group) {
  return ({
    TRUST: { title: "Trust involvement", body: "Tell us whether a trust or similar legal arrangement is involved in this ownership branch." },
    NOMINEE: { title: "Nominee or bearer arrangements", body: "Tell us whether anyone holds shares or rights as a nominee, bearer, or on behalf of another person." },
    CONTROL: { title: "Other significant control", body: "Tell us whether anyone exercises significant influence or control that is not already shown." },
    EVIDENCE: { title: "Supporting ownership evidence", body: "Provide an ownership document or other independent evidence that supports the structure shown." },
    STRUCTURE: { title: "Remaining ownership structure", body: "Provide the remaining ownership or control details for this unresolved branch." },
  })[group] || { title: "Ownership information", body: "Provide the missing factual ownership or control information." };
}

function pushQuestion(groups, groupKey, item) {
  const current = groups.get(groupKey) || { ...questionCopy(groupKey), kind: groupKey === "EVIDENCE" ? "EVIDENCE_REQUEST" : "CUSTOMER_QUESTION", informationNeedIds: [], requirementIds: [], optionIds: [], actionIds: [], states: [] };
  current.informationNeedIds.push(...(item.informationNeedIds || []));
  current.requirementIds.push(...(item.requirementIds || []));
  if (item.optionId) current.optionIds.push(item.optionId);
  if (item.actionId) current.actionIds.push(item.actionId);
  current.states.push(item.state);
  groups.set(groupKey, current);
}

export function demoOpenQuestions(view) {
  if (!view) return [];
  const groups = new Map();
  const needs = new Map((view.informationNeeds || []).map((need) => [need.needId, need]));
  executableCustomerBundles(view).forEach((bundle) => {
    const concepts = (bundle.informationNeedIds || []).map((id) => needs.get(id)?.concept).filter(Boolean);
    const groupKey = concepts.map((concept) => QUESTION_GROUP[concept]).find(Boolean) || "STRUCTURE";
    pushQuestion(groups, groupKey, { informationNeedIds: bundle.informationNeedIds, requirementIds: bundle.requirementIds, actionId: bundle.actionIds?.[0], state: "CURRENT_EXECUTABLE" });
  });
  (view.plan?.customerActions || []).forEach((action) => {
    const concepts = (action.coveredInformationNeedIds || []).map((id) => needs.get(id)?.concept).filter(Boolean);
    const groupKey = concepts.map((concept) => QUESTION_GROUP[concept]).find(Boolean) || (String(action.semanticActionType).includes("EVIDENCE") ? "EVIDENCE" : "STRUCTURE");
    pushQuestion(groups, groupKey, { informationNeedIds: action.coveredInformationNeedIds, requirementIds: action.coveredRequirementIds, actionId: action.actionId, state: view.plan.state === "CUSTOMER_RESOLUTION" ? "CURRENT_EXECUTABLE" : "DEFERRED_SYSTEM_FIRST" });
  });
  const alreadyCovered = new Set([...groups.values()].flatMap(({ informationNeedIds }) => informationNeedIds));
  (view.snapshot?.decisionContent?.resolutionOptionsV2 || []).filter((option) => option.actor === "CUSTOMER").forEach((option) => {
    const uncovered = (option.informationNeedIds || []).filter((id) => !alreadyCovered.has(id));
    if (!uncovered.length) return;
    const concepts = uncovered.map((id) => needs.get(id)?.concept).filter(Boolean);
    const groupKey = concepts.map((concept) => QUESTION_GROUP[concept]).find(Boolean);
    if (!groupKey) return;
    pushQuestion(groups, groupKey, {
      informationNeedIds: uncovered,
      requirementIds: option.requirementIds,
      optionId: option.optionId,
      state: option.contentReadiness === "REQUIRES_POLICY_CONTENT" ? "DEMO_CONTENT_FALLBACK" : "DEFERRED_SYSTEM_FIRST",
    });
  });
  return [...groups.values()].map((item) => ({
    ...item,
    informationNeedIds: [...new Set(item.informationNeedIds)].sort(),
    requirementIds: [...new Set(item.requirementIds)].sort(),
    optionIds: [...new Set(item.optionIds)].sort(),
    actionIds: [...new Set(item.actionIds)].sort(),
    state: item.states.includes("CURRENT_EXECUTABLE") ? "CURRENT_EXECUTABLE" : item.states.includes("DEFERRED_SYSTEM_FIRST") ? "DEFERRED_SYSTEM_FIRST" : "DEMO_CONTENT_FALLBACK",
    contentApproved: !item.states.includes("DEMO_CONTENT_FALLBACK"),
  }));
}

export function internalReviewCount(view) {
  const review = view?.journeyProjection?.internalReview;
  return (review?.actions || []).length + (review?.requirements || []).length;
}

function graphRelationshipDimension(relationship) {
  if (relationship.dimension === "ECONOMIC" || /ECONOMIC|OWNERSHIP|SURPLUS_ASSET/.test(relationship.relationshipType || "")) return DEMO_GRAPH_DIMENSIONS.OWNERSHIP;
  if (relationship.dimension === "VOTING" || /VOT/.test(relationship.relationshipType || "")) return DEMO_GRAPH_DIMENSIONS.VOTING;
  return DEMO_GRAPH_DIMENSIONS.CONTROL;
}

export function demoSourceRelevantEntityIds(graph, result = {}) {
  if (!graph) return [];
  const entities = Object.fromEntries(unique([...Object.keys(result.entityLabels || {}), ...Object.keys(result.registryContexts || {}), ...Object.keys(result.entityContexts || {})]).map((entityId) => [entityId, {
    entityId,
    legalName: result.entityContexts?.[entityId]?.legalName || result.entityLabels?.[entityId] || result.registryContexts?.[entityId]?.legalName,
    registrationNumber: result.entityContexts?.[entityId]?.registrationNumber || result.registryContexts?.[entityId]?.registrationNumber,
  }]));
  const subject = entities[graph.subjectEntityId] || { legalName: result.entityLabels?.[graph.subjectEntityId] || graph.nodes?.find(({ entityId }) => entityId === graph.subjectEntityId)?.primaryName };
  const partyRegistration = (party) => (party?.externalIdentifiers || []).map(({ value }) => normalized(value)).find(Boolean);
  const matchesContext = (party, context) => party && context && (normalized(party.name) === normalized(context.legalName)
    || (partyRegistration(party) && partyRegistration(party) === normalized(context.registrationNumber)));
  return unique(allCandidateFacts(result).filter(({ fact }) => fact.type === "RELATIONSHIP" && matchesContext(fact.object, subject)).flatMap(({ fact }) =>
    Object.values(entities).filter((context) => matchesContext(fact.subject, context)).map(({ entityId }) => entityId)));
}

export function projectDemoGraph(graph, { scope = DEMO_GRAPH_SCOPES.RELEVANT, dimension = DEMO_GRAPH_DIMENSIONS.ALL, additionalRelevantEntityIds = [] } = {}) {
  if (!graph) return graph;
  const relationships = graph.relationships || [];
  const relevantIds = new Set([graph.subjectEntityId, ...additionalRelevantEntityIds]);
  const pending = [...relevantIds];
  while (pending.length) {
    const targetId = pending.shift();
    relationships.filter(({ objectEntityId }) => objectEntityId === targetId).forEach(({ subjectEntityId }) => {
      if (relevantIds.has(subjectEntityId)) return;
      relevantIds.add(subjectEntityId);
      pending.push(subjectEntityId);
    });
  }
  const scopedRelationships = relationships.filter((relationship) => scope === DEMO_GRAPH_SCOPES.FULL
    || (relevantIds.has(relationship.subjectEntityId) && relevantIds.has(relationship.objectEntityId)));
  const visibleRelationships = scopedRelationships.filter((relationship) => dimension === DEMO_GRAPH_DIMENSIONS.ALL || graphRelationshipDimension(relationship) === dimension);
  const visibleNodeIds = new Set(scope === DEMO_GRAPH_SCOPES.FULL
    ? (graph.nodes || []).map(({ entityId }) => entityId)
    : [...relevantIds]);
  visibleNodeIds.add(graph.subjectEntityId);
  return {
    ...graph,
    nodes: (graph.nodes || []).filter(({ entityId }) => visibleNodeIds.has(entityId)),
    relationships: visibleRelationships,
  };
}

function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
function human(value) { return String(value || "").replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()); }

function targetIdsForNeed(need, view) {
  const ids = [need.frontierEntityId, need.targetReference?.frontierEntityId, need.targetReference?.entityId, need.targetReference?.personEntityId, ...(need.targetReference?.groupPersonIds || [])];
  const review = (view?.graph?.reviewRequirements || []).find(({ relatedInformationNeedIds, informationNeedIds }) =>
    [...(relatedInformationNeedIds || []), ...(informationNeedIds || [])].includes(need.needId));
  ids.push(...(review?.entityIds || []), ...(review?.personIds || []));
  return unique(ids);
}

function routeState(option, currentActionIds) {
  if (currentActionIds.has(option.optionId) || currentActionIds.has(option.actionId)) return "CURRENT";
  if (option.contentReadiness === "REQUIRES_POLICY_CONTENT") return "NOT_ENABLED";
  return "AVAILABLE_LATER";
}

function dispositionFor(need, view, options, actions) {
  const current = actions.find((action) => (action.coveredInformationNeedIds || []).includes(need.needId));
  const internal = (view?.journeyProjection?.internalReview?.requirements || []).find((review) =>
    [...(review.informationNeedIds || []), ...(review.relatedInformationNeedIds || [])].includes(need.needId));
  if (internal || need.concept === "LLP_GOVERNANCE_CONTROL_BASIS") return { code: "INTERNAL_REVIEW", label: "Internal review", summary: "A specialist must review how the LLP agreement and control rights should be interpreted." };
  if (current?.actor === "CUSTOMER" && view?.plan?.state === "CUSTOMER_RESOLUTION") return { code: "NEEDED_NOW", label: "Needed from you now", summary: "This is part of the current customer action wave." };
  if (current?.actor === "SYSTEM") return { code: "SYSTEM_CHECKING", label: "System checking", summary: "The current plan is checking existing records before asking the customer." };
  if (options.some((option) => option.contentReadiness === "REQUIRES_POLICY_CONTENT")) return { code: "QUESTION_NOT_ENABLED", label: "Question not enabled", summary: "A possible customer route exists, but its governed question content is not approved for use." };
  if (options.some((option) => option.actor === "CUSTOMER")) return { code: "POSSIBLE_LATER", label: "Possible later request", summary: "A customer route exists, but it is not executable in the current planner wave." };
  return { code: "SYSTEM_CHECKING", label: "System checking", summary: "No current customer action is assigned for this open cause." };
}

function missingFactCopy(need) {
  return ({
    CURRENT_OWNERSHIP_AND_CONTROL: "The current upstream holder set and supported ownership/control position for this entity.",
    INDEPENDENT_CORROBORATION: "A distinct independent source corroborating the researched ownership structure.",
    LAYER_QUALIFIER: "Whether this layer uses a compatible denominator and sufficiently described share or economic-interest treatment.",
    LLP_GOVERNANCE_CONTROL_BASIS: "A reviewer interpretation of the LLP agreement and the recorded control rights.",
    NOMINEE_BEARER_STATUS: "Whether nominee, bearer or on-behalf-of arrangements affect this company.",
    TRUST_STATUS: "Whether a trust or similar legal arrangement is present in this ownership chain.",
    VOTING_CONTROL_STATUS: "The company-level voting and control position that is not established by the current source facts.",
  })[need.concept] || human(need.concept);
}

function scopeCopy(need, targetIds, subjectId) {
  const relationships = need.affected?.relationshipIds || [];
  if (need.concept === "INDEPENDENT_CORROBORATION" || (!targetIds.length && relationships.length > 1)) return "Whole ownership structure";
  if (relationships.length === 1) return "This relationship";
  if (targetIds.length > 1) return "Named entities and people in the ownership chain";
  if (targetIds[0] === subjectId) return "Company under review";
  return "Company in the ownership chain";
}

export function accountOpenItems(view, result = {}) {
  if (!view) return [];
  const allOptions = view.snapshot?.decisionContent?.resolutionOptionsV2 || [];
  const currentActions = [...(view.plan?.recommendedActions || []), ...(view.plan?.customerActions || [])];
  const currentActionIds = new Set(currentActions.flatMap(({ actionId, optionId }) => [actionId, optionId]).filter(Boolean));
  const entities = Object.fromEntries(unique([
    ...Object.keys(result.entityLabels || {}), ...Object.keys(result.registryContexts || {}), ...Object.keys(result.entityContexts || {}),
  ]).map((entityId) => {
    const existing = result.entityContexts?.[entityId] || {};
    const registry = result.registryContexts?.[entityId] || {};
    return [entityId, {
      entityId,
      legalName: existing.legalName || result.entityLabels?.[entityId] || registry.legalName || entityId,
      registrationNumber: existing.registrationNumber || (registry.registrationNumber ? String(registry.registrationNumber).trim().toUpperCase() : null),
      jurisdiction: existing.jurisdiction || registry.incorporatedIn || registry.jurisdiction || null,
      legalForm: existing.legalForm || registry.legalForm || null,
    }];
  }));
  return (view.informationNeeds || []).filter(({ status }) => status === "OPEN").map((need) => {
    const options = allOptions.filter((option) => (option.informationNeedIds || []).includes(need.needId));
    const actions = currentActions.filter((action) => (action.coveredInformationNeedIds || []).includes(need.needId));
    const targetIds = targetIdsForNeed(need, view);
    const targetContexts = targetIds.map((id) => entities[id] || { entityId: id, legalName: result.entityLabels?.[id] || id }).filter(Boolean);
    const subject = entities[view.graph?.subjectEntityId] || { entityId: view.graph?.subjectEntityId, legalName: view.graph?.nodes?.find(({ entityId }) => entityId === view.graph?.subjectEntityId)?.primaryName || "the company under review" };
    const disposition = dispositionFor(need, view, options, actions);
    const relatedRelationshipIds = unique(need.affected?.relationshipIds || []);
    const routes = [...options.map((option) => ({
      actor: option.actor,
      action: option.semanticActionType,
      template: option.actionTemplateReference?.templateId || option.actionTemplateReference || null,
      contentReadiness: option.contentReadiness,
      requiredSignoffs: option.requiredSignoffs || [],
      state: routeState(option, currentActionIds),
    })), ...actions.map((action) => ({
      actor: action.actor,
      action: action.semanticActionType,
      contentReadiness: action.contentReadiness,
      requiredSignoffs: action.requiredSignoffs || [],
      state: action.actor === "SYSTEM" || view.plan?.state === "CUSTOMER_RESOLUTION" ? "CURRENT" : "AVAILABLE_LATER",
    }))];
    return {
      needId: need.needId,
      concept: need.concept,
      title: human(need.concept),
      requirementIds: unique(need.requiredByRequirementIds || []),
      disposition,
      targetContexts,
      about: targetContexts.length ? targetContexts : [subject],
      scope: scopeCopy(need, targetIds, view.graph?.subjectEntityId),
      missing: missingFactCopy(need),
      why: need.reasonCode ? human(need.reasonCode) : "The current review requirements are not yet satisfied.",
      routes,
      relatedRelationshipIds,
      selection: relatedRelationshipIds.length === 1 ? { kind: "relationship", id: relatedRelationshipIds[0] } : targetIds[0] ? { kind: "entity", id: targetIds[0] } : { kind: "unresolved", id: need.needId },
      targetChoices: targetContexts.map(({ entityId, legalName, registrationNumber }) => ({ entityId, label: `${legalName}${registrationNumber ? ` · ${registrationNumber}` : ""}` })),
    };
  });
}

export function demoReviewPresentations(view, result = {}) {
  const items = accountOpenItems(view, result);
  return Object.fromEntries((view?.graph?.reviewRequirements || []).map((review) => {
    const linked = items.find(({ concept }) => concept === "LLP_GOVERNANCE_CONTROL_BASIS");
    return [review.reviewRequirementId, {
      title: "LLP governance interpretation",
      summary: "Registry facts identify people and rights, but the LLP agreement still needs an internal interpretation before those rights can be treated as a final control conclusion.",
      assumption: review.workingAssumptionRef || "A-06-WA-01",
      signoffs: review.requiredSignoffIds || ["A-06"],
      entities: linked?.about || [],
    }];
  }));
}
