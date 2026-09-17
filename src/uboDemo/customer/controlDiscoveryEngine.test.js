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

test("non-qualifying voting rights advance the automatic journey to board control", () => {
  const rows = [row(company("Holding Limited"), 100)];
  let { answers } = answerNomineeNo(rows);
  let engine = run({ comparisonRows: rows, answers });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER), "YES") };
  engine = run({ comparisonRows: rows, answers });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_VOTING_RIGHT_HOLDERS), "Jane Smith") };
  engine = run({ comparisonRows: rows, answers });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.ESTABLISH_VOTING_RIGHT_PERCENTAGE), 10) };
  engine = run({ comparisonRows: rows, answers });
  expect(engine.controlResolution.assessments[0]).toEqual(expect.objectContaining({ outcome: CONTROL_ASSESSMENT_OUTCOME.NOT_CONTROL_UBO }));
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_BOARD_APPOINTMENT_CONTROL)).toEqual(expect.objectContaining({ status: "OPEN" }));
});

test("a manually selected voting topic stays scoped instead of opening every control route", () => {
  const rows = [row(person("Alice Morgan"), 40)];
  const activation = createTopicActivation({ topicCode: INVESTIGATION_TOPIC_CODE.VOTING_RIGHTS, caseId: "case-1" });
  let { answers } = answerNomineeNo(rows);
  let engine = run({ comparisonRows: rows, answers, topicActivations: [activation] });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER), "NO") };
  engine = run({ comparisonRows: rows, answers, topicActivations: [activation] });
  expect(engine.controlResolution.status).toBe("COMPLETE");
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_BOARD_APPOINTMENT_CONTROL)).toBeUndefined();
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_INFLUENCE)).toBeUndefined();
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

test("a material discrepancy with an undated customer document activates contextual current ownership", () => {
  const conflict = { ...row(person("Alice Morgan"), 20, "CONFLICT"), researchFact: fact(person("Alice Morgan"), target, 60), detail: "Values differ." };
  const undated = run({ comparisonRows: [conflict], ownershipContext: { customerDocumentEffectiveDate: null } });
  expect(question(undated, DISCOVERY_FACT_REQUIREMENT_TYPE.CONFIRM_CURRENT_OWNERSHIP)).toEqual(expect.objectContaining({ explanation: expect.stringMatching(/does not state when/i) }));
  const dated = run({ comparisonRows: [conflict], ownershipContext: { customerDocumentEffectiveDate: "2026-09-01" } });
  expect(question(dated, DISCOVERY_FACT_REQUIREMENT_TYPE.CONFIRM_CURRENT_OWNERSHIP)).toBeUndefined();
});

test("an unasked manual control topic is superseded when a later ownership answer establishes a UBO", () => {
  const owner = person("Alice Morgan");
  const rows = [{ ...row(owner, 20, "NEEDS_CONFIRMATION"), researchFact: { ...fact(owner, target, 20), measurement: { type: "RANGE", lowerBound: 10, upperBound: 40, lowerInclusive: true, upperInclusive: true } }, chartFact: { ...fact(owner, target, 20), measurement: { type: "UNKNOWN" } } }];
  const activation = createTopicActivation({ topicCode: INVESTIGATION_TOPIC_CODE.VOTING_RIGHTS, caseId: "case-1", createdAt: "2026-09-17T10:00:00.000Z" });
  let engine = run({ comparisonRows: rows, topicActivations: [activation] });
  const exact = question(engine, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE);
  const nominee = question(engine, FACT_REQUIREMENT_TYPE.CONFIRM_NOMINEE_ARRANGEMENT);
  const answers = { ...answer(nominee, "NO"), ...answer(exact, 40, "2026-09-17T11:00:00.000Z") };
  engine = run({ comparisonRows: rows, answers, recalculations: { [rows[0].key]: { determination: "DEFINITE_UBO" } }, topicActivations: [activation] });
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER)).toBeUndefined();
  expect(engine.topicActivations[0].displayStatus).toBe("SUPERSEDED");
});

test("one person qualifying through ownership and voting is recorded once with multiple bases", () => {
  const rows = [row(person("Alice Morgan"), 40)];
  const activation = createTopicActivation({ topicCode: INVESTIGATION_TOPIC_CODE.VOTING_RIGHTS, caseId: "case-1", createdAt: "2026-09-17T12:00:00.000Z" });
  let { answers } = answerNomineeNo(rows);
  let engine = run({ comparisonRows: rows, answers, topicActivations: [activation] });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER), "YES") };
  engine = run({ comparisonRows: rows, answers, topicActivations: [activation] });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_VOTING_RIGHT_HOLDERS), "Alice Morgan") };
  engine = run({ comparisonRows: rows, answers, topicActivations: [activation] });
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.ESTABLISH_VOTING_RIGHT_PERCENTAGE), 60) };
  engine = run({ comparisonRows: rows, answers, topicActivations: [activation] });
  expect(engine.uboAssessments).toHaveLength(1);
  expect(engine.uboAssessments[0].bases).toEqual(expect.arrayContaining([UBO_BASIS.SHARE_OWNERSHIP, UBO_BASIS.VOTING_RIGHTS]));
  expect(engine.evidenceRequirements[0]).toEqual(expect.objectContaining({ preferredEvidenceTypes: expect.arrayContaining(["ARTICLES_OF_ASSOCIATION"]), reviewMode: "ANALYST_REVIEW" }));
});

test("senior fallback requires practical authority as well as a role title and supports multiple people", () => {
  const rows = [row(company("Holding Limited"), 100)];
  let { answers } = answerNomineeNo(rows);
  let engine = run({ comparisonRows: rows, answers });
  for (const type of [DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_BOARD_APPOINTMENT_CONTROL, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_INFLUENCE]) {
    answers = { ...answers, ...answer(question(engine, type), "NO") };
    engine = run({ comparisonRows: rows, answers });
  }
  answers = { ...answers, ...answer(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SENIOR_MANAGING_OFFICIAL), "Jane Smith, John Doe") };
  engine = run({ comparisonRows: rows, answers });
  const roleQuestions = engine.questions.filter((item) => engine.requirements.find(({ id }) => id === item.factRequirementId)?.type === DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SENIOR_MANAGEMENT_ROLE);
  expect(roleQuestions).toHaveLength(2);
  answers = { ...answers, ...answer(roleQuestions[0], "CEO") };
  engine = run({ comparisonRows: rows, answers });
  expect(engine.fallback.outcome).toBe("FALLBACK_SENIOR_MANAGING_OFFICIAL_REQUIRED");
  expect(engine.fallback.people).toHaveLength(0);
});

test("manual senior-management activation does not claim ownership and control are exhausted", () => {
  const rows = [row(person("Alice Morgan"), 40)];
  const { answers } = answerNomineeNo(rows);
  const activation = createTopicActivation({ topicCode: INVESTIGATION_TOPIC_CODE.SENIOR_MANAGING_OFFICIAL, caseId: "case-1" });
  const engine = run({ comparisonRows: rows, answers, topicActivations: [activation] });
  const seniorQuestion = question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SENIOR_MANAGING_OFFICIAL);
  expect(seniorQuestion.prompt).toMatch(/^Who is the most senior person/i);
  expect(seniorQuestion.prompt).not.toMatch(/not been able to identify/i);
});

test("parallel policy can investigate control even when ownership already identifies a UBO", () => {
  const rows = [row(person("Alice Morgan"), 40)];
  const { answers } = answerNomineeNo(rows);
  const engine = run({ comparisonRows: rows, answers, controlDiscoveryMode: CONTROL_DISCOVERY_MODE.OWNERSHIP_AND_CONTROL_IN_PARALLEL });
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER)).toEqual(expect.objectContaining({ originTypes: [QUESTION_ORIGIN.SYSTEM_CONTROL_DISCOVERY] }));
});

test("bearer and trust topics remain separate structured discovery routes", () => {
  const activations = [
    createTopicActivation({ topicCode: INVESTIGATION_TOPIC_CODE.BEARER_SHARES, caseId: "case-1" }),
    createTopicActivation({ topicCode: INVESTIGATION_TOPIC_CODE.TRUST_OR_TRUSTEE_INVOLVEMENT, caseId: "case-1" }),
  ];
  let engine = run({ comparisonRows: [], topicActivations: activations });
  const bearer = question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.CONFIRM_BEARER_SHARES);
  const trust = question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.CONFIRM_TRUST_INVOLVEMENT);
  expect(bearer.id).not.toBe(trust.id);
  const answers = { ...answer(bearer, "YES"), ...answer(trust, "YES") };
  engine = run({ comparisonRows: [], answers, topicActivations: activations });
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_BEARER_CONTROLLER)).toBeDefined();
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_TRUSTEES)).toBeDefined();
  expect(engine.ownershipResolution.status).toBe("CONFLICTED");
  expect(question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER)).toBeUndefined();
});

test("layer qualifier routes nominee answers back into the canonical nominee fact", () => {
  const activation = createTopicActivation({ topicCode: INVESTIGATION_TOPIC_CODE.LAYER_QUALIFIER, caseId: "case-1" });
  let engine = run({ comparisonRows: [], topicActivations: [activation] });
  const layer = question(engine, DISCOVERY_FACT_REQUIREMENT_TYPE.IDENTIFY_LAYER_QUALIFIER);
  engine = run({ comparisonRows: [], answers: answer(layer, "NOMINEE"), topicActivations: [activation] });
  expect(engine.questions.filter(({ prompt }) => /hold shares or ownership rights on behalf/i.test(prompt))).toHaveLength(1);
});
