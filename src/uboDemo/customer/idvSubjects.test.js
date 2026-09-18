import { idvSubjectsFromTrace, traceReadyForIdv } from "./idvSubjects";

test("IDV population contains deduplicated natural persons only", () => {
  const trace = {
    ownershipResolution: { status: "COMPLETE" }, questions: [], evidence: [],
    uboAssessments: [
      { personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", idvRequired: true, bases: ["SHARE_OWNERSHIP"] },
      { personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", idvRequired: true, bases: ["VOTING_RIGHTS"] },
      { personId: "holdco", personName: "Holding Limited", partyType: "LEGAL_ENTITY", idvRequired: true, bases: ["SHARE_OWNERSHIP"] },
    ],
    fallback: { people: [] },
  };
  expect(idvSubjectsFromTrace(trace)).toEqual([{ personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", bases: ["SHARE_OWNERSHIP", "VOTING_RIGHTS"], reason: "SHARE_OWNERSHIP" }]);
  expect(traceReadyForIdv(trace)).toBe(true);
});

test("IDV cannot start while questions, evidence or later-stage discovery remain unresolved", () => {
  const base = { ownershipResolution: { status: "COMPLETE" }, questions: [], evidence: [], uboAssessments: [], fallback: { outcome: "FALLBACK_SENIOR_MANAGING_OFFICIAL_REQUIRED", people: [] } };
  expect(traceReadyForIdv(base)).toBe(false);
  expect(traceReadyForIdv({ ...base, uboAssessments: [{ personId: "company", personName: "Company A", partyType: "LEGAL_ENTITY", idvRequired: true }] })).toBe(false);
});
