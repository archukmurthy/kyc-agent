// CommonJS on purpose: the server recomputes with this same code (UBO-13).
const DISCOVERY_STATE = Object.freeze({
  DISCOVERY_IN_PROGRESS: "DISCOVERY_IN_PROGRESS",
  READY_FOR_IDV: "READY_FOR_IDV",
  IDV_IN_PROGRESS: "IDV_IN_PROGRESS",
  IDV_COMPLETE: "IDV_COMPLETE",
});

const VERIFICATION_REASON = Object.freeze({
  OWNERSHIP_UBO: "OWNERSHIP_UBO",
  VOTING_RIGHTS_UBO: "VOTING_RIGHTS_UBO",
  BOARD_CONTROL_UBO: "BOARD_CONTROL_UBO",
  SIGNIFICANT_INFLUENCE_UBO: "SIGNIFICANT_INFLUENCE_UBO",
  SENIOR_MANAGING_OFFICIAL_FALLBACK: "SENIOR_MANAGING_OFFICIAL_FALLBACK",
});

const BASIS_TO_REASON = Object.freeze({
  SHARE_OWNERSHIP: VERIFICATION_REASON.OWNERSHIP_UBO,
  VOTING_RIGHTS: VERIFICATION_REASON.VOTING_RIGHTS_UBO,
  BOARD_CONTROL: VERIFICATION_REASON.BOARD_CONTROL_UBO,
  SIGNIFICANT_INFLUENCE: VERIFICATION_REASON.SIGNIFICANT_INFLUENCE_UBO,
});

function normalized(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, " "); }
function identityKey(item) { return normalized(item?.personId || item?.personName); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function hash(value) {
  let result = 2166136261;
  const input = JSON.stringify(value);
  for (let index = 0; index < input.length; index += 1) {
    result ^= input.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}
function event(type, versionId, details = {}, occurredAt) {
  return { eventId: `ubo-audit:${type.toLowerCase()}:${hash([versionId, details])}`, type, assessmentVersionId: versionId, occurredAt, ...details };
}
function completionFor(completions, item) {
  const key = identityKey(item);
  return completions.find((completion) => identityKey(completion) === key);
}
function reasonDetail(code, assessment, fallbackPerson) {
  if (code === VERIFICATION_REASON.OWNERSHIP_UBO) {
    const value = assessment?.aggregateEffectiveOwnership?.value;
    return value == null ? "Identified through company ownership." : `Aggregate effective ownership is ${value}%.`;
  }
  if (code === VERIFICATION_REASON.VOTING_RIGHTS_UBO) return "Identified through qualifying voting rights or control.";
  if (code === VERIFICATION_REASON.BOARD_CONTROL_UBO) return "Identified through board appointment or removal rights.";
  if (code === VERIFICATION_REASON.SIGNIFICANT_INFLUENCE_UBO) return "Identified through other significant influence or control.";
  if (code === VERIFICATION_REASON.SENIOR_MANAGING_OFFICIAL_FALLBACK) return `No individual beneficial owner was established through ownership or control${fallbackPerson?.role ? `; ${fallbackPerson.role} was identified as the senior managing official` : ""}.`;
  return "Identity verification is required.";
}

function canonicalPopulation(trace, completions, assessmentVersionId) {
  const people = new Map();
  const diagnostics = [];
  const ownershipAssessments = new Map((trace.personOwnershipAssessments || []).map((item) => [identityKey(item), item]));
  const candidates = [
    ...(trace.uboAssessments || []).map((item) => ({ ...item, fallback: false })),
    ...(trace.fallback?.people || []).map((item) => ({ ...item, idvRequired: item.cddIdentityVerificationRequired === true, bases: [VERIFICATION_REASON.SENIOR_MANAGING_OFFICIAL_FALLBACK], fallback: true })),
  ];
  candidates.forEach((item) => {
    if (item.idvRequired !== true) return;
    if (item.partyType !== "NATURAL_PERSON") {
      diagnostics.push({ code: "LEGAL_ENTITY_EXCLUDED_FROM_IDV", partyId: item.personId, partyName: item.personName, message: "A legal entity was excluded from the natural-person identity-verification population." });
      return;
    }
    const key = identityKey(item);
    if (!key) return;
    const assessment = ownershipAssessments.get(key);
    const reasonCodes = item.fallback
      ? [VERIFICATION_REASON.SENIOR_MANAGING_OFFICIAL_FALLBACK]
      : unique((item.bases || []).map((basis) => BASIS_TO_REASON[basis] || (Object.values(VERIFICATION_REASON).includes(basis) ? basis : null)));
    const existing = people.get(key) || {
      personId: item.personId || key,
      personName: item.personName,
      partyType: "NATURAL_PERSON",
      role: item.fallback ? "Senior managing official" : "Beneficial owner",
      reasons: [],
      currentRequirementStatus: "REQUIRED",
      verificationStatus: "NOT_STARTED",
      assessmentVersionId,
    };
    existing.reasons = unique([...existing.reasons.map(({ code }) => code), ...reasonCodes]).map((code) => ({ code, detail: reasonDetail(code, assessment, item.fallback ? item : null) }));
    const completion = completionFor(completions, existing);
    if (completion) existing.verificationStatus = "COMPLETED";
    people.set(key, existing);
  });
  return { population: [...people.values()], diagnostics };
}

function blockingIssues(trace, pendingRecalculation) {
  const issues = [];
  if (pendingRecalculation) issues.push({ code: "ASSESSMENT_RECALCULATION_PENDING", message: "We are validating the information you provided." });
  if (trace.ownershipResolution?.status !== "COMPLETE") issues.push({ code: "OWNERSHIP_DISCOVERY_INCOMPLETE", message: trace.ownershipResolution?.status === "EVIDENCE_REQUIRED" ? "Upload the requested supporting document to continue." : "Complete the remaining ownership questions to continue." });
  if ((trace.questions || []).some(({ status }) => status === "OPEN")) issues.push({ code: "BLOCKING_QUESTIONS_OPEN", message: "Complete the remaining questions to continue." });
  if ((trace.evidence || []).some(({ status }) => status !== "SATISFIED")) issues.push({ code: "REQUIRED_EVIDENCE_OPEN", message: "Required supporting evidence must be resolved before identity verification." });
  if ((trace.ownershipFacts || []).some(({ resolutionStatus }) => ["UNRESOLVED", "REQUIRES_ANALYST_REVIEW"].includes(resolutionStatus))) issues.push({ code: "MATERIAL_OWNERSHIP_UNRESOLVED", message: "An ownership issue that can affect who requires verification is still unresolved." });
  const hasUbo = (trace.uboAssessments || []).some(({ partyType, idvRequired }) => partyType === "NATURAL_PERSON" && idvRequired === true);
  const fallbackIdentified = trace.fallback?.outcome === "FALLBACK_SENIOR_MANAGING_OFFICIAL_IDENTIFIED" && (trace.fallback?.people || []).length > 0;
  if (!hasUbo && !fallbackIdentified && trace.controlResolution?.status !== "COMPLETE") issues.push({ code: "CONTROL_DISCOVERY_INCOMPLETE", message: "Control discovery must finish before identity verification." });
  if (!hasUbo && !fallbackIdentified && trace.controlResolution?.status === "COMPLETE") issues.push({ code: "FALLBACK_DISCOVERY_INCOMPLETE", message: "Senior-management information is required before identity verification." });
  return issues.filter((item, index, all) => all.findIndex(({ code }) => code === item.code) === index);
}

function assessmentInput(trace, pendingRecalculation) {
  return {
    ownershipResolution: trace.ownershipResolution,
    controlResolution: trace.controlResolution,
    fallback: trace.fallback,
    personOwnershipAssessments: trace.personOwnershipAssessments,
    uboAssessments: trace.uboAssessments,
    questions: (trace.questions || []).map(({ id, status, answer }) => ({ id, status, answer })),
    evidence: (trace.evidence || []).map(({ id, status }) => ({ id, status })),
    ownershipFacts: (trace.ownershipFacts || []).map(({ id, resolutionStatus, resultingFact }) => ({ id, resolutionStatus, resultingFact })),
    pendingRecalculation,
  };
}

function changedEvents(previousTrace, trace, assessmentVersionId, occurredAt) {
  const events = [];
  const previousAnswers = new Map((previousTrace?.questions || []).filter(({ answer }) => answer !== undefined).map((item) => [item.id, item.answer]));
  (trace.questions || []).filter(({ answer }) => answer !== undefined).forEach((item) => {
    if (!previousAnswers.has(item.id) || previousAnswers.get(item.id) !== item.answer) events.push(event("CUSTOMER_ANSWER_RECORDED", assessmentVersionId, { questionId: item.id, answer: item.answer, stage: item.stage }, occurredAt));
  });
  const previousPeople = new Map((previousTrace?.personOwnershipAssessments || []).map((item) => [identityKey(item), item]));
  (trace.personOwnershipAssessments || []).forEach((item) => {
    const prior = previousPeople.get(identityKey(item));
    if (!prior) return;
    const fromOwnership = prior.aggregateEffectiveOwnership?.value;
    const toOwnership = item.aggregateEffectiveOwnership?.value;
    if (String(fromOwnership) !== String(toOwnership)) events.push(event("AGGREGATE_OWNERSHIP_CHANGED", assessmentVersionId, { personId: item.personId, personName: item.personName, from: fromOwnership, to: toOwnership }, occurredAt));
    if (prior.determination !== item.determination) events.push(event("UBO_DETERMINATION_CHANGED", assessmentVersionId, { personId: item.personId, personName: item.personName, from: prior.determination, to: item.determination }, occurredAt));
  });
  return events;
}

function applyCurrentVerificationAssessment(trace, previousTrace = null, { pendingRecalculation = false, finalized = false, now = new Date().toISOString() } = {}) {
  const inputStateVersion = `ubo-input:${hash(assessmentInput(trace, pendingRecalculation))}`;
  const assessmentVersionId = `ubo-assessment:${inputStateVersion.split(":").at(-1)}`;
  const completions = [...(previousTrace?.idvCompletionHistory || trace.idvCompletionHistory || [])];
  const { population, diagnostics } = canonicalPopulation(trace, completions, assessmentVersionId);
  const blockers = blockingIssues(trace, pendingRecalculation);
  if (!population.length) blockers.push({ code: "NO_VERIFICATION_POPULATION", message: "A deterministic natural-person verification population is not available yet." });
  const ready = blockers.length === 0;
  const completed = population.filter(({ verificationStatus }) => verificationStatus === "COMPLETED").length;
  const previouslyEnteredIdv = [DISCOVERY_STATE.IDV_IN_PROGRESS, DISCOVERY_STATE.IDV_COMPLETE].includes(previousTrace?.discoveryState);
  const discoveryState = !ready ? DISCOVERY_STATE.DISCOVERY_IN_PROGRESS
    : population.length > 0 && completed === population.length ? DISCOVERY_STATE.IDV_COMPLETE
      : finalized || previouslyEnteredIdv ? DISCOVERY_STATE.IDV_IN_PROGRESS
        : DISCOVERY_STATE.READY_FOR_IDV;
  const previousPopulation = previousTrace?.verificationAssessment?.verificationPopulation || previousTrace?.verificationPopulation || [];
  const previousKeys = new Set(previousPopulation.map(identityKey));
  const currentKeys = new Set(population.map(identityKey));
  const transitionEvents = [
    ...(previousTrace?.verificationAssessment?.assessmentVersionId !== assessmentVersionId ? [event("OWNERSHIP_CONTROL_ASSESSMENT_RECALCULATED", assessmentVersionId, { inputStateVersion }, now)] : []),
    ...population.filter((item) => !previousKeys.has(identityKey(item))).map((item) => event("IDV_REQUIREMENT_CREATED", assessmentVersionId, { personId: item.personId, personName: item.personName, reasons: item.reasons.map(({ code }) => code) }, now)),
    ...previousPopulation.filter((item) => !currentKeys.has(identityKey(item))).map((item) => event("IDV_REQUIREMENT_NO_LONGER_CURRENT", assessmentVersionId, { personId: item.personId, personName: item.personName }, now)),
    ...changedEvents(previousTrace, trace, assessmentVersionId, now),
    ...(trace.fallback?.outcome === "FALLBACK_SENIOR_MANAGING_OFFICIAL_IDENTIFIED" && previousTrace?.fallback?.outcome !== trace.fallback.outcome ? [event("SENIOR_MANAGEMENT_FALLBACK_ACTIVATED", assessmentVersionId, { people: (trace.fallback.people || []).map(({ personName }) => personName) }, now)] : []),
    ...(finalized ? [event("FINAL_VERIFICATION_ASSESSMENT_CREATED", assessmentVersionId, { verificationSubjectCount: population.length }, now)] : []),
  ];
  const auditEvents = [...(previousTrace?.auditEvents || trace.auditEvents || []), ...transitionEvents].filter((item, index, all) => all.findIndex(({ eventId }) => eventId === item.eventId) === index);
  const assessedPeople = new Set([
    ...(trace.personOwnershipAssessments || []),
    ...(trace.controlResolution?.assessments || []),
    ...(trace.fallback?.people || []),
  ].filter(({ partyType }) => partyType === "NATURAL_PERSON").map(identityKey).filter(Boolean));
  const requirementHistory = [
    ...(previousTrace?.verificationRequirementHistory || trace.verificationRequirementHistory || []),
    ...previousPopulation.filter((item) => !currentKeys.has(identityKey(item))).map((item) => ({ ...item, currentRequirementStatus: "NO_LONGER_REQUIRED", supersededByAssessmentVersionId: assessmentVersionId })),
  ].filter((item, index, all) => all.findIndex((candidate) => identityKey(candidate) === identityKey(item) && candidate.assessmentVersionId === item.assessmentVersionId && candidate.currentRequirementStatus === item.currentRequirementStatus) === index);
  const verificationAssessment = {
    contractVersion: "ubo-verification-assessment-v1",
    assessmentVersionId,
    inputStateVersion,
    calculatedAt: now,
    policyVersion: trace.policy?.policyVersion || "1.0",
    discoveryState,
    finalized,
    naturalPersonUboAssessments: (trace.personOwnershipAssessments || []).filter(({ partyType }) => partyType === "NATURAL_PERSON"),
    verificationPopulation: population,
    blockingIssues: blockers,
    diagnosticIssues: diagnostics,
    summary: {
      naturalPersonsAssessed: assessedPeople.size,
      beneficialOwnersIdentified: (trace.uboAssessments || []).filter(({ partyType, idvRequired }) => partyType === "NATURAL_PERSON" && idvRequired === true).length,
      peopleRequiringIdv: population.length,
      idvCompleted: completed,
    },
  };
  return { ...trace, discoveryState, verificationAssessment, verificationPopulation: population, verificationRequirementHistory: requirementHistory, idvCompletionHistory: completions, auditEvents };
}

function completeIdentityVerification(trace, personId, now = new Date().toISOString()) {
  const population = trace?.verificationAssessment?.verificationPopulation || trace?.verificationPopulation || [];
  const subject = population.find((item) => normalized(item.personId) === normalized(personId));
  if (!subject || subject.partyType !== "NATURAL_PERSON" || subject.currentRequirementStatus !== "REQUIRED") return trace;
  const existing = trace.idvCompletionHistory || [];
  const completion = { personId: subject.personId, personName: subject.personName, partyType: "NATURAL_PERSON", completedAt: now, assessmentVersionId: subject.assessmentVersionId };
  const completions = completionFor(existing, subject) ? existing : [...existing, completion];
  const nextPopulation = population.map((item) => identityKey(item) === identityKey(subject) ? { ...item, verificationStatus: "COMPLETED" } : item);
  const completed = nextPopulation.filter(({ verificationStatus }) => verificationStatus === "COMPLETED").length;
  const discoveryState = nextPopulation.length > 0 && completed === nextPopulation.length ? DISCOVERY_STATE.IDV_COMPLETE : DISCOVERY_STATE.IDV_IN_PROGRESS;
  const versionId = trace.verificationAssessment?.assessmentVersionId || subject.assessmentVersionId;
  const completedEvent = event("IDENTITY_VERIFICATION_COMPLETED", versionId, { personId: subject.personId, personName: subject.personName }, now);
  const auditEvents = [...(trace.auditEvents || []), completedEvent].filter((item, index, all) => all.findIndex(({ eventId }) => eventId === item.eventId) === index);
  return {
    ...trace,
    discoveryState,
    idvCompletionHistory: completions,
    auditEvents,
    verificationPopulation: nextPopulation,
    verificationAssessment: {
      ...trace.verificationAssessment,
      discoveryState,
      verificationPopulation: nextPopulation,
      summary: { ...trace.verificationAssessment?.summary, idvCompleted: completed },
    },
  };
}

function currentVerificationPopulation(trace) {
  return trace?.verificationAssessment?.verificationPopulation || trace?.verificationPopulation || [];
}

function isReadyForIdentityVerification(trace) {
  return [DISCOVERY_STATE.READY_FOR_IDV, DISCOVERY_STATE.IDV_IN_PROGRESS, DISCOVERY_STATE.IDV_COMPLETE].includes(trace?.discoveryState)
    && (trace?.verificationAssessment?.blockingIssues || []).length === 0
    && currentVerificationPopulation(trace).length > 0;
}

module.exports = {
  DISCOVERY_STATE,
  VERIFICATION_REASON,
  applyCurrentVerificationAssessment,
  completeIdentityVerification,
  currentVerificationPopulation,
  isReadyForIdentityVerification,
};
