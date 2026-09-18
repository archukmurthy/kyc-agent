import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import CustomerIdvPage from "./CustomerIdvPage";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";
import { CUSTOMER_COMPLETE_PATH, CUSTOMER_QUESTIONS_PATH } from "./customerRoute";

const demoCase = { demoCaseId: "idv-case", company: { legalName: "Customer Limited", registrationNumber: "123", countryName: "United Kingdom", ownershipType: "PRIVATE_LIMITED" } };

beforeEach(() => window.localStorage.clear());

function seed(trace) {
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({ contractVersion: DEMO_SESSION_CONTRACT, demoCase, researchResult: { ownershipResolutionTrace: trace } }));
}

test("IDV route shows each qualifying natural person once and ignores a legal entity", () => {
  seed({ ownershipResolution: { status: "COMPLETE" }, questions: [], evidence: [], uboAssessments: [
    { personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", idvRequired: true, bases: ["SHARE_OWNERSHIP"] },
    { personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", idvRequired: true, bases: ["VOTING_RIGHTS"] },
    { personId: "holdco", personName: "Holding Limited", partyType: "LEGAL_ENTITY", idvRequired: true },
  ], fallback: { people: [] } });
  render(<CustomerIdvPage />);
  expect(screen.getAllByText("Alice Morgan")).toHaveLength(1);
  expect(screen.queryByText("Holding Limited")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Complete review/i })).toHaveAttribute("href", CUSTOMER_COMPLETE_PATH);
});

test("IDV route returns to questions when no final natural-person population exists", () => {
  seed({ ownershipResolution: { status: "COMPLETE" }, questions: [], evidence: [], uboAssessments: [], fallback: { outcome: "FALLBACK_SENIOR_MANAGING_OFFICIAL_REQUIRED", people: [] } });
  render(<CustomerIdvPage />);
  expect(screen.getByRole("link", { name: /Return to questions/i })).toHaveAttribute("href", CUSTOMER_QUESTIONS_PATH);
});
