import {
  applyCurrentVerificationAssessment,
  completeIdentityVerification,
  DISCOVERY_STATE,
  VERIFICATION_REASON,
} from "./verificationAssessment";

function person(personId, personName, aggregate = 26, determination = "DEFINITE_UBO") {
  return { assessmentId: `assessment:${personId}`, personId, personName, partyType: "NATURAL_PERSON", determination, idvRequired: determination === "DEFINITE_UBO", aggregateEffectiveOwnership: { type: "EXACT", value: String(aggregate) }, ownershipPaths: [{ pathId: `${personId}:direct` }, { pathId: `${personId}:indirect` }], threshold: { comparator: ">", value: 25 } };
}

function readyTrace(overrides = {}) {
  const alice = person("alice", "Alice Morgan");
  return {
    policy: { policyVersion: "1.0" },
    ownershipResolution: { status: "COMPLETE" },
    controlResolution: { status: "NOT_STARTED", assessments: [] },
    fallback: { outcome: null, people: [] },
    questions: [], evidence: [], ownershipFacts: [{ id: "fact:alice", resolutionStatus: "RESOLVED_CUSTOMER_CONFIRMED" }],
    personOwnershipAssessments: [alice],
    uboAssessments: [{ personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", determination: "DEFINITE_UBO", idvRequired: true, bases: ["SHARE_OWNERSHIP"] }],
    ...overrides,
  };
}

test("ownership UBO readiness produces one versioned natural-person requirement", () => {
  const trace = applyCurrentVerificationAssessment(readyTrace(), null, { now: "2026-09-19T09:00:00.000Z" });
  expect(trace.discoveryState).toBe(DISCOVERY_STATE.READY_FOR_IDV);
  expect(trace.verificationAssessment.blockingIssues).toEqual([]);
  expect(trace.verificationPopulation).toHaveLength(1);
  expect(trace.verificationPopulation[0]).toEqual(expect.objectContaining({ personName: "Alice Morgan", role: "Beneficial owner", verificationStatus: "NOT_STARTED", assessmentVersionId: trace.verificationAssessment.assessmentVersionId }));
  expect(trace.verificationPopulation[0].reasons[0].code).toBe(VERIFICATION_REASON.OWNERSHIP_UBO);
});

test("new questions, material evidence and a pending recalculation all keep discovery open", () => {
  const trace = readyTrace({
    questions: [{ id: "control", status: "OPEN", stage: "CONTROL" }],
    evidence: [{ id: "evidence", status: "VALIDATING" }],
  });
  const assessed = applyCurrentVerificationAssessment(trace, null, { pendingRecalculation: true });
  expect(assessed.discoveryState).toBe(DISCOVERY_STATE.DISCOVERY_IN_PROGRESS);
  expect(assessed.verificationAssessment.blockingIssues.map(({ code }) => code)).toEqual(expect.arrayContaining(["BLOCKING_QUESTIONS_OPEN", "REQUIRED_EVIDENCE_OPEN", "ASSESSMENT_RECALCULATION_PENDING"]));
});

test("control and senior-management fallback each produce the correct verification reason", () => {
  const control = applyCurrentVerificationAssessment(readyTrace({
    controlResolution: { status: "COMPLETE", assessments: [{ personId: "jane", personName: "Jane Smith", partyType: "NATURAL_PERSON", basis: "VOTING_RIGHTS", outcome: "CONTROL_UBO" }] },
    personOwnershipAssessments: [],
    uboAssessments: [{ personId: "jane", personName: "Jane Smith", partyType: "NATURAL_PERSON", idvRequired: true, bases: ["VOTING_RIGHTS"] }],
  }));
  expect(control.verificationPopulation[0].reasons[0].code).toBe(VERIFICATION_REASON.VOTING_RIGHTS_UBO);

  const fallback = applyCurrentVerificationAssessment(readyTrace({
    controlResolution: { status: "COMPLETE", assessments: [], exhausted: true },
    personOwnershipAssessments: [], uboAssessments: [],
    fallback: { outcome: "FALLBACK_SENIOR_MANAGING_OFFICIAL_IDENTIFIED", people: [{ personId: "sarah", personName: "Sarah Jones", partyType: "NATURAL_PERSON", role: "CEO", cddIdentityVerificationRequired: true }] },
  }));
  expect(fallback.discoveryState).toBe(DISCOVERY_STATE.READY_FOR_IDV);
  expect(fallback.verificationPopulation[0]).toEqual(expect.objectContaining({ role: "Senior managing official" }));
  expect(fallback.verificationPopulation[0].reasons[0].code).toBe(VERIFICATION_REASON.SENIOR_MANAGING_OFFICIAL_FALLBACK);
});

test("multiple qualifying bases and repeated paths create one card while legal entities are rejected", () => {
  const assessed = applyCurrentVerificationAssessment(readyTrace({
    uboAssessments: [
      { personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", idvRequired: true, bases: ["SHARE_OWNERSHIP", "VOTING_RIGHTS"] },
      { personId: "holdco", personName: "Holding Limited", partyType: "LEGAL_ENTITY", idvRequired: true, bases: ["SHARE_OWNERSHIP"] },
    ],
  }));
  expect(assessed.verificationPopulation).toHaveLength(1);
  expect(assessed.verificationPopulation[0].reasons.map(({ code }) => code)).toEqual([VERIFICATION_REASON.OWNERSHIP_UBO, VERIFICATION_REASON.VOTING_RIGHTS_UBO]);
  expect(assessed.verificationAssessment.diagnosticIssues[0].code).toBe("LEGAL_ENTITY_EXCLUDED_FROM_IDV");
});

test("multiple UBOs complete independently and the lifecycle completes only after all finish", () => {
  const bob = person("bob", "Bob Jones", 35);
  let trace = applyCurrentVerificationAssessment(readyTrace({
    personOwnershipAssessments: [person("alice", "Alice Morgan"), bob],
    uboAssessments: [
      { personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", idvRequired: true, bases: ["SHARE_OWNERSHIP"] },
      { personId: "bob", personName: "Bob Jones", partyType: "NATURAL_PERSON", idvRequired: true, bases: ["SHARE_OWNERSHIP"] },
    ],
  }), null, { finalized: true });
  expect(trace.discoveryState).toBe(DISCOVERY_STATE.IDV_IN_PROGRESS);
  trace = completeIdentityVerification(trace, "alice", "2026-09-19T10:00:00.000Z");
  expect(trace.discoveryState).toBe(DISCOVERY_STATE.IDV_IN_PROGRESS);
  trace = completeIdentityVerification(trace, "bob", "2026-09-19T10:01:00.000Z");
  expect(trace.discoveryState).toBe(DISCOVERY_STATE.IDV_COMPLETE);
  expect(trace.idvCompletionHistory).toHaveLength(2);
});

test("a changed answer can remove a UBO without deleting completed IDV history", () => {
  let previous = applyCurrentVerificationAssessment(readyTrace(), null, { finalized: true, now: "2026-09-19T09:00:00.000Z" });
  previous = completeIdentityVerification(previous, "alice", "2026-09-19T09:30:00.000Z");
  const current = applyCurrentVerificationAssessment(readyTrace({
    controlResolution: { status: "IN_PROGRESS", assessments: [] },
    personOwnershipAssessments: [person("alice", "Alice Morgan", 22, "DEFINITE_NON_UBO")],
    uboAssessments: [],
  }), previous, { now: "2026-09-19T10:00:00.000Z" });
  expect(current.discoveryState).toBe(DISCOVERY_STATE.DISCOVERY_IN_PROGRESS);
  expect(current.verificationPopulation).toEqual([]);
  expect(current.idvCompletionHistory[0]).toEqual(expect.objectContaining({ personName: "Alice Morgan", assessmentVersionId: previous.verificationAssessment.assessmentVersionId }));
  expect(current.verificationRequirementHistory[0].currentRequirementStatus).toBe("NO_LONGER_REQUIRED");
  expect(current.auditEvents.map(({ type }) => type)).toEqual(expect.arrayContaining(["AGGREGATE_OWNERSHIP_CHANGED", "UBO_DETERMINATION_CHANGED", "IDV_REQUIREMENT_NO_LONGER_CURRENT", "IDENTITY_VERIFICATION_COMPLETED"]));
});
