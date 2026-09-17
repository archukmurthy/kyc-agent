import {
  applyResultingFact,
  determineUboFromMeasurement,
  EVIDENCE_STATUS,
  evaluateOwnershipResolution,
  evidenceResultStatus,
  FACT_REQUIREMENT_TYPE,
  OWNERSHIP_DIFFERENCE_REASON,
  QUESTION_STATUS,
  RESOLUTION_STATUS,
  UBO_DETERMINATION,
} from "./ownershipResolutionEngine";

const person = (name) => ({ name, entityType: "NATURAL_PERSON", jurisdiction: "GB" });
const company = (name) => ({ name, entityType: "LEGAL_ENTITY", jurisdiction: "GB" });
const fact = (factId, owner, target, measurement, referenceId) => ({ factId, type: "RELATIONSHIP", relationship: "ECONOMIC_OWNERSHIP", subject: owner, object: target, measurement, qualifiers: { currentState: "CURRENT" }, evidenceReferences: [{ referenceId }] });
const alice = person("Alice Morgan");
const target = company("Target Limited");
const row = (status, researchMeasurement, chartMeasurement, key = "registry:chart") => ({
  key,
  status,
  detail: status === "CONFLICT" ? "Values differ." : "One side has no usable exact percentage or range.",
  researchFact: researchMeasurement ? fact("registry", alice, target, researchMeasurement, "registry-source") : null,
  chartFact: chartMeasurement ? fact("chart", alice, target, chartMeasurement, "chart-source") : null,
});
const question = (engine, type) => engine.questions.find((item) => engine.requirements.find((requirement) => requirement.id === item.factRequirementId)?.type === type);
const answer = (questionRecord, value) => ({ [questionRecord.id]: { value, answeredAt: "2026-09-17T10:00:00.000Z" } });
const evaluate = (input) => evaluateOwnershipResolution({ now: "2026-09-17T09:00:00.000Z", ...input });

test("independently verified comparisons create no ownership-resolution question", () => {
  const engine = evaluate({ comparisonRows: [row("INDEPENDENTLY_VERIFIED", { type: "EXACT", value: 40 }, { type: "EXACT", value: 40 })] });
  expect(engine.requirements.some(({ comparisonItemId }) => comparisonItemId === "registry:chart")).toBe(false);
  expect(engine.resolutions.find(({ comparisonItemId }) => comparisonItemId === "registry:chart")).toEqual(expect.objectContaining({
    resolutionStatus: RESOLUTION_STATUS.RESOLVED_EXISTING_INFORMATION_SUFFICIENT,
    uboImpact: { determination: UBO_DETERMINATION.DEFINITE_UBO, idvRequired: true },
  }));
});

test("a registry range that already proves UBO status avoids an exact-percentage question", () => {
  const engine = evaluate({ comparisonRows: [row("NEEDS_CONFIRMATION", { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: true, upperInclusive: true }, { type: "UNKNOWN" })] });
  expect(question(engine, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE)).toBeUndefined();
  expect(engine.resolutions[0].uboImpact).toEqual({ determination: UBO_DETERMINATION.DEFINITE_UBO, idvRequired: true });
});

test("a threshold-straddling range asks for exact ownership and closes that question after recalculation", () => {
  const rows = [row("NEEDS_CONFIRMATION", { type: "RANGE", lowerBound: 10, upperBound: 40, lowerInclusive: true, upperInclusive: true }, { type: "UNKNOWN" })];
  const initial = evaluate({ comparisonRows: rows });
  const exact = question(initial, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE);
  expect(exact.status).toBe(QUESTION_STATUS.OPEN);

  const answered = evaluate({ comparisonRows: rows, answers: answer(exact, 18), recalculations: { "registry:chart": { determination: UBO_DETERMINATION.DEFINITE_NON_UBO } } });
  expect(question(answered, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE).status).toBe(QUESTION_STATUS.RESOLVED);
  expect(answered.openQuestions).not.toContainEqual(expect.objectContaining({ id: exact.id }));
  expect(answered.resolutions[0]).toEqual(expect.objectContaining({
    resolutionStatus: RESOLUTION_STATUS.RESOLVED_CUSTOMER_CONFIRMED,
    ownershipEstablishment: "ESTABLISHED_CUSTOMER_DECLARATION",
    uboImpact: { determination: UBO_DETERMINATION.DEFINITE_NON_UBO, idvRequired: false },
  }));
  expect(answered.resolutions[0].resultingFact.evidenceReferences[0]).toEqual(expect.objectContaining({ referenceType: "CUSTOMER_DECLARATION", system: "ubo-questions-resolution" }));
});

test("a later deterministic recalculation can supersede an exact-percentage question that no longer matters", () => {
  const rows = [row("NEEDS_CONFIRMATION", { type: "RANGE", lowerBound: 10, upperBound: 40, lowerInclusive: true, upperInclusive: true }, { type: "UNKNOWN" })];
  const engine = evaluate({ comparisonRows: rows, recalculations: { "registry:chart": { determination: UBO_DETERMINATION.DEFINITE_NON_UBO } } });
  expect(question(engine, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE).status).toBe(QUESTION_STATUS.SUPERSEDED);
  expect(engine.openQuestions).not.toContainEqual(expect.objectContaining({ comparisonItemId: "registry:chart" }));
});

test("a genuine discrepancy asks for an explanation before creating evidence work", () => {
  const engine = evaluate({ comparisonRows: [row("CONFLICT", { type: "EXACT", value: 60 }, { type: "EXACT", value: 20 })] });
  expect(question(engine, FACT_REQUIREMENT_TYPE.EXPLAIN_OWNERSHIP_DIFFERENCE)).toEqual(expect.objectContaining({ prompt: "Has the company's ownership changed?", status: "OPEN" }));
  expect(engine.evidenceRequirements).toHaveLength(0);
});

test.each([
  [OWNERSHIP_DIFFERENCE_REASON.SHARE_TRANSFER, "CURRENT_REGISTER_OF_MEMBERS", "STOCK_TRANSFER_FORM"],
  [OWNERSHIP_DIFFERENCE_REASON.SHARE_ALLOTMENT, "SH01_ALLOTMENT_FILING", "SUBSCRIPTION_OR_INVESTMENT_AGREEMENT"],
])("%s creates fact-first follow-ups and configured evidence", (reason, preferred, alternative) => {
  const rows = [row("CONFLICT", { type: "EXACT", value: 60 }, { type: "EXACT", value: 20 })];
  const initial = evaluate({ comparisonRows: rows });
  const explanation = question(initial, FACT_REQUIREMENT_TYPE.EXPLAIN_OWNERSHIP_DIFFERENCE);
  const engine = evaluate({ comparisonRows: rows, answers: answer(explanation, reason) });
  expect(engine.requirements).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: FACT_REQUIREMENT_TYPE.OWNERSHIP_CHANGE_OCCURRED, status: "RESOLVED", assertedValue: true }),
    expect.objectContaining({ type: FACT_REQUIREMENT_TYPE.OWNERSHIP_CHANGE_TYPE, status: "RESOLVED", assertedValue: reason }),
  ]));
  expect(question(engine, FACT_REQUIREMENT_TYPE.OWNERSHIP_CHANGE_EFFECTIVE_DATE)).toBeDefined();
  expect(question(engine, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE)).toBeDefined();
  expect(engine.evidenceRequirements[0].preferredEvidenceTypes).toContain(preferred);
  expect(engine.evidenceRequirements[0].alternativeEvidenceTypes).toContain(alternative);
  expect(engine.evidenceRequirements[0].handoff).toEqual(expect.objectContaining({ contractVersion: "ubo-external-evidence-handoff-v1", executionRoute: "/api/ubo-demo-customer-ownership-chart" }));
});

test("a share transfer resolves only after current fact, date and matching evidence are present", () => {
  const rows = [row("CONFLICT", { type: "EXACT", value: 60 }, { type: "EXACT", value: 20 })];
  let engine = evaluate({ comparisonRows: rows });
  const explanation = question(engine, FACT_REQUIREMENT_TYPE.EXPLAIN_OWNERSHIP_DIFFERENCE);
  let answers = answer(explanation, OWNERSHIP_DIFFERENCE_REASON.SHARE_TRANSFER);
  engine = evaluate({ comparisonRows: rows, answers });
  const percentage = question(engine, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE);
  const date = question(engine, FACT_REQUIREMENT_TYPE.OWNERSHIP_CHANGE_EFFECTIVE_DATE);
  answers = { ...answers, ...answer(percentage, 30), ...answer(date, "2026-08-01") };
  engine = evaluate({ comparisonRows: rows, answers });
  expect(engine.resolutions[0].resolutionStatus).toBe(RESOLUTION_STATUS.UNRESOLVED);
  const evidenceId = engine.evidenceRequirements[0].id;
  engine = evaluate({ comparisonRows: rows, answers, evidence: { [evidenceId]: { status: EVIDENCE_STATUS.SATISFIED, artifactId: "artifact-proof" } } });
  expect(engine.resolutions[0]).toEqual(expect.objectContaining({ resolutionStatus: RESOLUTION_STATUS.RESOLVED_EVIDENCE_VERIFIED }));
  expect(engine.resolutions[0].resultingFact).toEqual(expect.objectContaining({ measurement: { type: "EXACT", value: 30 }, qualifiers: expect.objectContaining({ effectiveDate: "2026-08-01" }) }));
});

test("nominee declaration branches into holder, underlying owner and interest questions", () => {
  let engine = evaluate({ comparisonRows: [] });
  const nominee = question(engine, FACT_REQUIREMENT_TYPE.CONFIRM_NOMINEE_ARRANGEMENT);
  engine = evaluate({ comparisonRows: [], answers: answer(nominee, "YES") });
  expect(engine.requirements.filter(({ type }) => type === FACT_REQUIREMENT_TYPE.IDENTIFY_UNDERLYING_BENEFICIAL_OWNER)).toHaveLength(2);
  expect(engine.requirements.some(({ role }) => role === "NOMINEE_INTEREST")).toBe(true);
  expect(engine.evidenceRequirements[0].preferredEvidenceTypes).toEqual(expect.arrayContaining(["NOMINEE_AGREEMENT", "DECLARATION_OF_TRUST"]));
});

test("completed nominee answers remain unresolved until supporting evidence is satisfied", () => {
  let engine = evaluate({ comparisonRows: [] });
  const nominee = question(engine, FACT_REQUIREMENT_TYPE.CONFIRM_NOMINEE_ARRANGEMENT);
  let answers = answer(nominee, "YES");
  engine = evaluate({ comparisonRows: [], answers });
  const valuesByRole = { REGISTERED_HOLDER: "Registered Holder Limited", UNDERLYING_OWNER: "Underlying Owner Limited", NOMINEE_INTEREST: 30 };
  engine.requirements.filter(({ role }) => role).forEach((requirement) => {
    const relatedQuestion = engine.questions.find(({ factRequirementId }) => factRequirementId === requirement.id);
    answers = { ...answers, ...answer(relatedQuestion, valuesByRole[requirement.role]) };
  });

  engine = evaluate({ comparisonRows: [], answers });
  const unresolved = engine.resolutions.find(({ comparisonItemId }) => comparisonItemId === "ownership-comparison:nominee-declaration");
  expect(engine.openQuestions.filter(({ comparisonItemId }) => comparisonItemId === unresolved.comparisonItemId)).toHaveLength(0);
  expect(unresolved).toEqual(expect.objectContaining({
    resolutionStatus: RESOLUTION_STATUS.UNRESOLVED,
    ownershipEstablishment: "NOT_ESTABLISHED",
    reason: "Nominee facts were declared; supporting evidence is required.",
  }));

  const evidenceId = engine.evidenceRequirements[0].id;
  engine = evaluate({ comparisonRows: [], answers, evidence: { [evidenceId]: { status: EVIDENCE_STATUS.SATISFIED, artifactId: "nominee-proof" } } });
  expect(engine.resolutions.find(({ comparisonItemId }) => comparisonItemId === unresolved.comparisonItemId)).toEqual(expect.objectContaining({
    resolutionStatus: RESOLUTION_STATUS.RESOLVED_EVIDENCE_VERIFIED,
    ownershipEstablishment: "ESTABLISHED_EVIDENCE_VERIFIED",
  }));
});

test.each([OWNERSHIP_DIFFERENCE_REASON.OTHER, OWNERSHIP_DIFFERENCE_REASON.NOT_SURE])("%s routes to analyst review without inventing a fact", (value) => {
  const rows = [row("CONFLICT", { type: "EXACT", value: 60 }, { type: "EXACT", value: 20 })];
  const initial = evaluate({ comparisonRows: rows });
  const engine = evaluate({ comparisonRows: rows, answers: answer(question(initial, FACT_REQUIREMENT_TYPE.EXPLAIN_OWNERSHIP_DIFFERENCE), value) });
  expect(engine.resolutions[0]).toEqual(expect.objectContaining({ resolutionStatus: RESOLUTION_STATUS.REQUIRES_ANALYST_REVIEW, resultingFact: null }));
});

test("resolved customer facts replace only the matching chart relationship before existing-engine reevaluation", () => {
  const sourceRow = row("NEEDS_CONFIRMATION", { type: "RANGE", lowerBound: 10, upperBound: 40, lowerInclusive: true, upperInclusive: true }, { type: "UNKNOWN" });
  const initial = evaluate({ comparisonRows: [sourceRow] });
  const resolved = evaluate({ comparisonRows: [sourceRow], answers: answer(question(initial, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE), 30) });
  const untouched = fact("other", person("Bob"), target, { type: "EXACT", value: 10 }, "chart-source");
  const saved = { candidateFacts: [sourceRow.chartFact, untouched] };
  const updated = applyResultingFact(saved, resolved.resolutions[0].resultingFact);
  expect(updated.candidateFacts).toHaveLength(2);
  expect(updated.candidateFacts.find(({ subject }) => subject.name === "Alice Morgan").measurement).toEqual({ type: "EXACT", value: 30 });
  expect(saved.candidateFacts[0].measurement).toEqual({ type: "UNKNOWN" });
});

test("Evidence pipeline results satisfy only matching ownership assertions", () => {
  const resolution = { resultingFact: fact("resolved", alice, target, { type: "EXACT", value: 30 }, "answer") };
  const requirement = { comparisonItemId: "registry:chart" };
  const result = { artifact: { integrityVerified: true }, candidateFacts: [fact("proof", alice, target, { type: "EXACT", value: 30 }, "proof")] };
  expect(evidenceResultStatus(result, resolution, requirement).status).toBe(EVIDENCE_STATUS.SATISFIED);
  expect(evidenceResultStatus({ ...result, candidateFacts: [fact("wrong", alice, target, { type: "EXACT", value: 20 }, "proof")] }, resolution, requirement).status).toBe(EVIDENCE_STATUS.REJECTED);
});

test("range threshold classification preserves definite and indeterminate outcomes", () => {
  expect(determineUboFromMeasurement({ type: "RANGE", lowerBound: 30, upperBound: 50, lowerInclusive: true, upperInclusive: true })).toBe(UBO_DETERMINATION.DEFINITE_UBO);
  expect(determineUboFromMeasurement({ type: "RANGE", lowerBound: 5, upperBound: 25, lowerInclusive: true, upperInclusive: false })).toBe(UBO_DETERMINATION.DEFINITE_NON_UBO);
  expect(determineUboFromMeasurement({ type: "RANGE", lowerBound: 10, upperBound: 40, lowerInclusive: true, upperInclusive: true })).toBe(UBO_DETERMINATION.INDETERMINATE);
});
