import { evaluateOwnershipResolution, FACT_REQUIREMENT_TYPE } from "./ownershipResolutionEngine";
import { CONTROL_DISCOVERY_MODE, createTopicActivation, INVESTIGATION_TOPIC_CODE, QUESTION_ORIGIN } from "./investigationTopics";
import { CONTROL_ASSESSMENT_OUTCOME, DISCOVERY_FACT_REQUIREMENT_TYPE, OWNERSHIP_RESOLUTION_STATUS, UBO_BASIS } from "./controlDiscoveryEngine";

const person = (name) => ({ name, entityId: `person:${name.toLowerCase().replaceAll(" ", "-")}`, entityType: "NATURAL_PERSON", jurisdiction: "GB" });
const company = (name) => ({ name, entityId: `company:${name.toLowerCase().replaceAll(" ", "-")}`, entityType: "LEGAL_ENTITY", jurisdiction: "GB" });
const fact = (owner, target, value) => ({ factId: `${owner.entityId}:${target.entityId}`, type: "RELATIONSHIP", relationship: "ECONOMIC_OWNERSHIP", subject: owner, object: target, measurement: { type: "EXACT", value }, qualifiers: { currentState: "CURRENT" }, evidenceReferences: [{ referenceId: "source" }] });
const target = company("Target Limited");
const row = (owner, value, status = "INDEPENDENTLY_VERIFIED") => ({ key: `${owner.entityId}:${target.entityId}`, status, researchFact: fact(owner, target, value), chartFact: fact(owner, target, value) });
const question = (engine, type) => engine.questions.find((item) => engine.requirements.find((requirement) => requirement.id === item.factRequirementId)?.type === type);
const answer = (questionRecord, value, answeredAt = "2026-09-17T11:00:00.000Z") => ({ [questionRecord.id]: { value, answeredAt, factRequirementId: questionRecord.factRequirementId, comparisonItemId: questionRecord.comparisonItemId } });
const run = (input = {}) => evaluateOwnershipResolution({ now: "2026-09-17T10:00:00.000Z", customerEntityId: target.entityId, ...input });
const answerNomineeNo = (rows, input = {}) => {
  const first = run({ comparisonRows: rows, ...input });
  const nominee = question(first, FACT_REQUIREMENT_TYPE.CONFIRM_NOMINEE_ARRANGEMENT);
  return { answers: answer(nominee, "NO"), nominee };
};

test("ownership UBO suppresses automatic control under ownership-first policy", () => {
  const rows = [row(person("Alice Morgan"), 40)];
  const { answers } = answerNomineeNo(rows);
  const engine = run({ comparisonRows: rows, answers, controlDiscoveryMode: CONTROL_DISCOVERY_MODE.OWNERSHIP_FIRST_THEN_CONTROL });
  expect(engine.ownershipResolution).toEqual(expect.objectContaining({ status: OWNERSHIP_RESOLUTION_STATUS.COMPLETE, naturalPersonUboCount: 1 }));
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER)).toBeUndefined();
});

test("completed ownership with no natural-person UBO starts voting-right discovery", () => {
  const rows = [row(company("Holding Limited"), 100)];
  const { answers } = answerNomineeNo(rows);
  const engine = run({ comparisonRows: rows, answers });
  expect(engine.ownershipResolution).toEqual(expect.objectContaining({ status: "COMPLETE", naturalPersonUboCount: 0 }));
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER)).toEqual(expect.objectContaining({ originTypes: [QUESTION_ORIGIN.SYSTEM_CONTROL_DISCOVERY], status: "OPEN" }));
});

test("unresolved ownership does not prematurely start control", () => {
  const rows = [{ ...row(person("Alice Morgan"), 20, "NEEDS_CONFIRMATION"), researchFact: { ...fact(person("Alice Morgan"), target, 20), measurement: { type: "RANGE", lowerBound: 10, upperBound: 40, lowerInclusive: true, upperInclusive: true } }, chartFact: { ...fact(person("Alice Morgan"), target, 20), measurement: { type: "UNKNOWN" } } }];
  const { answers } = answerNomineeNo(rows);
  const engine = run({ comparisonRows: rows, answers });
  expect(engine.ownershipResolution.status).toBe("INDETERMINATE");
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER)).toBeUndefined();
});

test("analyst may activate voting rights despite an ownership UBO", () => {
  const rows = [row(person("Alice Morgan"), 40)];
  const { answers } = answerNomineeNo(rows);
  const activation = createTopicActivation({ topicCode: INVESTIGATION_TOPIC_CODE.VOTING_RIGHTS, caseId: "case-1", createdAt: "2026-09-17T12:00:00.000Z" });
  const engine = run({ comparisonRows: rows, answers, topicActivations: [activation] });
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER)).toEqual(expect.objectContaining({ originTypes: [QUESTION_ORIGIN.ANALYST_TOPIC], topicActivationIds: [activation.id] }));
});

test("qualifying voting rights create a deterministic control UBO and stop later routes", () => {
  const rows = [row(company("Holding Limited"), 100)];
  let { answers } = answerNomineeNo(rows);
  let engine = run({ comparisonRows: rows, answers });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER), "YES") };
  engine = run({ comparisonRows: rows, answers });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_VOTING_RIGHT_HOLDERS), "Jane Smith") };
  engine = run({ comparisonRows: rows, answers });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.ESTABLISH_VOTING_RIGHT_PERCENTAGE), 60) };
  engine = run({ comparisonRows: rows, answers });
  expect(engine.controlResolution.assessments[0]).toEqual(expect.objectContaining({ basis: UBO_BASIS.VOTING_RIGHTS, outcome: CONTROL_ASSESSMENT_OUTCOME.CONTROL_UBO }));
  expect(engine.uboAssessments[0]).toEqual(expect.objectContaining({ personName: "Jane Smith", idvRequired: true, bases: [UBO_BASIS.VOTING_RIGHTS] }));
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_BOARD_APPOINTMENT_CONTROL)).toBeUndefined();
  expect(engine.fallback.outcome).toBeNull();
});

test("board appointment rights establish a control UBO after voting rights resolve No", () => {
  const rows = [row(company("Holding Limited"), 100)];
  let { answers } = answerNomineeNo(rows);
  let engine = run({ comparisonRows: rows, answers });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER), "NO") };
  engine = run({ comparisonRows: rows, answers });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_BOARD_APPOINTMENT_CONTROL), "YES") };
  engine = run({ comparisonRows: rows, answers });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_BOARD_CONTROLLER), "Jane Smith") };
  engine = run({ comparisonRows: rows, answers });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.ESTABLISH_BOARD_CONTROL_RIGHT), "APPOINT_AND_REMOVE_MAJORITY") };
  engine = run({ comparisonRows: rows, answers });
  expect(engine.controlResolution.assessments[0]).toEqual(expect.objectContaining({ basis: UBO_BASIS.BOARD_CONTROL, outcome: "CONTROL_UBO" }));
  expect(engine.uboAssessments[0].idvRequired).toBe(true);
});

test("significant influence creates a structured analyst-review assertion instead of an AI UBO conclusion", () => {
  const rows = [row(company("Holding Limited"), 100)];
  let { answers } = answerNomineeNo(rows);
  let engine = run({ comparisonRows: rows, answers });
  for (const type of [DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_BOARD_APPOINTMENT_CONTROL]) {
    answers = { ...answers, ...answer(question(engine, type), "NO") };
    engine = run({ comparisonRows: rows, answers });
  }
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_INFLUENCE), "YES") };
  engine = run({ comparisonRows: rows, answers });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_INFLUENTIAL_PERSON), "Jane Smith") };
  engine = run({ comparisonRows: rows, answers });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.ESTABLISH_INFLUENCE_TYPE), "VETO_RIGHTS"), ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.EXPLAIN_SIGNIFICANT_INFLUENCE), "Jane can veto the annual business plan.") };
  engine = run({ comparisonRows: rows, answers });
  expect(engine.controlResolution.assessments[0]).toEqual(expect.objectContaining({ basis: UBO_BASIS.SIGNIFICANT_INFLUENCE, evidenceStatus: "ANALYST_REVIEW", outcome: "INDETERMINATE" }));
  expect(engine.uboAssessments).toHaveLength(0);
});

test("exhausting ownership and all control routes activates senior-management fallback without selecting a director", () => {
  const rows = [row(company("Holding Limited"), 100)];
  let { answers } = answerNomineeNo(rows);
  let engine = run({ comparisonRows: rows, answers });
  for (const type of [DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_BOARD_APPOINTMENT_CONTROL, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_INFLUENCE]) {
    answers = { ...answers, ...answer(question(engine, type), "NO") };
    engine = run({ comparisonRows: rows, answers });
  }
  expect(engine.fallback.outcome).toBe("FALLBACK_SENIOR_MANAGING_OFFICIAL_REQUIRED");
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SENIOR_MANAGING_OFFICIAL).prompt).toMatch(/overall management and key strategic decisions/i);
  expect(engine.fallback.people).toHaveLength(0);
  expect(engine.auditTrail.controlRoutesAssessed).toHaveLength(3);
});

test("analyst nominee activation merges into the existing system question and reuses an answer", () => {
  const initial = run({ comparisonRows: [] });
  const nominee = question(initial, FACT_REQUIREMENT_TYPE.CONFIRM_NOMINEE_ARRANGEMENT);
  const activation = createTopicActivation({ topicCode: INVESTIGATION_TOPIC_CODE.NOMINEE_ARRANGEMENT, caseId: "case-1" });
  const engine = run({ comparisonRows: [], answers: answer(nominee, "NO"), topicActivations: [activation] });
  const matching = engine.questions.filter(({ prompt }) => /hold shares or ownership rights on behalf/i.test(prompt));
  expect(matching).toHaveLength(1);
  expect(matching[0].originTypes).toEqual(expect.arrayContaining([QUESTION_ORIGIN.SYSTEM_COMPARISON, QUESTION_ORIGIN.ANALYST_TOPIC]));
  expect(matching[0].status).toBe("RESOLVED");
});

test("matching dated ownership does not create a generic current-ownership question", () => {
  const rows = [row(person("Alice Morgan"), 40)];
  const engine = run({ comparisonRows: rows });
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.CONFIRM_CURRENT_OWNERSHIP)).toBeUndefined();
});
