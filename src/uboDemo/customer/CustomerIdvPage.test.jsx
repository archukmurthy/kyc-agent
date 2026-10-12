import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { uboStore } from "../browserStore";
import CustomerIdvPage from "./CustomerIdvPage";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";
import { CUSTOMER_QUESTIONS_PATH } from "./customerRoute";
import { applyCurrentVerificationAssessment, completeIdentityVerification, DISCOVERY_STATE } from "./verificationAssessment";
jest.mock("../pocCaseClient", () => ({ ...jest.requireActual("../pocCaseClient"), persistPocCase: (...args) => mockPersist(...args) }));

const mockPersist = jest.fn();

const demoCase = { demoCaseId: "idv-case", company: { legalName: "Customer Limited", registrationNumber: "123", countryName: "United Kingdom", ownershipType: "PRIVATE_LIMITED" } };

beforeEach(() => {
  uboStore.clear();
  mockPersist.mockReset();
  mockPersist.mockImplementation(async () => ({ researchRelease: { mayProceed: true } }));
});

function seed(trace) {
  uboStore.setItem(DEMO_SESSION_KEY, JSON.stringify({ contractVersion: DEMO_SESSION_CONTRACT, demoCase, researchResult: { ownershipResolutionTrace: trace } }));
}

test("IDV route shows each qualifying natural person once, completes dummy IDV and ignores a legal entity", async () => {
  const trace = applyCurrentVerificationAssessment({ ownershipResolution: { status: "COMPLETE" }, controlResolution: { status: "NOT_STARTED" }, questions: [], evidence: [], ownershipFacts: [], personOwnershipAssessments: [{ assessmentId: "alice", personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", determination: "DEFINITE_UBO", idvRequired: true, aggregateEffectiveOwnership: { type: "EXACT", value: "26" }, ownershipPaths: [{}, {}] }], uboAssessments: [
    { personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", idvRequired: true, bases: ["SHARE_OWNERSHIP"] },
    { personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", idvRequired: true, bases: ["VOTING_RIGHTS"] },
    { personId: "holdco", personName: "Holding Limited", partyType: "LEGAL_ENTITY", idvRequired: true },
  ], fallback: { people: [] } }, null, { finalized: true });
  seed(trace);
  render(<CustomerIdvPage />);
  expect(screen.queryByText(/Identity verification is not available on this deployment/i)).not.toBeInTheDocument();
  expect(screen.getAllByText("Alice Morgan")).toHaveLength(1);
  expect(screen.queryByText("Holding Limited")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Application information complete/i })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /^Complete identity verification$/i }));
  expect(await screen.findByText(/Identity verification completed \(demo - not verified\)/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Application information complete/i })).toBeEnabled();
  const saved = JSON.parse(uboStore.getItem(DEMO_SESSION_KEY)).researchResult.ownershipResolutionTrace;
  expect(saved.discoveryState).toBe(DISCOVERY_STATE.IDV_COMPLETE);
  expect(saved.idvCompletionHistory).toHaveLength(1);
  expect(saved.auditEvents.map(({ type }) => type)).toContain("IDENTITY_VERIFICATION_COMPLETED");
});

test("demo completion survives a page reload and final submission persists COMPLETE before navigation", async () => {
  const initial = applyCurrentVerificationAssessment({ ownershipResolution: { status: "COMPLETE" }, controlResolution: { status: "NOT_STARTED" }, questions: [], evidence: [], ownershipFacts: [], personOwnershipAssessments: [], uboAssessments: [
    { personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", idvRequired: true, bases: ["SHARE_OWNERSHIP"] },
  ], fallback: { people: [] } }, null, { finalized: true });
  let serverTrace = initial;
  mockPersist.mockImplementation(async (operation, command) => {
    if (operation === "COMPLETE_IDV") {
      serverTrace = completeIdentityVerification(serverTrace, command.payload.personId, "2026-10-12T10:00:00.000Z");
      return { projection: { currentStage: "IDV_COMPLETE", assessment: { trace: serverTrace } } };
    }
    if (operation === "SUBMIT_APPLICATION") return { projection: { currentStage: "COMPLETE", assessment: { trace: serverTrace } } };
    return {};
  });
  seed(initial);
  const first = render(<CustomerIdvPage />);
  fireEvent.click(screen.getByRole("button", { name: /^Complete identity verification$/i }));
  expect(await screen.findByText(/Identity verification completed/i)).toBeInTheDocument();
  first.unmount();
  render(<CustomerIdvPage />);
  expect(screen.getByText(/Identity verification completed/i)).toBeInTheDocument();

  const nativeSubmit = jest.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: /Application information complete/i }));
  await waitFor(() => expect(mockPersist).toHaveBeenLastCalledWith("SUBMIT_APPLICATION", expect.objectContaining({
    caseId: "idv-case", actorType: "CUSTOMER", payload: {},
  })));
  expect(nativeSubmit).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  nativeSubmit.mockRestore();
});

test("multiple demo subjects keep final submission disabled until every person is complete", async () => {
  const initial = applyCurrentVerificationAssessment({ ownershipResolution: { status: "COMPLETE" }, controlResolution: { status: "NOT_STARTED" }, questions: [], evidence: [], ownershipFacts: [], personOwnershipAssessments: [], uboAssessments: [
    { personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", idvRequired: true, bases: ["SHARE_OWNERSHIP"] },
    { personId: "jane", personName: "Jane Smith", partyType: "NATURAL_PERSON", idvRequired: true, bases: ["SHARE_OWNERSHIP"] },
  ], fallback: { people: [] } }, null, { finalized: true });
  let serverTrace = initial;
  mockPersist.mockImplementation(async (_operation, command) => {
    serverTrace = completeIdentityVerification(serverTrace, command.payload.personId);
    return { projection: { assessment: { trace: serverTrace } } };
  });
  seed(initial);
  render(<CustomerIdvPage />);
  fireEvent.click(screen.getAllByRole("button", { name: /^Complete identity verification$/i })[0]);
  await waitFor(() => expect(screen.getAllByText(/Identity verification completed/i)).toHaveLength(1));
  expect(screen.getByRole("button", { name: /Application information complete/i })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /^Complete identity verification$/i }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Application information complete/i })).toBeEnabled());
  expect(serverTrace.discoveryState).toBe(DISCOVERY_STATE.IDV_COMPLETE);
});

// The server refuses a step from a round that has ended (a reopen, a reset in
// another tab): said in plain words, and the page checks the case at once.
test("a completion refused because the review changed says so and checks the case", async () => {
  const trace = applyCurrentVerificationAssessment({ ownershipResolution: { status: "COMPLETE" }, controlResolution: { status: "NOT_STARTED" }, questions: [], evidence: [], ownershipFacts: [], personOwnershipAssessments: [], uboAssessments: [
    { personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", idvRequired: true, bases: ["SHARE_OWNERSHIP"] },
  ], fallback: { people: [] } }, null, { finalized: true });
  seed(trace);
  mockPersist.mockRejectedValueOnce(Object.assign(new Error("This review changed while you were working on it. Please reload the page to see where it stands."), { code: "case_round_changed", status: 409 }));
  window.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, state: { round: 0, finalized: true } }) }));
  render(<CustomerIdvPage />);
  fireEvent.click(screen.getByRole("button", { name: /^Complete identity verification$/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/changed while you were working on it/);
  await waitFor(() => expect(window.fetch).toHaveBeenCalledWith("/api/ubo-poc-case?caseId=idv-case&state=1", expect.anything()));
});

test("IDV route returns to questions when no final natural-person population exists", () => {
  seed({ ownershipResolution: { status: "COMPLETE" }, questions: [], evidence: [], uboAssessments: [], fallback: { outcome: "FALLBACK_SENIOR_MANAGING_OFFICIAL_REQUIRED", people: [] } });
  render(<CustomerIdvPage />);
  expect(screen.getByRole("link", { name: /Return to questions/i })).toHaveAttribute("href", CUSTOMER_QUESTIONS_PATH);
});
