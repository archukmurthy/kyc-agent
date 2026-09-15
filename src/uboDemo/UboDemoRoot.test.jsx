import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import UboDemoRoot from "./UboDemoRoot";
import { buildResearchRequest, executableCustomerBundles, formatMeasurement, relationshipCategory } from "./demoResearch";
import { DEMO_RESEARCH_PATH, DEMO_START_PATH, isUboDemoPath } from "./demoRoute";
import { DEMO_SESSION_KEY, OWNERSHIP_TYPES, emptyDemoDraft, writeDemoSession } from "./demoSession";

const fact = { factId: "fact-1", type: "RELATIONSHIP", relationship: "ECONOMIC_OWNERSHIP", subject: { name: "Owner Ltd" }, object: { name: "Target Ltd" }, measurement: { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true }, qualifiers: { currentState: "CURRENT" }, evidenceReferences: [{ referenceId: "CH-PSC-1" }] };
const projection = { contractVersion: "ubo-ownership-graph-projection-v2", projectionId: "graph-1", subjectEntityId: "target", nodes: [], relationships: [] };
const evaluatedSession = { sourceLabel: "Fixture", candidateSources: [{ sourceRecordId: "source-1", sourceState: "FIXTURE", candidateFacts: [fact] }], decisionTargets: { candidateParties: [], candidateClaims: [] }, snapshots: [{ view: { graph: projection, journeyProjection: { customerWorkBundles: [{ bundleId: "open", state: "OPEN", canonicalSubject: { name: "Owner Ltd" }, permittedSemanticActions: [{ actionType: "PROVIDE_STRUCTURED_INFORMATION", executable: true }] }, { bundleId: "blocked", state: "SIGNOFF_REQUIRED", permittedSemanticActions: [{ actionType: "REQUEST_EXTERNAL_EVIDENCE", executable: false }] }], internalReview: { actions: [], requirements: [{ reasonCode: "REVIEW" }] } } } }] };

function okJson(value) { return Promise.resolve({ ok: true, json: () => Promise.resolve(value) }); }
function renderStart() { window.history.replaceState({}, "", DEMO_START_PATH); return render(<UboDemoRoot />); }
function completeRequiredFields({ name = "Acme Holdings Limited", number = "00445790" } = {}) { fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: name } }); fireEvent.change(screen.getByLabelText(/Registration number/), { target: { value: number } }); }

beforeEach(() => { window.localStorage.clear(); window.history.replaceState({}, "", "/"); window.fetch = jest.fn(() => okJson(evaluatedSession)); });
afterEach(() => { window.localStorage.clear(); jest.restoreAllMocks(); });

test("new demo route loads and existing Lab route remains separate", () => { renderStart(); expect(screen.getByRole("heading", { name: /research your company/i })).toBeInTheDocument(); expect(isUboDemoPath("/ubo-demo/")).toBe(true); expect(isUboDemoPath("/ubo-control-lab/")).toBe(false); });
test("country and ownership type use approved defaults", () => { renderStart(); expect(screen.getByLabelText(/Country of registration/)).toHaveValue("GB"); expect(screen.getByLabelText(/Ownership type/)).toHaveValue("PRIVATE_LIMITED"); });
test("required fields are validated and case reference stays optional", () => { renderStart(); fireEvent.click(screen.getByRole("button", { name: /Start research/ })); expect(screen.getByText("Enter the registered company name.")).toBeInTheDocument(); expect(screen.getByText("Enter the company registration number.")).toBeInTheDocument(); });
test("ownership options map to stable semantic codes", () => { expect(OWNERSHIP_TYPES.map(({ code }) => code)).toEqual(["PRIVATE_LIMITED", "PUBLIC_LIMITED", "PUBLICLY_LISTED", "LLP", "PARTNERSHIP", "CHARITY", "TRUST", "CIC", "OTHER"]); });

test("Start research invokes the existing live Lab composition and preserves a leading zero", async () => {
  renderStart(); completeRequiredFields({ number: "0012AB34" }); fireEvent.click(screen.getByRole("button", { name: /Start research/ }));
  expect(window.location.pathname).toBe(DEMO_RESEARCH_PATH);
  await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(1));
  const body = JSON.parse(window.fetch.mock.calls[0][1].body);
  expect(body).toEqual(expect.objectContaining({ operation: "START_REVIEW_LIVE", payload: expect.objectContaining({ companyContext: expect.objectContaining({ legalEntityName: "Acme Holdings Limited", registrationNumber: "0012AB34", jurisdiction: "GB" }) }) }));
  await screen.findByRole("heading", { name: "Ownership structure" });
  expect(JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY)).demoCase.company.registrationNumber).toBe("0012AB34");
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
  expect(screen.getByText(/Provide the missing ownership information/)).toBeInTheDocument();
  expect(screen.queryByText(/Provide supporting ownership evidence/)).not.toBeInTheDocument();
  expect(screen.getByText(/Internal review is still in progress/)).toBeInTheDocument();
});

test("live candidate assertions are not auto-adjudicated and expose no invented questions", async () => {
  window.fetch = jest.fn(() => okJson({ candidateSources: evaluatedSession.candidateSources, decisionTargets: { candidateParties: [{ candidatePartyKey: "p" }], candidateClaims: [{ claimId: "c" }] }, snapshots: [] }));
  renderStart(); completeRequiredFields(); fireEvent.click(screen.getByRole("button", { name: /Start research/ }));
  expect(await screen.findByRole("heading", { name: /Explicit review is required/ })).toBeInTheDocument();
  expect(screen.getByText(/2 candidate identity or claim decisions remain/)).toBeInTheDocument();
  expect(screen.getByText("No questions for you right now.")).toBeInTheDocument();
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
  expect(buildResearchRequest({ demoCase: { company: { legalName: "A", registrationNumber: "0001", countryCode: "GB", ownershipType: "PRIVATE_LIMITED" } }, sourceMode: "LIVE" }).operation).toBe("START_REVIEW_LIVE");
  expect(buildResearchRequest({ sourceMode: "REPLAY", replayRecord: { replayId: "saved-1" } })).toEqual({ operation: "START_REVIEW_REPLAY", payload: { replayRecord: { replayId: "saved-1" }, profileId: "NOT_PROVIDED" } });
});

test("saved draft survives refresh", () => {
  const draft = { ...emptyDemoDraft(), legalName: "Restored Limited", registrationNumber: "00001234" };
  writeDemoSession({ draft, demoCase: null, researchResult: null }); renderStart();
  expect(screen.getByLabelText(/Company name/)).toHaveValue("Restored Limited"); expect(screen.getByLabelText(/Registration number/)).toHaveValue("00001234");
});
