import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import CustomerQuestionsPage from "./CustomerQuestionsPage";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";
import { readCustomerDemoContext, writeCustomerOwnershipChartSession } from "./customerOwnershipChartSession";
import { CUSTOMER_OWNERSHIP_CHART_PATH, CUSTOMER_QUESTIONS_PATH, isCustomerQuestionsPath } from "./customerRoute";

const company = { legalName: "Target Limited", registrationNumber: "00112233", countryCode: "GB", countryName: "United Kingdom", ownershipType: "PRIVATE_LIMITED" };
const alice = { name: "Alice Morgan", entityType: "NATURAL_PERSON", jurisdiction: "GB" };
const target = { name: "Target Limited", entityType: "LEGAL_ENTITY", jurisdiction: "GB", externalIdentifiers: [{ namespace: "COMPANIES_HOUSE", value: "00112233" }] };
const ownership = (factId, referenceId) => ({ factId, type: "RELATIONSHIP", relationship: "ECONOMIC_OWNERSHIP", subject: alice, object: target, measurement: { type: "EXACT", value: 40 }, qualifiers: { currentState: "CURRENT" }, evidenceReferences: [{ referenceId }] });
const researchResult = { candidateSources: [{ requestId: "registry-request", candidateFacts: [ownership("registry-fact", "registry-ref")] }] };
const chartResult = {
  contractVersion: "ubo-demo-customer-ownership-chart-result-v1",
  company,
  artifact: { artifactId: "chart-artifact", originalFilename: "ownership-chart.pdf", capturedAt: "2026-09-18T09:00:00.000Z", integrityVerified: true },
  ubo: { operationEvidenceReferences: [], issues: [] },
  candidateFacts: [ownership("chart-fact", "chart-ref")],
};

function seedContext() {
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({
    contractVersion: DEMO_SESSION_CONTRACT,
    draft: {},
    demoCase: { demoCaseId: "questions-case", referenceCaseId: "CASE-Q1", company },
    researchResult,
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", CUSTOMER_QUESTIONS_PATH);
});

test("the third customer step restores the processed chart into the existing questions engine", () => {
  seedContext();
  const context = readCustomerDemoContext();
  writeCustomerOwnershipChartSession({ context, result: chartResult });
  render(<CustomerQuestionsPage />);

  expect(isCustomerQuestionsPath(window.location.pathname)).toBe(true);
  expect(screen.getByText("Questions").closest("li")).toHaveClass("current");
  expect(screen.getByText("Ownership").closest("li")).toHaveClass("complete");
  expect(screen.getByRole("heading", { name: /Resolve the remaining ownership and control questions/i })).toBeInTheDocument();
  expect(screen.getByText("Questions & resolution")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /hold shares or ownership rights on behalf/i })).toBeInTheDocument();
  expect(screen.queryByText(/Analyst reasoning and traceability/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Assessment details/i)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Back to ownership chart/i })).toHaveAttribute("href", CUSTOMER_OWNERSHIP_CHART_PATH);
});

test("the questions route sends a customer without a processed chart back to ownership", () => {
  seedContext();
  render(<CustomerQuestionsPage />);
  expect(screen.getByRole("heading", { name: /Complete the ownership step first/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Go to ownership/i })).toHaveAttribute("href", CUSTOMER_OWNERSHIP_CHART_PATH);
});

test("the questions route fails closed without company context", () => {
  render(<CustomerQuestionsPage />);
  expect(screen.getByRole("heading", { name: /Start with a demo company/i })).toBeInTheDocument();
});
