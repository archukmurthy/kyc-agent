import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { uboStore } from "../browserStore";
jest.mock("../pocCaseClient", () => ({ ...jest.requireActual("../pocCaseClient"), persistPocCase: (...args) => mockPersist(...args) }));
import CustomerIdvPage from "./CustomerIdvPage";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";
import { CUSTOMER_COMPLETE_PATH, CUSTOMER_QUESTIONS_PATH } from "./customerRoute";
import { applyCurrentVerificationAssessment, DISCOVERY_STATE } from "./verificationAssessment";

const mockPersist = jest.fn(async () => ({ researchRelease: { mayProceed: true } }));

const demoCase = { demoCaseId: "idv-case", company: { legalName: "Customer Limited", registrationNumber: "123", countryName: "United Kingdom", ownershipType: "PRIVATE_LIMITED" } };

beforeEach(() => uboStore.clear());

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
  expect(screen.getAllByText("Alice Morgan")).toHaveLength(1);
  expect(screen.queryByText("Holding Limited")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Application information complete/i })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /^Complete identity verification$/i }));
  expect(await screen.findByText(/Demo check recorded - not verified/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Application information complete/i })).toHaveAttribute("href", CUSTOMER_COMPLETE_PATH);
  const saved = JSON.parse(uboStore.getItem(DEMO_SESSION_KEY)).researchResult.ownershipResolutionTrace;
  expect(saved.discoveryState).toBe(DISCOVERY_STATE.IDV_COMPLETE);
  expect(saved.idvCompletionHistory).toHaveLength(1);
  expect(saved.auditEvents.map(({ type }) => type)).toContain("IDENTITY_VERIFICATION_COMPLETED");
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
