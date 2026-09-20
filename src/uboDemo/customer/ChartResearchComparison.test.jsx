import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ChartResearchComparison from "./ChartResearchComparison";

const owner = { name: "Alice Morgan", entityType: "NATURAL_PERSON" };
const company = { name: "Vodafone Limited", entityType: "LEGAL_ENTITY", jurisdiction: "GB" };

beforeEach(() => {
  window.localStorage.clear();
  jest.restoreAllMocks();
});

function relationship(factId, relationshipType, measurement, referenceId) {
  return { factId, type: "RELATIONSHIP", relationship: relationshipType, subject: owner, object: company, measurement, qualifiers: { currentState: "CURRENT" }, evidenceReferences: [{ referenceId }] };
}

test("customer exact ownership inside an independent registry range renders the strong but precise verification status", () => {
  const researchResult = { candidateSources: [{ requestId: "registry-request", candidateFacts: [
    relationship("registry-owner", "ECONOMIC_OWNERSHIP", { type: "RANGE", lowerBound: 75, upperBound: 100, lowerInclusive: false, upperInclusive: true }, "companies-house-psc"),
    relationship("registry-vote", "VOTING_RIGHTS", { type: "EXACT", value: 80 }, "companies-house-voting"),
  ] }] };
  const chartFacts = [
    relationship("chart-owner", "ECONOMIC_OWNERSHIP", { type: "EXACT", value: 80 }, "customer-artifact"),
    relationship("chart-control", "FORMAL_CONTROL_RIGHT", null, "customer-artifact"),
  ];
  render(<ChartResearchComparison researchResult={researchResult} chartFacts={chartFacts} />);
  fireEvent.click(screen.getByRole("button", { name: /Compare with research/i }));
  expect(screen.getByText("Independently verified", { selector: ".ubo-customer-comparison-summary span" })).toBeInTheDocument();
  expect(screen.getByText("✓ Independently verified")).toBeInTheDocument();
  expect(screen.getByText("Verified against independent registry range")).toBeInTheDocument();
  expect(screen.getAllByText("(75%, 100%]")).toHaveLength(2);
  expect(screen.getAllByText("80%")).toHaveLength(2);
  expect(screen.getByText("Exact point independently stated by registry")).toBeInTheDocument();
  expect(screen.getByText("No")).toBeInTheDocument();
  expect(screen.queryByText(/VOTING_RIGHTS|FORMAL_CONTROL_RIGHT/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("How the parties were matched"));
  expect(screen.getAllByText("NORMALIZED_LEGAL_NAME").length).toBeGreaterThan(0);
});

test("unresolved parties use one bounded identity-only request and high-confidence AI matches become auditable comparison identities", async () => {
  const registryOwner = { name: "Northstar Parent Holdings Limited", entityType: "LEGAL_ENTITY", jurisdiction: "GB" };
  const chartOwner = { name: "Northstar Group Holdco Ltd", entityType: "LEGAL_ENTITY", jurisdiction: "GB" };
  const registryFact = { ...relationship("registry-ai", "ECONOMIC_OWNERSHIP", { type: "EXACT", value: 60 }, "registry-source"), subject: registryOwner };
  const chartFact = { ...relationship("chart-ai", "ECONOMIC_OWNERSHIP", { type: "EXACT", value: 60 }, "chart-source"), subject: chartOwner };
  jest.spyOn(global, "fetch").mockImplementation(async (_url, options) => {
    const request = JSON.parse(options.body);
    expect(request.candidates).toHaveLength(1);
    expect(request.candidates[0]).not.toHaveProperty("measurement");
    return {
      ok: true,
      async json() {
        return { success: true, result: { decisionScope: "PARTY_IDENTITY_ONLY", matches: [{ candidateId: request.candidates[0].candidateId, classification: "LIKELY_SAME_ENTITY", confidence: 0.94, reasons: ["same unique chain position and connected target"] }] } };
      },
    };
  });
  render(<ChartResearchComparison researchResult={{ candidateSources: [{ requestId: "registry", candidateFacts: [registryFact] }] }} chartFacts={[chartFact]} />);
  fireEvent.click(screen.getByRole("button", { name: /Compare with research/i }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByText("✓ Independently verified")).toBeInTheDocument());
  fireEvent.click(screen.getByText("How the parties were matched"));
  expect(screen.getByText("AI_ASSISTED")).toBeInTheDocument();
  expect(screen.getByText("94%")).toBeInTheDocument();
});

test("comparison hides sibling ownership outside the directed customer path while retaining customer ancestors", () => {
  const customer = { name: "Better Comms (VOIP) Ltd", entityType: "LEGAL_ENTITY", jurisdiction: "GB", externalIdentifiers: [{ namespace: "COMPANIES_HOUSE", value: "01234567" }] };
  const holdco = { name: "Better Holdco Limited", entityType: "LEGAL_ENTITY", jurisdiction: "GB" };
  const sibling = { name: "Better Network Services Limited", entityType: "LEGAL_ENTITY", jurisdiction: "GB" };
  const mitchell = { name: "Mitchell Fortescue", entityType: "NATURAL_PERSON", jurisdiction: "GB" };
  const ownership = (factId, subject, object, value, referenceId) => ({ factId, type: "RELATIONSHIP", relationship: "ECONOMIC_OWNERSHIP", subject, object, measurement: { type: "EXACT", value }, qualifiers: { currentState: "CURRENT" }, evidenceReferences: [{ referenceId }] });
  const registryFacts = [
    ownership("registry-person", mitchell, holdco, 75, "registry-person"),
    ownership("registry-customer", holdco, customer, 100, "registry-customer"),
  ];
  const chartFacts = [
    ownership("chart-person", mitchell, holdco, 75, "chart-person"),
    ownership("chart-customer", holdco, customer, 100, "chart-customer"),
    ownership("chart-sibling", holdco, sibling, 100, "chart-sibling"),
  ];

  render(<ChartResearchComparison
    researchResult={{ candidateSources: [{ requestId: "registry", candidateFacts: registryFacts }] }}
    chartFacts={chartFacts}
    company={{ legalName: "Better Comms (VOIP) Ltd", registrationNumber: "01234567", countryCode: "GB" }}
  />);
  fireEvent.click(screen.getByRole("button", { name: /Compare with research/i }));

  expect(screen.getAllByText("Mitchell Fortescue").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Better Holdco Limited").length).toBeGreaterThan(0);
  expect(screen.queryByText("Better Network Services Limited")).not.toBeInTheDocument();
  expect(screen.getByText(/directed paths to the customer only/i)).toBeInTheDocument();
});
