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
  personOwnershipAssessmentsFromChartAnalysis,
  idvRequiredForSubject,
  ownershipFactMateriality,
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

const chartAnalysis = ({ people = [{ id: "alice", name: "Alice Morgan", aggregate: 40, state: "SATISFIED", paths: [{ id: "alice-direct", relationshipIds: ["chart"], contribution: 40 }] }], extraNodes = [], extraRelationships = [] } = {}) => ({
  calculationSemanticsVersion: "test-v1",
  entityLabels: Object.fromEntries([...people.map(({ id, name }) => [id, name]), ["target", "Target Limited"], ...extraNodes.map(({ entityId, primaryName }) => [entityId, primaryName])]),
  view: {
    graph: {
      nodes: [...people.map(({ id, name }) => ({ entityId: id, primaryName: name, category: "NATURAL_PERSON" })), { entityId: "target", primaryName: "Target Limited", category: "LEGAL_ENTITY" }, ...extraNodes],
      relationships: [
        ...people.flatMap(({ paths }) => paths.flatMap(({ edges, relationshipIds, contribution }) => edges || relationshipIds.map((relationshipId, index) => ({ relationshipId, subjectEntityId: index === 0 ? people.find(({ paths: candidatePaths }) => candidatePaths.some(({ relationshipIds: ids }) => ids.includes(relationshipId)))?.id : "holdco", objectEntityId: index === relationshipIds.length - 1 ? "target" : "holdco", measurement: { type: "EXACT", value: relationshipIds.length === 1 ? contribution : index === 0 ? 60 : 60 } })))),
        ...extraRelationships,
      ],
    },
    qualifications: people.map(({ id, state }) => ({ personEntityId: id, routeStatus: state === "SATISFIED" ? "ROUTE_SATISFIED" : state === "NOT_SATISFIED" ? "ROUTE_NOT_SATISFIED" : "ROUTE_INDETERMINATE" })),
    qualificationBases: people.map(({ id, aggregate, state, paths }) => ({
      personEntityId: id, route: "EFFECTIVE_INTEREST", dimension: "ECONOMIC", assessmentState: state,
      policyId: "UK_UBO_POLICY_TEST", policyVersion: "1", threshold: { comparator: ">", value: 25 },
      recordedCalculation: { value: { type: "EXACT", value: String(aggregate) } },
      orderedPathReferences: paths.map(({ id: pathId, relationshipIds, contribution }) => ({ pathId, relationshipIds, contribution: { type: "EXACT", value: String(contribution) } })),
    })),
  },
});

test("independently verified comparisons create no ownership-resolution question", () => {
  const engine = evaluate({ comparisonRows: [row("INDEPENDENTLY_VERIFIED", { type: "EXACT", value: 40 }, { type: "EXACT", value: 40 })], chartAnalysis: chartAnalysis() });
  expect(engine.requirements.some(({ comparisonItemId }) => comparisonItemId === "registry:chart")).toBe(false);
  expect(engine.resolutions.find(({ comparisonItemId }) => comparisonItemId === "registry:chart")).toEqual(expect.objectContaining({
    resolutionStatus: RESOLUTION_STATUS.RESOLVED_INDEPENDENTLY_VERIFIED,
    uboImpact: expect.objectContaining({ determination: UBO_DETERMINATION.DEFINITE_UBO, idvRequired: true, assessmentLevel: "PERSON_AGGREGATE" }),
  }));
});

test("a qualifying edge does not suppress a material aggregate ownership question", () => {
  const engine = evaluate({ comparisonRows: [row("NEEDS_CONFIRMATION", { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: true, upperInclusive: true }, { type: "UNKNOWN" })] });
  expect(question(engine, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE)).toBeDefined();
  expect(engine.resolutions[0]?.uboImpact?.idvRequired).not.toBe(true);
});

test("a threshold-straddling range asks for exact ownership and closes that question after recalculation", () => {
  const rows = [row("NEEDS_CONFIRMATION", { type: "RANGE", lowerBound: 10, upperBound: 40, lowerInclusive: true, upperInclusive: true }, { type: "UNKNOWN" })];
  const initial = evaluate({ comparisonRows: rows });
  const exact = question(initial, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE);
  expect(exact.status).toBe(QUESTION_STATUS.OPEN);

  const answered = evaluate({ comparisonRows: rows, answers: answer(exact, 18), recalculations: { "registry:chart": { chartAnalysis: chartAnalysis({ people: [{ id: "alice", name: "Alice Morgan", aggregate: 18, state: "NOT_SATISFIED", paths: [{ id: "alice-direct", relationshipIds: ["customer-resolution-fact:registry:chart"], contribution: 18 }] }] }) } } });
  expect(question(answered, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE).status).toBe(QUESTION_STATUS.RESOLVED);
  expect(answered.openQuestions).not.toContainEqual(expect.objectContaining({ id: exact.id }));
  expect(answered.resolutions[0]).toEqual(expect.objectContaining({
    resolutionStatus: RESOLUTION_STATUS.RESOLVED_CUSTOMER_CONFIRMED,
    ownershipEstablishment: "ESTABLISHED_CUSTOMER_DECLARATION",
    uboImpact: expect.objectContaining({ determination: UBO_DETERMINATION.DEFINITE_NON_UBO, idvRequired: false, assessmentLevel: "PERSON_AGGREGATE" }),
  }));
  expect(answered.resolutions[0].resultingFact.evidenceReferences[0]).toEqual(expect.objectContaining({ referenceType: "CUSTOMER_DECLARATION", system: "ubo-questions-resolution" }));
});

test("a deterministic aggregate calculation suppresses only an immaterial ownership question", () => {
  const rows = [row("NEEDS_CONFIRMATION", { type: "RANGE", lowerBound: 10, upperBound: 40, lowerInclusive: true, upperInclusive: true }, { type: "UNKNOWN" })];
  const analysis = chartAnalysis({ people: [{ id: "alice", name: "Alice Morgan", aggregate: 60, state: "SATISFIED", paths: [{ id: "certain", relationshipIds: ["certain-60"], contribution: 60 }, { id: "uncertain", relationshipIds: ["chart"], contribution: 10 }] }] });
  expect(ownershipFactMateriality(rows[0], personOwnershipAssessmentsFromChartAnalysis(analysis), analysis)).toEqual(expect.objectContaining({ material: false }));
  const engine = evaluate({ comparisonRows: rows, chartAnalysis: analysis });
  expect(question(engine, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE)).toBeUndefined();
  expect(engine.openQuestions).not.toContainEqual(expect.objectContaining({ comparisonItemId: "registry:chart" }));
  expect(engine.resolutions.find(({ comparisonItemId }) => comparisonItemId === "registry:chart")).toEqual(expect.objectContaining({ resolutionStatus: RESOLUTION_STATUS.RESOLVED_NOT_MATERIAL_TO_UBO_OUTCOME, reason: expect.stringContaining("not independently verified") }));
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

test("registry-outdated explanation requests the current fact but not a fictional change date", () => {
  const rows = [row("CONFLICT", { type: "EXACT", value: 60 }, { type: "EXACT", value: 20 })];
  const initial = evaluate({ comparisonRows: rows });
  const engine = evaluate({ comparisonRows: rows, answers: answer(question(initial, FACT_REQUIREMENT_TYPE.EXPLAIN_OWNERSHIP_DIFFERENCE), OWNERSHIP_DIFFERENCE_REASON.REGISTRY_OUTDATED) });
  expect(question(engine, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE)).toBeDefined();
  expect(question(engine, FACT_REQUIREMENT_TYPE.OWNERSHIP_CHANGE_EFFECTIVE_DATE)).toBeUndefined();
});

test("other discrepancy explanation is captured as free text for analyst review", () => {
  const rows = [row("CONFLICT", { type: "EXACT", value: 60 }, { type: "EXACT", value: 20 })];
  const initial = evaluate({ comparisonRows: rows });
  const mainQuestion = question(initial, FACT_REQUIREMENT_TYPE.EXPLAIN_OWNERSHIP_DIFFERENCE);
  let answers = answer(mainQuestion, OWNERSHIP_DIFFERENCE_REASON.OTHER);
  let engine = evaluate({ comparisonRows: rows, answers });
  const detailQuestion = engine.questions.find(({ factRequirementId }) => engine.requirements.find(({ id }) => id === factRequirementId)?.role === "OTHER_DETAILS");
  expect(detailQuestion).toEqual(expect.objectContaining({ type: "FREE_TEXT", status: QUESTION_STATUS.OPEN }));
  answers = { ...answers, ...answer(detailQuestion, "The chart reflects a pending court-approved reorganisation.") };
  engine = evaluate({ comparisonRows: rows, answers });
  expect(engine.resolutions[0]).toEqual(expect.objectContaining({ resolutionStatus: RESOLUTION_STATUS.REQUIRES_ANALYST_REVIEW, resultingFact: null }));
  expect(engine.resolutions[0].reason).toMatch(/captured for analyst review/i);
});

test("a registry-only holder is confirmed before exact ownership is requested", () => {
  const rows = [row("NEEDS_CONFIRMATION", { type: "RANGE", lowerBound: 10, upperBound: 40, lowerInclusive: true, upperInclusive: true }, null)];
  let engine = evaluate({ comparisonRows: rows });
  const confirmation = question(engine, FACT_REQUIREMENT_TYPE.CONFIRM_CURRENT_SHAREHOLDING);
  expect(confirmation.prompt).toMatch(/currently own shares/i);
  expect(question(engine, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE)).toBeUndefined();
  engine = evaluate({ comparisonRows: rows, answers: answer(confirmation, "YES") });
  expect(question(engine, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE)).toBeDefined();
});

test("a registry-only holder reported as removed asks for evidence, and resolves once it is satisfied", () => {
  const rows = [row("NEEDS_CONFIRMATION", { type: "EXACT", value: 40 }, null)];
  const initial = evaluate({ comparisonRows: rows });
  const answers = answer(question(initial, FACT_REQUIREMENT_TYPE.CONFIRM_CURRENT_SHAREHOLDING), "NO");
  let engine = evaluate({ comparisonRows: rows, answers });
  expect(engine.requirements).toContainEqual(expect.objectContaining({ type: FACT_REQUIREMENT_TYPE.CONFIRM_SHAREHOLDER_REMOVED, status: "RESOLVED", assertedValue: true }));
  // The customer is asked for a document rather than left waiting for an analyst.
  expect(engine.evidenceRequirements).toEqual([expect.objectContaining({ ruleKey: "SHAREHOLDER_REMOVED", removedHolder: "Alice Morgan", entity: "Target Limited", status: EVIDENCE_STATUS.OPEN })]);
  expect(engine.resolutions[0]).toEqual(expect.objectContaining({ resolutionStatus: RESOLUTION_STATUS.UNRESOLVED }));
  const evidenceId = engine.evidenceRequirements[0].id;
  engine = evaluate({ comparisonRows: rows, answers, evidence: { [evidenceId]: { status: EVIDENCE_STATUS.REJECTED, artifactId: "artifact-wrong" } } });
  expect(engine.resolutions[0].resolutionStatus).toBe(RESOLUTION_STATUS.UNRESOLVED);
  engine = evaluate({ comparisonRows: rows, answers, evidence: { [evidenceId]: { status: EVIDENCE_STATUS.SATISFIED, artifactId: "artifact-register" } } });
  expect(engine.resolutions[0]).toEqual(expect.objectContaining({
    resolutionStatus: RESOLUTION_STATUS.RESOLVED_EVIDENCE_VERIFIED,
    holderRemoved: true,
    resultingFact: null,
    ownershipLink: expect.objectContaining({ ownershipLinkEstablished: false, continueOwnershipTraversal: false }),
  }));
});

test("a removed corporate holder proven by evidence is not left as an ownership chain to trace", () => {
  const parent = company("Parent Holdings Limited");
  const rows = [{ key: "registry-only", status: "NEEDS_CONFIRMATION", detail: "Registry only.", researchFact: fact("registry", parent, target, { type: "RANGE", lowerBound: 75, upperBound: 100, lowerInclusive: true, upperInclusive: true }, "registry-source"), chartFact: null }];
  const initial = evaluate({ comparisonRows: rows });
  const answers = answer(question(initial, FACT_REQUIREMENT_TYPE.CONFIRM_CURRENT_SHAREHOLDING), "NO");
  const evidenceId = evaluate({ comparisonRows: rows, answers }).evidenceRequirements[0].id;
  const engine = evaluate({ comparisonRows: rows, answers, evidence: { [evidenceId]: { status: EVIDENCE_STATUS.SATISFIED, artifactId: "artifact-register" } } });
  expect(engine.resolutions[0]).toEqual(expect.objectContaining({ resolutionStatus: RESOLUTION_STATUS.RESOLVED_EVIDENCE_VERIFIED, holderPartyType: "LEGAL_ENTITY" }));
  expect(engine.resolutions[0].ownershipLink.continueOwnershipTraversal).toBe(false);
});

test("not sure whether a registry-only holder is current still goes to analyst review", () => {
  const rows = [row("NEEDS_CONFIRMATION", { type: "EXACT", value: 40 }, null)];
  const initial = evaluate({ comparisonRows: rows });
  const engine = evaluate({ comparisonRows: rows, answers: answer(question(initial, FACT_REQUIREMENT_TYPE.CONFIRM_CURRENT_SHAREHOLDING), "NOT_SURE") });
  expect(engine.evidenceRequirements).toEqual([]);
  expect(engine.resolutions[0].resolutionStatus).toBe(RESOLUTION_STATUS.REQUIRES_ANALYST_REVIEW);
});

test("removal evidence must show the company's full current holders without the removed one", () => {
  const bob = person("Bob Stone");
  const requirement = { comparisonItemId: "registry-only", ruleKey: "SHAREHOLDER_REMOVED", removedHolder: "Alice Morgan", entity: "Target Limited" };
  const register = (facts) => ({ artifact: { integrityVerified: true }, candidateFacts: facts });
  // A current register: Bob holds everything, Alice is not on it.
  expect(evidenceResultStatus(register([fact("r1", bob, target, { type: "EXACT", value: 100 }, "p")]), null, requirement).status).toBe(EVIDENCE_STATUS.SATISFIED);
  // Alice is still on it.
  expect(evidenceResultStatus(register([fact("r1", bob, target, { type: "EXACT", value: 60 }, "p"), fact("r2", alice, target, { type: "EXACT", value: 40 }, "p")]), null, requirement).status).toBe(EVIDENCE_STATUS.REJECTED);
  // Only part of the holdings: it cannot show who else holds the rest.
  expect(evidenceResultStatus(register([fact("r1", bob, target, { type: "EXACT", value: 60 }, "p")]), null, requirement).status).toBe(EVIDENCE_STATUS.REJECTED);
  // The same holder read twice does not make up the whole.
  expect(evidenceResultStatus(register([fact("r1", bob, target, { type: "EXACT", value: 60 }, "p"), fact("r2", bob, target, { type: "EXACT", value: 60 }, "p")]), null, requirement).status).toBe(EVIDENCE_STATUS.REJECTED);
  // About a different company.
  expect(evidenceResultStatus(register([fact("r1", bob, company("Other Limited"), { type: "EXACT", value: 100 }, "p")]), null, requirement).status).toBe(EVIDENCE_STATUS.REJECTED);
  // Not integrity-checked.
  expect(evidenceResultStatus({ artifact: { integrityVerified: false }, candidateFacts: [fact("r1", bob, target, { type: "EXACT", value: 100 }, "p")] }, null, requirement).status).toBe(EVIDENCE_STATUS.REJECTED);
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

test("nominee evidence satisfies only the declared holder, principal and exact interest", () => {
  const resolution = { resultingFact: { type: "NOMINEE_ARRANGEMENT", declaration: { REGISTERED_HOLDER: "ABC Nominees Ltd", UNDERLYING_OWNER: "Jane Smith", NOMINEE_INTEREST: 30 } } };
  const requirement = { comparisonItemId: "ownership-comparison:nominee-declaration" };
  const nomineeFact = {
    type: "ENTITY_ATTRIBUTE",
    subject: { name: "ABC Nominees Ltd" },
    value: { relationshipType: "NOMINEE_FOR", object: { name: "Jane Smith" }, relationshipValue: { kind: "EXACT", exact: 30 } },
  };
  const result = { artifact: { integrityVerified: true }, candidateFacts: [nomineeFact] };
  expect(evidenceResultStatus(result, resolution, requirement).status).toBe(EVIDENCE_STATUS.SATISFIED);
  expect(evidenceResultStatus({ ...result, candidateFacts: [{ ...nomineeFact, value: { ...nomineeFact.value, relationshipValue: { kind: "EXACT", exact: 20 } } }] }, resolution, requirement).status).toBe(EVIDENCE_STATUS.REJECTED);
  expect(evidenceResultStatus({ ...result, candidateFacts: [fact("unrelated", alice, target, { type: "EXACT", value: 30 }, "proof")] }, resolution, requirement).status).toBe(EVIDENCE_STATUS.REJECTED);
});

test("range threshold classification preserves definite and indeterminate outcomes", () => {
  expect(determineUboFromMeasurement({ type: "RANGE", lowerBound: 30, upperBound: 50, lowerInclusive: true, upperInclusive: true })).toBe(UBO_DETERMINATION.DEFINITE_UBO);
  expect(determineUboFromMeasurement({ type: "RANGE", lowerBound: 5, upperBound: 25, lowerInclusive: true, upperInclusive: false })).toBe(UBO_DETERMINATION.DEFINITE_NON_UBO);
  expect(determineUboFromMeasurement({ type: "RANGE", lowerBound: 10, upperBound: 40, lowerInclusive: true, upperInclusive: true })).toBe(UBO_DETERMINATION.INDETERMINATE);
});

test("a corporate owner above threshold remains an ownership link and never becomes an IDV subject", () => {
  const holdco = company("Holding Limited");
  const corporateRow = {
    key: "holdco:target",
    status: "INDEPENDENTLY_VERIFIED",
    researchFact: fact("holdco-target-research", holdco, target, { type: "EXACT", value: 80 }, "registry"),
    chartFact: fact("holdco-target", holdco, target, { type: "EXACT", value: 80 }, "chart"),
  };
  const analysis = {
    entityLabels: { holdco: holdco.name, target: target.name },
    view: { graph: { nodes: [{ entityId: "holdco", primaryName: holdco.name, category: "LEGAL_ENTITY" }, { entityId: "target", primaryName: target.name, category: "LEGAL_ENTITY" }], relationships: [{ relationshipId: "holdco-target", subjectEntityId: "holdco", objectEntityId: "target", measurement: { type: "EXACT", value: 80 } }] }, qualificationBases: [], qualifications: [] },
  };
  const engine = evaluate({ comparisonRows: [corporateRow], chartAnalysis: analysis });
  const resolution = engine.resolutions.find(({ comparisonItemId }) => comparisonItemId === corporateRow.key);
  expect(resolution.ownershipLink).toEqual(expect.objectContaining({ outcome: "OWNERSHIP_THRESHOLD_EXCEEDED", qualifyingOwnershipInterest: true, continueOwnershipTraversal: true }));
  expect(resolution.uboImpact).toEqual(expect.objectContaining({ assessmentLevel: "NOT_APPLICABLE_LEGAL_ENTITY", determination: null, idvRequired: false }));
  expect(engine.uboAssessments).toHaveLength(0);
  expect(idvRequiredForSubject({ partyType: "LEGAL_ENTITY", isUbo: true })).toBe(false);
});

test("person ownership is classified once from the aggregate of all recorded paths", () => {
  const analysis = chartAnalysis({ people: [{ id: "alice", name: "Alice Morgan", aggregate: 26, state: "SATISFIED", paths: [{ id: "direct", relationshipIds: ["direct-10"], contribution: 10 }, { id: "indirect", relationshipIds: ["alice-holdco", "holdco-target"], contribution: 16 }] }], extraNodes: [{ entityId: "holdco", primaryName: "Holding Limited", category: "LEGAL_ENTITY" }] });
  const assessments = personOwnershipAssessmentsFromChartAnalysis(analysis);
  expect(assessments).toHaveLength(1);
  expect(assessments[0]).toEqual(expect.objectContaining({ personName: "Alice Morgan", determination: UBO_DETERMINATION.DEFINITE_UBO, idvRequired: true, aggregateEffectiveOwnership: { type: "EXACT", value: "26" } }));
  expect(assessments[0].ownershipPaths.map(({ effectiveOwnership }) => effectiveOwnership.value)).toEqual(["10", "16"]);
});

test("indirect corporate traversal produces a person aggregate UBO while the company remains non-IDV", () => {
  const holdco = company("Holding Limited");
  const jane = person("Jane Smith");
  const rows = [
    { key: "jane-holdco", status: "INDEPENDENTLY_VERIFIED", researchFact: fact("jane-holdco-r", jane, holdco, { type: "EXACT", value: 60 }, "registry"), chartFact: fact("jane-holdco", jane, holdco, { type: "EXACT", value: 60 }, "chart") },
    { key: "holdco-target", status: "INDEPENDENTLY_VERIFIED", researchFact: fact("holdco-target-r", holdco, target, { type: "EXACT", value: 60 }, "registry"), chartFact: fact("holdco-target", holdco, target, { type: "EXACT", value: 60 }, "chart") },
  ];
  const analysis = {
    entityLabels: { jane: jane.name, holdco: holdco.name, target: target.name },
    view: {
      graph: { nodes: [{ entityId: "jane", primaryName: jane.name, category: "NATURAL_PERSON" }, { entityId: "holdco", primaryName: holdco.name, category: "LEGAL_ENTITY" }, { entityId: "target", primaryName: target.name, category: "LEGAL_ENTITY" }], relationships: [{ relationshipId: "jane-holdco", subjectEntityId: "jane", objectEntityId: "holdco", measurement: { type: "EXACT", value: 60 } }, { relationshipId: "holdco-target", subjectEntityId: "holdco", objectEntityId: "target", measurement: { type: "EXACT", value: 60 } }] },
      qualifications: [{ personEntityId: "jane", routeStatus: "ROUTE_SATISFIED" }],
      qualificationBases: [{ personEntityId: "jane", route: "EFFECTIVE_INTEREST", dimension: "ECONOMIC", assessmentState: "SATISFIED", threshold: { comparator: ">", value: 25 }, recordedCalculation: { value: { type: "EXACT", value: "36" } }, orderedPathReferences: [{ pathId: "jane-indirect", relationshipIds: ["jane-holdco", "holdco-target"], contribution: { type: "EXACT", value: "36" } }] }],
    },
  };
  const engine = evaluate({ comparisonRows: rows, chartAnalysis: analysis });
  expect(engine.personOwnershipAssessments[0]).toEqual(expect.objectContaining({ personName: "Jane Smith", determination: UBO_DETERMINATION.DEFINITE_UBO, idvRequired: true }));
  expect(engine.resolutions.find(({ comparisonItemId }) => comparisonItemId === "holdco-target").uboImpact).toEqual(expect.objectContaining({ determination: null, idvRequired: false }));
});
