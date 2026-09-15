export const DEMO_SOURCE_MODES = Object.freeze({ LIVE: "LIVE", FIXTURE: "FIXTURE", REPLAY: "REPLAY" });
export const REVIEWED_FIXTURE_ID = "V2-LAB-08";

function entityProfile(ownershipType) {
  return ownershipType === "LLP" ? "LLP" : "COMPANY";
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
    entityLabels,
  };
}

export function allCandidateFacts(result) {
  return (result?.candidateSources || []).flatMap((source) =>
    (source.candidateFacts || []).map((fact) => ({ fact, source })));
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

export function internalReviewCount(view) {
  const review = view?.journeyProjection?.internalReview;
  return (review?.actions || []).length + (review?.requirements || []).length;
}
