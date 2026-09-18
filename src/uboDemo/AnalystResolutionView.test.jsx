import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import AnalystResolutionView from "./AnalystResolutionView";

const trace = {
  ownershipResolution: { status: "COMPLETE" },
  controlResolution: { status: "NOT_STARTED" },
  fallback: { outcome: null },
  uboAssessments: [{ personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", idvRequired: true }],
  ownershipFacts: [{
    id: "resolution:holdco", comparisonItemId: "holdco", holderPartyType: "LEGAL_ENTITY", resolutionStatus: "RESOLVED_INDEPENDENTLY_VERIFIED", ownershipEstablishment: "ESTABLISHED_INDEPENDENTLY_VERIFIED", reason: "Registry range corroborates the chart.",
    customerAssertion: { subject: { name: "Holding Limited" }, object: { name: "Customer Limited" }, measurement: { type: "EXACT", value: 80 } },
    independentAssertion: { subject: { name: "Holding Limited" }, object: { name: "Customer Limited" }, measurement: { type: "RANGE", lowerBound: 75, upperBound: 100 } },
    originalComparison: { status: "INDEPENDENTLY_VERIFIED", detail: "Within range" },
    ownershipLink: { outcome: "OWNERSHIP_THRESHOLD_EXCEEDED" }, uboImpact: { determination: null, idvRequired: false }, factRequirements: [], questions: [], evidence: [],
  }],
  personOwnershipAssessments: [{
    assessmentId: "person-ownership-assessment:alice", personId: "alice", personName: "Alice Morgan", partyType: "NATURAL_PERSON", determination: "DEFINITE_UBO", idvRequired: true,
    aggregateEffectiveOwnership: { type: "EXACT", value: "26" }, threshold: { comparator: ">", value: 25 }, policyId: "UK_UBO_POLICY", policyVersion: "1", ownershipPaths: [
      { pathId: "direct", route: "Alice Morgan → Customer Limited", relationshipIds: ["direct-10"], directOwnership: { type: "EXACT", value: 10 }, downstreamOwnership: [], effectiveOwnership: { type: "EXACT", value: 10 } },
      { pathId: "indirect", route: "Alice Morgan → Holding Limited → Customer Limited", relationshipIds: ["alice-holdco", "holdco-customer"], directOwnership: { type: "EXACT", value: 20 }, downstreamOwnership: [{ type: "EXACT", value: 80 }], effectiveOwnership: { type: "EXACT", value: 16 } },
    ],
  }],
  auditTrail: { ownershipRoutesAssessed: ["DIRECT_OWNERSHIP", "INDIRECT_OWNERSHIP"], controlRoutesAssessed: [], fallbackReason: null },
};
const props = { demoCase: { company: { legalName: "Customer Limited" } }, result: { ownershipResolutionTrace: trace } };

test("Analyst Review presents human-readable relationship and aggregate conclusions", () => {
  render(<AnalystResolutionView mode="REVIEW" {...props} />);
  expect(screen.getByRole("heading", { name: "Assessment Details" })).toBeInTheDocument();
  expect(screen.getAllByText("Continue through ownership chain").length).toBeGreaterThan(0);
  expect(screen.getByText("Not applicable — legal entity")).toBeInTheDocument();
  expect(screen.getByText("26%")).toBeInTheDocument();
  expect(screen.getByText("UBO identified")).toBeInTheDocument();
});

test("Audit separates ownership facts from natural-person aggregate assessments", () => {
  render(<AnalystResolutionView mode="AUDIT" {...props} />);
  expect(screen.getByRole("heading", { name: "Analyst reasoning and traceability" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /A\. Ownership facts and paths/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /B\. Natural-person UBO assessments/i })).toBeInTheDocument();
  expect(screen.getByText("INDEPENDENTLY_VERIFIED · Within range")).toBeInTheDocument();
  expect(screen.getByText("DEFINITE_UBO")).toBeInTheDocument();
  expect(screen.getByText(/20%/)).toBeInTheDocument();
  expect(screen.getAllByText(/80%/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/16%/).length).toBeGreaterThan(0);
});
