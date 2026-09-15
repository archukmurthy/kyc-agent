import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import UboDemoRoot from "./UboDemoRoot";
import { accountOpenItems, assertionSourceState, buildResearchRequest, compactResearchResult, DEMO_CALCULATION_FIXTURES, DEMO_GRAPH_DIMENSIONS, DEMO_GRAPH_SCOPES, demoCalculationPeople, demoOpenQuestions, demoSourceRelevantEntityIds, executableCustomerBundles, formatMeasurement, projectDemoGraph, relationshipAssertionPresentation, relationshipCategory } from "./demoResearch";
import { DEMO_RESEARCH_PATH, DEMO_START_PATH, isUboDemoPath } from "./demoRoute";
import { CALCULATION_METHODS, DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY, OWNERSHIP_TYPES, emptyDemoDraft, writeDemoSession } from "./demoSession";

const fact = { factId: "fact-1", type: "RELATIONSHIP", relationship: "ECONOMIC_OWNERSHIP", subject: { name: "Owner Ltd" }, object: { name: "Target Ltd" }, measurement: { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true }, qualifiers: { currentState: "CURRENT" }, evidenceReferences: [{ referenceId: "CH-PSC-1" }] };
const projection = { contractVersion: "ubo-ownership-graph-projection-v2", projectionId: "graph-1", subjectEntityId: "target", nodes: [], relationships: [] };
const evaluatedSession = { sourceLabel: "Fixture", candidateSources: [{ sourceRecordId: "source-1", sourceState: "FIXTURE", candidateFacts: [fact] }], decisionTargets: { candidateParties: [], candidateClaims: [] }, snapshots: [{ view: { graph: projection, journeyProjection: { customerWorkBundles: [{ bundleId: "open", state: "OPEN", canonicalSubject: { name: "Owner Ltd" }, permittedSemanticActions: [{ actionType: "PROVIDE_STRUCTURED_INFORMATION", executable: true }] }, { bundleId: "blocked", state: "SIGNOFF_REQUIRED", permittedSemanticActions: [{ actionType: "REQUEST_EXTERNAL_EVIDENCE", executable: false }] }], internalReview: { actions: [], requirements: [{ reasonCode: "REVIEW" }] } } } }] };
const aliceBasis = { basisId: "basis-alice-effective", personEntityId: "alice", route: "EFFECTIVE_INTEREST", dimension: "ECONOMIC", assessmentState: "SATISFIED", method: "ubo-percentage-lookthrough-v1", threshold: { value: 25, comparator: ">", classification: "STATUTORY", dimension: "ECONOMIC" }, recordedCalculation: { value: { type: "EXACT", value: "28" }, cycles: [] }, orderedPathReferences: [{ pathId: "direct", state: "KNOWN", relationshipIds: ["direct-10"], contribution: { type: "EXACT", value: "10" } }, { pathId: "indirect", state: "KNOWN", relationshipIds: ["alice-holdco", "holdco-target"], contribution: { type: "EXACT", value: "18" } }] };
const aliceSession = { sourceLabel: "Alice fixture", selectedFixtureId: "DEMO-ALICE-28", entityDirectory: [{ entityId: "alice", party: { name: "Alice Example" } }, { entityId: "holdco", party: { name: "Example Holdings Ltd" } }, { entityId: "target", party: { name: "Example Trading Ltd" } }], candidateSources: [], decisionTargets: { candidateParties: [], candidateClaims: [] }, snapshots: [{ view: { graph: { contractVersion: "ubo-ownership-graph-projection-v2", subjectEntityId: "target", nodes: [{ entityId: "alice", primaryName: "Alice Example" }, { entityId: "holdco", primaryName: "Example Holdings Ltd" }, { entityId: "target", primaryName: "Example Trading Ltd" }], relationships: [{ relationshipId: "direct-10", subjectEntityId: "alice", objectEntityId: "target", relationshipType: "ECONOMIC_OWNERSHIP", dimension: "ECONOMIC", measurement: { type: "EXACT", value: 10 } }, { relationshipId: "alice-holdco", subjectEntityId: "alice", objectEntityId: "holdco", relationshipType: "ECONOMIC_OWNERSHIP", dimension: "ECONOMIC", measurement: { type: "EXACT", value: 60 } }, { relationshipId: "holdco-target", subjectEntityId: "holdco", objectEntityId: "target", relationshipType: "ECONOMIC_OWNERSHIP", dimension: "ECONOMIC", measurement: { type: "EXACT", value: 30 } }], informationNeeds: [], reviewRequirements: [], qualificationBasisRecords: [aliceBasis], personQualificationAssessments: [{ personEntityId: "alice", routeStatus: "ROUTE_SATISFIED", assessedRoutes: ["EFFECTIVE_INTEREST"], unassessedRoutes: ["PSC_CONDITION_ATTRIBUTION"] }] }, qualificationBases: [aliceBasis], qualifications: [{ personEntityId: "alice", routeStatus: "ROUTE_SATISFIED", assessedRoutes: ["EFFECTIVE_INTEREST"], unassessedRoutes: ["PSC_CONDITION_ATTRIBUTION"] }], informationNeeds: [], plan: { recommendedActions: [], customerActions: [] }, journeyProjection: { customerWorkBundles: [], internalReview: { actions: [], requirements: [] } }, snapshot: { decisionContent: { resolutionOptionsV2: [] } } } }] };

function okJson(value) { return Promise.resolve({ ok: true, json: () => Promise.resolve(value) }); }
function renderStart() { window.history.replaceState({}, "", DEMO_START_PATH); return render(<UboDemoRoot />); }
function completeRequiredFields({ name = "Acme Holdings Limited", number = "00445790" } = {}) { fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: name } }); fireEvent.change(screen.getByLabelText(/Registration number/), { target: { value: number } }); }

beforeEach(() => { window.localStorage.clear(); window.history.replaceState({}, "", "/"); window.fetch = jest.fn(() => okJson(evaluatedSession)); });
afterEach(() => { window.localStorage.clear(); jest.restoreAllMocks(); });

test("new demo route loads and existing Lab route remains separate", () => { renderStart(); expect(screen.getByRole("heading", { name: /research your company/i })).toBeInTheDocument(); expect(isUboDemoPath("/ubo-demo/")).toBe(true); expect(isUboDemoPath("/ubo-control-lab/")).toBe(false); });
test("country, ownership type and calculation inspection use approved defaults", () => { renderStart(); expect(screen.getByLabelText(/Country of registration/)).toHaveValue("GB"); expect(screen.getByLabelText(/Ownership type/)).toHaveValue("PRIVATE_LIMITED"); expect(screen.getByRole("radio", { name: /All policy routes/ })).toBeChecked(); });
test("required fields are validated and case reference stays optional", () => { renderStart(); fireEvent.click(screen.getByRole("button", { name: /Start research/ })); expect(screen.getByText("Enter the registered company name.")).toBeInTheDocument(); expect(screen.getByText("Enter the company registration number.")).toBeInTheDocument(); });
test("ownership and calculation options map to stable semantic codes", () => { expect(OWNERSHIP_TYPES.map(({ code }) => code)).toEqual(["PRIVATE_LIMITED", "PUBLIC_LIMITED", "PUBLICLY_LISTED", "LLP", "PARTNERSHIP", "CHARITY", "TRUST", "CIC", "OTHER"]); expect(CALCULATION_METHODS.map(({ code }) => code)).toEqual(["POLICY_ALL_ROUTES", "EFFECTIVE_INTEREST", "PSC_CONDITION_ATTRIBUTION"]); });

test("Start research invokes the existing live Lab composition and preserves a leading zero", async () => {
  renderStart(); completeRequiredFields({ number: "0012AB34" }); fireEvent.click(screen.getByLabelText(/Effective ownership/)); fireEvent.click(screen.getByRole("button", { name: /Start research/ }));
  expect(window.location.pathname).toBe(DEMO_RESEARCH_PATH);
  await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(1));
  const body = JSON.parse(window.fetch.mock.calls[0][1].body);
  expect(body).toEqual(expect.objectContaining({ operation: "START_DEMO_REVIEW_LIVE", payload: expect.objectContaining({ companyContext: expect.objectContaining({ legalEntityName: "Acme Holdings Limited", registrationNumber: "0012AB34", jurisdiction: "GB" }) }) }));
  expect(JSON.stringify(body)).not.toContain("calculationMethod");
  await screen.findByRole("heading", { name: "Ownership structure" });
  expect(JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY)).demoCase.company.registrationNumber).toBe("0012AB34");
});

test("old sessions default to all policy routes and selector state survives refresh", () => {
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({ contractVersion: DEMO_SESSION_CONTRACT, draft: { legalName: "Old Ltd", registrationNumber: "00000001", countryCode: "GB", ownershipType: "PRIVATE_LIMITED", referenceCaseId: "", sourceMode: "LIVE", replayId: "" } }));
  renderStart();
  expect(screen.getByLabelText(/All policy routes/)).toBeChecked();
  fireEvent.click(screen.getByLabelText(/Control attribution/));
  expect(JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY)).draft.calculationMethod).toBe("PSC_CONDITION_ATTRIBUTION");
});

test("Alice example uses one fixture operation and presents the recorded 10 plus 18 equals 28 engine result", async () => {
  window.fetch = jest.fn(() => okJson(aliceSession));
  renderStart();
  fireEvent.click(screen.getByRole("button", { name: /Load Alice example/ }));
  await screen.findByRole("heading", { name: "How this result was calculated" });
  const body = JSON.parse(window.fetch.mock.calls[0][1].body);
  expect(body).toEqual({ operation: "START_DEMO_CALCULATION_FIXTURE", payload: { fixtureId: DEMO_CALCULATION_FIXTURES.ALICE_28 } });
  expect(window.fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText(/Effective ownership/)).toBeChecked();
  expect(screen.getAllByText("Threshold satisfied under effective ownership")).toHaveLength(2);
  expect(screen.getByText("10% = 10%")).toBeInTheDocument();
  expect(screen.getByText("60% × 30% = 18%")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Recorded result 28%/ })).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/Control attribution/));
  expect(screen.getByText(/This assessment route is not supported/)).toBeInTheDocument();
  expect(screen.getByText("At least one policy route is satisfied")).toBeInTheDocument();
  expect(window.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY)).draft.calculationMethod).toBe("PSC_CONDITION_ATTRIBUTION");
});

test("method presentation preserves recorded 24 percent effective and 40 percent attribution results", () => {
  const relationship = (id, from, to, type, value) => ({ relationshipId: id, subjectEntityId: from, objectEntityId: to, relationshipType: type, dimension: type === "VOTING_RIGHTS" ? "VOTING" : "ECONOMIC", measurement: { type: "EXACT", value } });
  const effective = { basisId: "effective", personEntityId: "alice", route: "EFFECTIVE_INTEREST", dimension: "ECONOMIC", assessmentState: "NOT_SATISFIED", method: "ubo-percentage-lookthrough-v1", recordedCalculation: { value: { type: "EXACT", value: "24" }, cycles: [] }, orderedPathReferences: [{ pathId: "effective-path", relationshipIds: ["economic-60", "target-40"], contribution: { type: "EXACT", value: "24" } }] };
  const attributed = { basisId: "attributed", personEntityId: "alice", route: "PSC_CONDITION_ATTRIBUTION", dimension: "ECONOMIC", assessmentState: "SATISFIED", method: "ubo-psc-attribution-v1", aggregatedTargetRightValue: { type: "EXACT", value: "40" }, attributionChains: [{ pathId: "control-path", relationshipIds: ["voting-60", "target-40"], majoritySteps: [{ relationshipId: "voting-60", fromEntityId: "alice", toEntityId: "holdco", relationshipType: "VOTING_RIGHTS", measurement: { type: "EXACT", value: 60 } }], state: "VALID" }] };
  const view = { graph: { nodes: [{ entityId: "alice", primaryName: "Alice" }, { entityId: "holdco", primaryName: "HoldCo" }, { entityId: "target", primaryName: "Customer" }], relationships: [relationship("economic-60", "alice", "holdco", "ECONOMIC_OWNERSHIP", 60), relationship("voting-60", "alice", "holdco", "VOTING_RIGHTS", 60), relationship("target-40", "holdco", "target", "ECONOMIC_OWNERSHIP", 40)] }, qualificationBases: [effective, attributed], qualifications: [{ personEntityId: "alice", routeStatus: "ROUTE_SATISFIED", assessedRoutes: ["EFFECTIVE_INTEREST", "PSC_CONDITION_ATTRIBUTION"] }] };
  expect(demoCalculationPeople(view, "EFFECTIVE_INTEREST")[0].selectedBases[0].aggregate.value).toBe("24");
  expect(demoCalculationPeople(view, "PSC_CONDITION_ATTRIBUTION")[0].selectedBases[0].aggregate.value).toBe("40");
  expect(demoCalculationPeople(view, "PSC_CONDITION_ATTRIBUTION")[0].selectedBases[0].effectivePaths).toEqual([]);
  expect(demoCalculationPeople(view, "PSC_CONDITION_ATTRIBUTION")[0].selectedBases[0].attributionChains[0].majoritySteps[0]).toEqual(expect.objectContaining({ relationshipType: "VOTING_RIGHTS", measurement: "60%" }));
});

test("reviewed fixture makes no provider call and renders graph, collapsed source assertions and only executable customer work", async () => {
  renderStart(); completeRequiredFields(); fireEvent.click(screen.getByLabelText(/Reviewed ASDA fixture/)); fireEvent.click(screen.getByRole("button", { name: /Start research/ }));
  await screen.findByTitle("Ownership structure");
  const body = JSON.parse(window.fetch.mock.calls[0][1].body);
  expect(body).toEqual({ operation: "START_REVIEW_FIXTURE", payload: { fixtureId: "V2-LAB-08" } });
  expect(window.fetch.mock.calls[0][0]).toBe("/api/ubo-control-lab");
  const disclosure = screen.getByText(/1 assertions · click to inspect/).closest("details");
  expect(disclosure).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText(/1 assertions · click to inspect/));
  expect(screen.getByText("Owner Ltd", { selector: "strong" })).toBeInTheDocument();
  expect(screen.getByText(/Provide the remaining ownership or control details/)).toBeInTheDocument();
  expect(screen.getByText(/Internal review is still in progress/)).toBeInTheDocument();
  const graphCard = screen.getByRole("heading", { name: "Ownership structure" }).closest("section");
  const questions = screen.getByRole("heading", { name: "Open questions" }).closest("aside");
  expect(graphCard.compareDocumentPosition(questions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("a response without an evaluated snapshot exposes no invented graph or questions", async () => {
  window.fetch = jest.fn(() => okJson({ candidateSources: evaluatedSession.candidateSources, decisionTargets: { candidateParties: [{ candidatePartyKey: "p" }], candidateClaims: [{ claimId: "c" }] }, snapshots: [] }));
  renderStart(); completeRequiredFields(); fireEvent.click(screen.getByRole("button", { name: /Start research/ }));
  expect(await screen.findByRole("heading", { name: /Explicit review is required/ })).toBeInTheDocument();
  expect(screen.getByText(/2 candidate identity or claim decisions remain/)).toBeInTheDocument();
  expect(screen.getByText("Nothing needed from you right now.")).toBeInTheDocument();
  expect(screen.getByText("We are still reviewing parts of the ownership structure.")).toBeInTheDocument();
});

test("refresh restores the normalized result and Start new case clears it", async () => {
  renderStart(); completeRequiredFields(); fireEvent.click(screen.getByLabelText(/Reviewed ASDA fixture/)); fireEvent.click(screen.getByRole("button", { name: /Start research/ })); await screen.findByTitle("Ownership structure");
  expect(window.localStorage.getItem(DEMO_SESSION_KEY)).toContain("graph-1");
  fireEvent.click(screen.getByRole("button", { name: "Start new case" })); expect(window.localStorage.getItem(DEMO_SESSION_KEY)).toBeNull(); expect(screen.getByLabelText(/Company name/)).toHaveValue("");
});

test("pure boundaries preserve ranges and filter raw blocked work", () => {
  expect(formatMeasurement(fact.measurement)).toBe("(25%, 50%]");
  expect([relationshipCategory("ECONOMIC_OWNERSHIP"), relationshipCategory("VOTING_RIGHTS"), relationshipCategory("SIGNIFICANT_INFLUENCE_OR_CONTROL")]).toEqual(["Ownership", "Voting", "Control"]);
  expect(executableCustomerBundles(evaluatedSession.snapshots[0].view)).toHaveLength(1);
  expect(buildResearchRequest({ demoCase: { company: { legalName: "A", registrationNumber: "0001", countryCode: "GB", ownershipType: "PRIVATE_LIMITED" } }, sourceMode: "LIVE" }).operation).toBe("START_DEMO_REVIEW_LIVE");
  expect(buildResearchRequest({ demoCase: { company: { legalName: "TDR GP V LP", registrationNumber: "SL035224", countryCode: "GB", ownershipType: "PARTNERSHIP" } }, sourceMode: "LIVE" }).payload.companyContext.entityProfile).toBe("LLP");
  expect(buildResearchRequest({ sourceMode: "REPLAY", replayRecord: { replayId: "saved-1" } })).toEqual({ operation: "START_DEMO_REVIEW_REPLAY", payload: { replayRecord: { replayId: "saved-1" }, profileId: "NOT_PROVIDED" } });
});

test("compact demo result retains customer-readable entity labels separately from the signed graph projection", () => {
  const compact = compactResearchResult({
    ...evaluatedSession,
    entityDirectory: [
      { entityId: "owner", party: { name: "Owner Ltd" } },
      { entityId: "target", party: { name: "Target Ltd" } },
    ],
  }, "LIVE");
  expect(compact.entityLabels).toEqual({ owner: "Owner Ltd", target: "Target Ltd" });
  expect(compact.view.graph).toBe(projection);
});

test("scope and relationship controls filter a projection independently without provider calls", () => {
  const graph = {
    contractVersion: "ubo-ownership-graph-projection-v2", subjectEntityId: "subject",
    nodes: ["subject", "llp", "person", "disconnected"].map((entityId) => ({ entityId })),
    relationships: [
      { relationshipId: "economic", subjectEntityId: "llp", objectEntityId: "subject", relationshipType: "ECONOMIC_OWNERSHIP", dimension: "ECONOMIC" },
      { relationshipId: "voting", subjectEntityId: "person", objectEntityId: "llp", relationshipType: "VOTING_RIGHTS", dimension: "VOTING" },
      { relationshipId: "disconnected-control", subjectEntityId: "disconnected", objectEntityId: "disconnected", relationshipType: "FORMAL_CONTROL_RIGHT", dimension: "CONTROL" },
    ],
  };
  const relevantVoting = projectDemoGraph(graph, { scope: DEMO_GRAPH_SCOPES.RELEVANT, dimension: DEMO_GRAPH_DIMENSIONS.VOTING });
  expect(relevantVoting.nodes.map(({ entityId }) => entityId).sort()).toEqual(["llp", "person", "subject"]);
  expect(relevantVoting.relationships.map(({ relationshipId }) => relationshipId)).toEqual(["voting"]);
  const fullControl = projectDemoGraph(graph, { scope: DEMO_GRAPH_SCOPES.FULL, dimension: DEMO_GRAPH_DIMENSIONS.CONTROL });
  expect(fullControl.nodes).toHaveLength(4);
  expect(fullControl.relationships.map(({ relationshipId }) => relationshipId)).toEqual(["disconnected-control"]);
  expect(window.fetch).not.toHaveBeenCalled();
});

test("IAG and Law Debenture director rights remain two exact control edges in Control and All views", () => {
  const graph = {
    contractVersion: "ubo-ownership-graph-projection-v2", subjectEntityId: "ba",
    nodes: ["ba", "iag", "ldc", "law"].map((entityId) => ({ entityId })),
    relationships: [
      { relationshipId: "iag-ba-owner", subjectEntityId: "iag", objectEntityId: "ba", relationshipType: "ECONOMIC_OWNERSHIP", dimension: "ECONOMIC" },
      { relationshipId: "iag-ba-directors", subjectEntityId: "iag", objectEntityId: "ba", relationshipType: "FORMAL_CONTROL_RIGHT", dimension: "CONTROL", qualifiers: { sourceNatureOfControl: "right-to-appoint-and-remove-directors" } },
      { relationshipId: "ldc-ba-owner", subjectEntityId: "ldc", objectEntityId: "ba", relationshipType: "ECONOMIC_OWNERSHIP", dimension: "ECONOMIC" },
      { relationshipId: "law-ldc-directors", subjectEntityId: "law", objectEntityId: "ldc", relationshipType: "FORMAL_CONTROL_RIGHT", dimension: "CONTROL", qualifiers: { sourceNatureOfControl: "right-to-appoint-and-remove-directors" } },
    ],
  };
  const control = projectDemoGraph(graph, { scope: DEMO_GRAPH_SCOPES.FULL, dimension: DEMO_GRAPH_DIMENSIONS.CONTROL });
  const all = projectDemoGraph(graph, { scope: DEMO_GRAPH_SCOPES.FULL, dimension: DEMO_GRAPH_DIMENSIONS.ALL });
  const voting = projectDemoGraph(graph, { scope: DEMO_GRAPH_SCOPES.FULL, dimension: DEMO_GRAPH_DIMENSIONS.VOTING });
  expect(control.relationships.map(({ relationshipId }) => relationshipId)).toEqual(["iag-ba-directors", "law-ldc-directors"]);
  expect(all.relationships).toHaveLength(4);
  expect(voting.relationships).toHaveLength(0);
  expect(control.relationships).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ subjectEntityId: "law", objectEntityId: "ba" }),
    expect.objectContaining({ subjectEntityId: "ldc", objectEntityId: "ba", relationshipType: "FORMAL_CONTROL_RIGHT" }),
  ]));
  expect(window.fetch).not.toHaveBeenCalled();
});

test("source-backed director-control assertions use right wording and no percentage-unknown label", () => {
  const controlFact = {
    relationship: "FORMAL_CONTROL_RIGHT",
    qualifiers: { controlConcept: "APPOINT_OR_REMOVE_PERSONS", sourceStatementMode: "COMBINED_ALTERNATIVE", sourceNatureOfControl: "right-to-appoint-and-remove-directors" },
    evidenceReferences: [{ system: "legacy-ubo-discovery", referenceId: "companies-house:01777777:psc:1", locator: { source: "companies-house" } }],
  };
  expect(relationshipAssertionPresentation(controlFact)).toEqual({
    category: "Control",
    description: "Right to appoint or remove directors",
    measurement: null,
    sourceDescription: "Recorded in Companies House PSC information",
  });
  expect(relationshipAssertionPresentation({ relationship: "FORMAL_CONTROL_RIGHT", evidenceReferences: [] })).toEqual(expect.objectContaining({
    description: "Formal control right reported — details not available in this result",
    measurement: null,
  }));
  expect(formatMeasurement({ type: "UNKNOWN" })).toBe("Value not established", "economic/voting unknown semantics stay unchanged");
});

test("a source-backed unresolved control assertion retains its canonical branch without manufacturing an edge", () => {
  const graph = { subjectEntityId: "subject", nodes: [{ entityId: "subject", primaryName: "Target LP" }, { entityId: "llp", primaryName: "TDR Capital LLP" }, { entityId: "gp", primaryName: "GP V Limited" }], relationships: [{ relationshipId: "llp-gp", subjectEntityId: "llp", objectEntityId: "gp", relationshipType: "ECONOMIC_OWNERSHIP", dimension: "ECONOMIC" }] };
  const result = { entityLabels: { subject: "Target LP", llp: "TDR Capital LLP", gp: "GP V Limited" }, entityContexts: { subject: { entityId: "subject", legalName: "Target LP", registrationNumber: "SL1" }, llp: { entityId: "llp", legalName: "TDR Capital LLP", registrationNumber: "OC1" }, gp: { entityId: "gp", legalName: "GP V Limited", registrationNumber: "SC1" } }, candidateSources: [{ candidateFacts: [{ type: "RELATIONSHIP", relationship: "FORMAL_CONTROL_RIGHT", subject: { name: "GP V Limited", externalIdentifiers: [{ value: "SC1" }] }, object: { name: "Target LP", externalIdentifiers: [{ value: "SL1" }] } }] }] };
  const relevant = demoSourceRelevantEntityIds(graph, result);
  const visible = projectDemoGraph(graph, { additionalRelevantEntityIds: relevant });
  expect(relevant).toEqual(["gp"]);
  expect(visible.nodes.map(({ entityId }) => entityId).sort()).toEqual(["gp", "llp", "subject"]);
  expect(visible.relationships.map(({ relationshipId }) => relationshipId)).toEqual(["llp-gp"]);
  expect(visible.relationships).not.toEqual(expect.arrayContaining([expect.objectContaining({ relationshipType: "FORMAL_CONTROL_RIGHT" })]));
});

test("open-item accounting presents every cause while preserving the no-customer-action planner outcome", () => {
  const concepts = ["CURRENT_OWNERSHIP_AND_CONTROL", "INDEPENDENT_CORROBORATION", "LAYER_QUALIFIER", "LLP_GOVERNANCE_CONTROL_BASIS", "NOMINEE_BEARER_STATUS", "TRUST_STATUS", "VOTING_CONTROL_STATUS"];
  const needs = concepts.map((concept, index) => ({ needId: `need-${index}`, concept, status: "OPEN", reasonCode: `${concept}_INCOMPLETE`, requiredByRequirementIds: [`UBO-R${index + 1}`], targetReference: { entityId: concept === "CURRENT_OWNERSHIP_AND_CONTROL" ? "llp" : "subject", ...(concept === "LLP_GOVERNANCE_CONTROL_BASIS" ? { groupPersonIds: ["person-a", "person-b"] } : {}) }, affected: { relationshipIds: [] } }));
  const currentSystem = ["CURRENT_OWNERSHIP_AND_CONTROL", "LAYER_QUALIFIER", "LLP_GOVERNANCE_CONTROL_BASIS", "VOTING_CONTROL_STATUS"].map((concept) => ({ actor: "SYSTEM", semanticActionType: "DISCOVER_INFORMATION", coveredInformationNeedIds: [needs.find((need) => need.concept === concept).needId] }));
  const customerOptions = ["TRUST_STATUS", "NOMINEE_BEARER_STATUS", "VOTING_CONTROL_STATUS"].map((concept) => ({ optionId: `option-${concept}`, actor: "CUSTOMER", semanticActionType: "REQUEST_STRUCTURED_INFORMATION", informationNeedIds: [needs.find((need) => need.concept === concept).needId], contentReadiness: "REQUIRES_POLICY_CONTENT", requiredSignoffs: [] }));
  customerOptions.push({ optionId: "option-evidence", actor: "CUSTOMER", semanticActionType: "REQUEST_STRUCTURE_EVIDENCE", informationNeedIds: [needs.find((need) => need.concept === "INDEPENDENT_CORROBORATION").needId], contentReadiness: "NOT_REQUIRED" });
  const view = { informationNeeds: needs, graph: { subjectEntityId: "subject", reviewRequirements: [] }, plan: { state: "SYSTEM_RESOLUTION", recommendedActions: currentSystem, customerActions: [{ actor: "CUSTOMER", semanticActionType: "REQUEST_STRUCTURE_EVIDENCE", coveredInformationNeedIds: [needs.find((need) => need.concept === "INDEPENDENT_CORROBORATION").needId] }] }, snapshot: { decisionContent: { resolutionOptionsV2: customerOptions } }, journeyProjection: { customerWorkBundles: [], internalReview: { requirements: [{ relatedInformationNeedIds: [needs.find((need) => need.concept === "LLP_GOVERNANCE_CONTROL_BASIS").needId] }] } } };
  const result = { entityContexts: { subject: { entityId: "subject", legalName: "TDR CAPITAL GENERAL PARTNER V L.P.", registrationNumber: "SL035224" }, llp: { entityId: "llp", legalName: "TDR CAPITAL LLP", registrationNumber: "OC302604" }, "person-a": { entityId: "person-a", legalName: "MR GARY LINDSAY" }, "person-b": { entityId: "person-b", legalName: "MANJIT DALE" } } };
  const items = accountOpenItems(view, result);
  expect(items).toHaveLength(7);
  expect(items.find(({ concept }) => concept === "CURRENT_OWNERSHIP_AND_CONTROL").about[0]).toEqual(expect.objectContaining({ legalName: "TDR CAPITAL LLP", registrationNumber: "OC302604" }));
  expect(items.find(({ concept }) => concept === "LLP_GOVERNANCE_CONTROL_BASIS").targetChoices).toHaveLength(3);
  expect(items.find(({ concept }) => concept === "LLP_GOVERNANCE_CONTROL_BASIS").disposition.code).toBe("INTERNAL_REVIEW");
  expect(items.find(({ concept }) => concept === "TRUST_STATUS").disposition.code).toBe("QUESTION_NOT_ENABLED");
  expect(items.find(({ concept }) => concept === "INDEPENDENT_CORROBORATION").disposition.code).toBe("POSSIBLE_LATER");
});

test("demo presenter preserves planner routes, keeps evidence as evidence and groups content-gated questions", () => {
  const view = {
    informationNeeds: [
      { needId: "need-evidence", concept: "INDEPENDENT_CORROBORATION" },
      { needId: "need-layer", concept: "LAYER_QUALIFIER" },
      { needId: "need-current", concept: "RELATIONSHIP_CURRENTNESS" },
      { needId: "need-trust", concept: "TRUST_STATUS" },
      { needId: "need-internal", concept: "IDENTITY_AGGREGATION" },
    ],
    journeyProjection: { customerWorkBundles: [], internalReview: { actions: [], requirements: [] } },
    plan: {
      state: "SYSTEM_RESOLUTION",
      customerActions: [{ actionId: "action-evidence", semanticActionType: "REQUEST_STRUCTURE_EVIDENCE", coveredInformationNeedIds: ["need-evidence"], coveredRequirementIds: ["UBO-R08"] }],
    },
    snapshot: { decisionContent: { resolutionOptionsV2: [
      { optionId: "option-layer", actor: "CUSTOMER", semanticActionType: "REQUEST_STRUCTURED_INFORMATION", informationNeedIds: ["need-layer", "need-current"], requirementIds: ["UBO-R01"], contentReadiness: "READY" },
      { optionId: "option-trust", actor: "CUSTOMER", semanticActionType: "REQUEST_STRUCTURED_INFORMATION", informationNeedIds: ["need-trust"], requirementIds: ["UBO-R11"], contentReadiness: "REQUIRES_POLICY_CONTENT" },
      { optionId: "option-internal", actor: "INTERNAL", semanticActionType: "INTERNAL_REVIEW", informationNeedIds: ["need-internal"], requirementIds: ["UBO-R02"], contentReadiness: "NOT_REQUIRED" },
    ] } },
  };
  const presented = demoOpenQuestions(view);
  expect(presented.map(({ kind }) => kind)).toContain("EVIDENCE_REQUEST");
  expect(presented.find(({ kind }) => kind === "EVIDENCE_REQUEST").informationNeedIds).toEqual(["need-evidence"]);
  expect(presented.filter(({ title }) => title === "Remaining ownership structure")).toHaveLength(1);
  expect(presented.find(({ title }) => title === "Trust involvement")).toEqual(expect.objectContaining({ state: "DEMO_CONTENT_FALLBACK", contentApproved: false, optionIds: ["option-trust"] }));
  expect(presented.flatMap(({ informationNeedIds }) => informationNeedIds)).not.toContain("need-internal");
});

test("compact result projects source-backed foreign and PSC-exempt registry context without changing graph semantics", () => {
  const registryFacts = [
    { factId: "iag", type: "ENTITY_ATTRIBUTE", attribute: "REGISTRY_CONTEXT", subject: { name: "IAG S.A.", jurisdiction: "ES", externalIdentifiers: [{ namespace: "legacy-company-register:ES", value: "M-492,129" }] }, value: { legalForm: "Spanish Public Company-Sociedad Anonima", governingLaw: "Law Of Spain", incorporatedIn: "Spain", placeRegistered: "Madrid Mercantile Register", registrationNumber: "M-492,129" }, evidenceReferences: [{ system: "legacy-ubo-discovery", referenceType: "SOURCE_REFERENCE", referenceId: "ch:ba:psc" }] },
    { factId: "law-profile", type: "ENTITY_ATTRIBUTE", attribute: "REGISTRY_CONTEXT", subject: { name: "THE LAW DEBENTURE CORPORATION P.L.C.", jurisdiction: "GB", externalIdentifiers: [{ namespace: "legacy-company-register:GB", value: "00030397" }] }, value: { legalForm: "Public limited company (PLC)", incorporatedIn: "United Kingdom", registrationNumber: "00030397" }, evidenceReferences: [{ system: "legacy-ubo-discovery", referenceType: "SOURCE_REFERENCE", referenceId: "ch:law:profile" }] },
    { factId: "law-exemption", type: "ENTITY_ATTRIBUTE", attribute: "REGISTRY_CONTEXT", subject: { name: "THE LAW DEBENTURE CORPORATION P.L.C.", jurisdiction: "GB", externalIdentifiers: [{ namespace: "legacy-company-register:GB", value: "00030397" }] }, value: { pscStatus: "EXEMPT", pscExemptionReason: "Voting shares admitted to trading on an EU regulated market", pscExemptionEffectiveFrom: "2021-05-25" }, evidenceReferences: [{ system: "legacy-ubo-discovery", referenceType: "SOURCE_REFERENCE", referenceId: "ch:law:exemptions" }] },
  ];
  const compact = compactResearchResult({
    ...evaluatedSession,
    candidateSources: [{ sourceRecordId: "registry", candidateFacts: registryFacts }],
    entityDirectory: [
      { entityId: "iag-id", party: registryFacts[0].subject },
      { entityId: "law-id", party: registryFacts[1].subject },
    ],
  }, "LIVE");
  expect(compact.registryContexts["iag-id"]).toEqual(expect.objectContaining({ incorporatedIn: "Spain", researchCoverage: expect.objectContaining({ state: "UNSUPPORTED_JURISDICTION" }) }));
  expect(compact.registryContexts["iag-id"].badges.map(({ label }) => label)).toEqual(["SPAIN", "Public company", "Research frontier"]);
  expect(compact.registryContexts["law-id"]).toEqual(expect.objectContaining({ pscStatus: "EXEMPT", pscExemptionEffectiveFrom: "2021-05-25" }));
  expect(compact.registryContexts["law-id"].badges.map(({ label }) => label)).toEqual(["PLC", "PSC exempt"]);
  expect(compact.view.graph).toBe(projection);
});

test("live assertions retain their actual live-operation label after replay-safe review hydration", () => {
  expect(assertionSourceState({ sourceMode: "LIVE" }, { sourceState: "REPLAY" })).toBe("LIVE");
  expect(assertionSourceState({ sourceMode: "REPLAY" }, { sourceState: "REPLAY" })).toBe("REPLAY");
});

test("Screen 2 uses the source-backed registry legal form instead of the Screen 1 context", async () => {
  const draft = { ...emptyDemoDraft(), legalName: "TDR CAPITAL LLP", registrationNumber: "OC302604", ownershipType: "PRIVATE_LIMITED" };
  writeDemoSession({
    draft,
    demoCase: { demoCaseId: "demo-tdr", referenceCaseId: "", company: { legalName: draft.legalName, registrationNumber: draft.registrationNumber, countryCode: "GB", countryName: "United Kingdom", ownershipType: draft.ownershipType } },
    researchResult: { status: "COMPLETE", sourceMode: "LIVE", sourceLabel: "Live Discovery", canonicalCompanyTypeLabel: "Limited liability partnership", candidateSources: [], decisionTargets: { candidateParties: [], candidateClaims: [] }, view: null, entityLabels: {} },
  });
  window.history.replaceState({}, "", DEMO_RESEARCH_PATH);
  render(<UboDemoRoot />);
  expect(await screen.findByText(/Limited liability partnership/)).toBeInTheDocument();
  expect(screen.queryByText(/Private limited company \(Ltd\)/)).not.toBeInTheDocument();
});

test("saved draft survives refresh", () => {
  const draft = { ...emptyDemoDraft(), legalName: "Restored Limited", registrationNumber: "00001234" };
  writeDemoSession({ draft, demoCase: null, researchResult: null }); renderStart();
  expect(screen.getByLabelText(/Company name/)).toHaveValue("Restored Limited"); expect(screen.getByLabelText(/Registration number/)).toHaveValue("00001234");
});
