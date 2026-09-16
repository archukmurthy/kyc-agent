import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import ChartResearchComparison from "./ChartResearchComparison";

const owner = { name: "Alice Morgan", entityType: "NATURAL_PERSON" };
const company = { name: "Vodafone Limited", entityType: "LEGAL_ENTITY", jurisdiction: "GB" };

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
});
