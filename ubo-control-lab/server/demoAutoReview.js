"use strict";

const { createHash } = require("node:crypto");
const { applyDemoAutoReviewDecisions } = require("./reviewLabEngine");

const SAFE_RELATIONSHIPS = new Set([
  "ECONOMIC_OWNERSHIP",
  "VOTING_RIGHTS",
  "BOARD_APPOINTMENT_RIGHT",
  "BOARD_REMOVAL_RIGHT",
  "FORMAL_CONTROL_RIGHT",
  "SIGNIFICANT_INFLUENCE_OR_CONTROL",
]);

const PERCENTAGE_RELATIONSHIPS = new Set(["ECONOMIC_OWNERSHIP", "VOTING_RIGHTS"]);

function normalize(value) { return String(value || "").trim().toUpperCase(); }
function stableId(prefix, value) { return `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`; }

function identifierKey(party) {
  const identifiers = (party?.externalIdentifiers || [])
    .filter((item) => item?.value && (item.namespace || item.system || item.identifierType))
    .map((item) => `${normalize(item.namespace || item.system || item.identifierType)}:${normalize(item.value)}`)
    .sort();
  return identifiers.length ? `IDENTIFIERS:${identifiers.join("|")}` : null;
}

function nameKey(party) {
  return party?.name ? `NAME:${normalize(party.name)}|${normalize(party.entityType)}|${normalize(party.jurisdiction)}` : null;
}

function partyKey(party) {
  if (party?.entityId) return `ENTITY:${party.entityId}`;
  return identifierKey(party) || nameKey(party);
}

function validMeasurement(fact) {
  if (!PERCENTAGE_RELATIONSHIPS.has(fact.relationship)) return fact.measurement === undefined;
  const measurement = fact.measurement;
  if (measurement?.type === "EXACT") return Number.isFinite(measurement.value) && measurement.value >= 0 && measurement.value <= 100;
  if (measurement?.type !== "RANGE") return false;
  return Number.isFinite(measurement.lowerBound) && Number.isFinite(measurement.upperBound)
    && measurement.lowerBound >= 0 && measurement.upperBound <= 100
    && measurement.lowerBound <= measurement.upperBound
    && typeof measurement.lowerInclusive === "boolean" && typeof measurement.upperInclusive === "boolean";
}

function sourceBacked(fact) {
  return Array.isArray(fact?.evidenceReferences) && fact.evidenceReferences.some((reference) => reference?.referenceId);
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function prepareDemoLiveDiscoveryBody(body) {
  return { ...clone(body), forceRefresh: true };
}

function sameRegisteredSubject(party, subject) {
  if (!party || !subject) return false;
  if (party.entityId && subject.entityId && party.entityId === subject.entityId) return true;
  const subjectIds = new Set((subject.externalIdentifiers || []).map(({ value }) => normalize(value)).filter(Boolean));
  return (party.externalIdentifiers || []).some(({ value }) => subjectIds.has(normalize(value)));
}

function prepareDemoReplayRecord(replayRecord) {
  const prepared = clone(replayRecord);
  const requestedProfile = normalize(prepared?.companyContext?.entityProfile) || "COMPANY";
  const targetFacts = (prepared?.discoveryResult?.candidateFacts || []).filter((fact) =>
    fact.type === "RELATIONSHIP" && sameRegisteredSubject(fact.object, prepared.subject));
  const registryLegalForm = targetFacts.map((fact) => fact.qualifiers?.objectRegistryLegalForm).find(Boolean) || null;
  const registryCompanyType = targetFacts.map((fact) => fact.qualifiers?.objectRegistryCompanyType).find(Boolean) || null;
  const registryEntityProfile = registryLegalForm || registryCompanyType
    ? targetFacts.map((fact) => normalize(fact.object?.entityType)).find((value) => ["COMPANY", "LLP", "PARTNERSHIP"].includes(value))
    : null;
  const supportingFacts = (prepared?.discoveryResult?.candidateFacts || []).filter((fact) =>
    fact.type === "RELATIONSHIP"
      && fact.relationship === "ECONOMIC_OWNERSHIP"
      && fact.qualifiers?.entityProfile === "LLP"
      && fact.qualifiers?.economicInterestConcept === "SURPLUS_ASSET_RIGHTS"
      && sameRegisteredSubject(fact.object, prepared.subject)
      && sourceBacked(fact));
  const effectiveProfile = ["LLP", "PARTNERSHIP"].includes(registryEntityProfile)
    ? "LLP"
    : supportingFacts.length ? "LLP" : requestedProfile;
  if (effectiveProfile !== requestedProfile) {
    prepared.companyContext.entityProfile = effectiveProfile;
    prepared.subject.entityType = effectiveProfile;
    prepared.replayId = `${prepared.replayId}:demo-profile:${effectiveProfile}`;
  }
  return {
    replayRecord: prepared,
    reconciliation: {
      contractVersion: "ubo-demo-target-profile-reconciliation-v1",
      requestedProfile,
      effectiveProfile,
      changed: effectiveProfile !== requestedProfile,
      basis: registryEntityProfile ? "SOURCE_BACKED_REGISTRY_PROFILE" : supportingFacts.length ? "SOURCE_BACKED_LLP_SURPLUS_ASSET_RELATIONSHIP" : "DEMO_INPUT_PROFILE_RETAINED",
      registryEntityProfile: registryEntityProfile || null,
      registryLegalForm,
      registryCompanyType,
      sourceCandidateFactIds: supportingFacts.map(({ factId }) => factId).filter(Boolean).sort(),
    },
  };
}

function comparableFact(fact) {
  return JSON.stringify({ measurement: fact.measurement || null, qualifiers: fact.qualifiers || null });
}

function isCurrentFact(fact) {
  const qualifiers = fact.qualifiers || {};
  const currentState = normalize(qualifiers.currentState);
  const current = ["CURRENT", "ACTIVE"].includes(currentState) || qualifiers.isCurrent === true;
  const ceased = ["CEASED", "HISTORICAL"].includes(currentState) || qualifiers.isCurrent === false
    || qualifiers.ceased === true || qualifiers.historical === true || Boolean(qualifiers.ceasedAt);
  return current && !ceased;
}

function measurementMinimum(measurement) {
  return measurement.type === "EXACT" ? measurement.value : measurement.lowerBound;
}

function buildPlan(session) {
  const facts = (session.candidateSources || []).flatMap((source) => source.candidateFacts || []);
  const factById = new Map(facts.map((fact) => [fact.factId, fact]));
  const partyTargets = session.decisionTargets?.candidateParties || [];
  const claimTargets = session.decisionTargets?.candidateClaims || [];
  const targetsByClaim = new Map();
  for (const target of partyTargets) {
    if (!targetsByClaim.has(target.claimId)) targetsByClaim.set(target.claimId, []);
    targetsByClaim.get(target.claimId).push(target);
  }

  const nameOnlyCounts = new Map();
  for (const target of partyTargets) {
    if (target.party?.entityId || identifierKey(target.party)) continue;
    const key = nameKey(target.party);
    if (key) nameOnlyCounts.set(key, (nameOnlyCounts.get(key) || 0) + 1);
  }

  const conflictGroups = new Map();
  for (const target of claimTargets) {
    const fact = factById.get(target.originatingCandidateFact?.candidateFactId);
    if (!fact) continue;
    const key = `${partyKey(fact.subject)}>${partyKey(fact.object)}:${fact.relationship}`;
    if (!conflictGroups.has(key)) conflictGroups.set(key, []);
    conflictGroups.get(key).push(fact);
  }
  const conflictingFactIds = new Set();
  for (const group of conflictGroups.values()) {
    if (new Set(group.map(comparableFact)).size > 1) group.forEach((fact) => conflictingFactIds.add(fact.factId));
  }

  const entityIdByStrongIdentity = new Map((session.entityDirectory || []).map((entry) => [partyKey(entry.party), entry.entityId]));
  const identityDecisions = partyTargets.map((target) => {
    const strongKey = target.party?.entityId ? `ENTITY:${target.party.entityId}` : identifierKey(target.party);
    const weakKey = nameKey(target.party);
    const ambiguousName = !strongKey && (!weakKey || nameOnlyCounts.get(weakKey) !== 1);
    if (ambiguousName) return { candidatePartyKey: target.candidatePartyKey, action: "LEAVE_UNRESOLVED" };
    const identityKey = strongKey || weakKey;
    const existingEntityId = entityIdByStrongIdentity.get(identityKey);
    if (existingEntityId) return { candidatePartyKey: target.candidatePartyKey, action: "RESOLVE_EXISTING", entityId: existingEntityId };
    const entityId = target.party.entityId || stableId(`${session.caseId}:review-entity`, target.candidatePartyKey);
    entityIdByStrongIdentity.set(identityKey, entityId);
    return { candidatePartyKey: target.candidatePartyKey, action: "REGISTER_NEW" };
  });
  const identityDecisionByPartyKey = new Map(identityDecisions.map((decision) => [decision.candidatePartyKey, decision]));

  const otherwiseSafeByClaim = new Map(claimTargets.map((target) => {
    const fact = factById.get(target.originatingCandidateFact?.candidateFactId);
    const endpointsSafe = (targetsByClaim.get(target.claimId) || []).every((partyTarget) => identityDecisionByPartyKey.get(partyTarget.candidatePartyKey)?.action !== "LEAVE_UNRESOLVED");
    const safe = fact && fact.type === "RELATIONSHIP" && SAFE_RELATIONSHIPS.has(fact.relationship)
      && sourceBacked(fact) && validMeasurement(fact) && fact.qualifiers?.requiresInterpretation !== true
      && !conflictingFactIds.has(fact.factId) && endpointsSafe;
    return [target.claimId, safe];
  }));

  const percentageGroups = new Map();
  for (const target of claimTargets) {
    const fact = factById.get(target.originatingCandidateFact?.candidateFactId);
    if (!otherwiseSafeByClaim.get(target.claimId) || !PERCENTAGE_RELATIONSHIPS.has(fact.relationship) || !isCurrentFact(fact)) continue;
    const groupKey = `${fact.relationship}:${partyKey(fact.object)}`;
    if (!percentageGroups.has(groupKey)) percentageGroups.set(groupKey, new Map());
    const slotKey = `${partyKey(fact.subject)}>${partyKey(fact.object)}:${fact.relationship}:${comparableFact(fact)}`;
    if (!percentageGroups.get(groupKey).has(slotKey)) percentageGroups.get(groupKey).set(slotKey, []);
    percentageGroups.get(groupKey).get(slotKey).push(fact);
  }
  const impossibleMinimumFactIds = new Set();
  for (const slots of percentageGroups.values()) {
    const minimum = [...slots.values()].reduce((total, factsForSlot) => total + measurementMinimum(factsForSlot[0].measurement), 0);
    if (minimum > 100) {
      for (const factsForSlot of slots.values()) factsForSlot.forEach((fact) => impossibleMinimumFactIds.add(fact.factId));
    }
  }

  const claimDecisions = claimTargets.map((target) => {
    const fact = factById.get(target.originatingCandidateFact?.candidateFactId);
    const safe = otherwiseSafeByClaim.get(target.claimId) && !impossibleMinimumFactIds.has(fact.factId);
    return { claimId: target.claimId, resultingState: safe ? "OPERATIVE" : "DISPUTED" };
  });

  return {
    identityDecisions,
    claimDecisions,
    summary: {
      operativeClaims: claimDecisions.filter(({ resultingState }) => resultingState === "OPERATIVE").length,
      unresolvedClaims: claimDecisions.filter(({ resultingState }) => resultingState !== "OPERATIVE").length,
      resolvedIdentities: identityDecisions.filter(({ action }) => action !== "LEAVE_UNRESOLVED").length,
      unresolvedIdentities: identityDecisions.filter(({ action }) => action === "LEAVE_UNRESOLVED").length,
    },
  };
}

function autoReviewDemoSession(session, recordedAt = new Date().toISOString()) {
  if (!session || session.sourceState !== "LIVE" || session.mode !== "SUCCESSOR_REVIEW") {
    throw new TypeError("Demo automatic review requires a live successor-review session");
  }
  const plan = buildPlan(session);
  const reviewed = applyDemoAutoReviewDecisions({ session, identityDecisions: plan.identityDecisions, claimDecisions: plan.claimDecisions, recordedAt });
  reviewed.demoAutoReview = { contractVersion: "ubo-demo-auto-review-v1", ...plan.summary, recordedAt, provisional: true, ...(session.demoProfileReconciliation ? { profileReconciliation: clone(session.demoProfileReconciliation) } : {}) };
  reviewed.sourceLabel = `Live Discovery · ${reviewed.companyContext.legalEntityName} · provisional demo result`;
  return reviewed;
}

module.exports = Object.freeze({ SAFE_RELATIONSHIPS, autoReviewDemoSession, buildPlan, prepareDemoLiveDiscoveryBody, prepareDemoReplayRecord });
