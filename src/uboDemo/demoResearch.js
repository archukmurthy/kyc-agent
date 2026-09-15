export const DEMO_SOURCE_MODES = Object.freeze({ LIVE: "LIVE", FIXTURE: "FIXTURE", REPLAY: "REPLAY" });
export const REVIEWED_FIXTURE_ID = "V2-LAB-08";

function entityProfile(ownershipType) {
  return ["LLP", "PARTNERSHIP"].includes(ownershipType) ? "LLP" : "COMPANY";
}

export function buildResearchRequest({ demoCase, sourceMode, replayRecord }) {
  if (sourceMode === DEMO_SOURCE_MODES.FIXTURE) {
    return { operation: "START_REVIEW_FIXTURE", payload: { fixtureId: REVIEWED_FIXTURE_ID } };
  }
  if (sourceMode === DEMO_SOURCE_MODES.REPLAY) {
    return { operation: "START_REVIEW_REPLAY", payload: { replayRecord, profileId: "NOT_PROVIDED" } };
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

export function compactResearchResult(session, sourceMode) {
  const replayCapture = session?.replayCapture || null;
  const entityLabels = Object.fromEntries((session?.entityDirectory || [])
    .filter(({ entityId, party }) => entityId && party?.name)
    .map(({ entityId, party }) => [entityId, party.name]));
  const registryContexts = registryContextsForSession(session);
  return {
    status: "COMPLETE",
    sourceMode,
    sourceLabel: session?.sourceLabel || sourceMode,
    candidateSources: session?.candidateSources || [],
    decisionTargets: session?.decisionTargets || { candidateParties: [], candidateClaims: [] },
    view: latestReviewView(session),
    completedAt: new Date().toISOString(),
    replayCapture,
    demoAutoReview: session?.demoAutoReview || null,
    canonicalCompanyTypeLabel: session?.demoAutoReview?.profileReconciliation?.registryLegalForm || null,
    entityLabels,
    registryContexts,
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
  return { ...context, badges: badges.slice(0, 3), researchCoverage };
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
