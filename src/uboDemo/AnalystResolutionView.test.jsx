import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import AnalystResolutionView from "./AnalystResolutionView";
import { applyCurrentVerificationAssessment, completeIdentityVerification } from "./customer/verificationAssessment";

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

test("Review and Audit consume the same completed verification assessment", () => {
  const assessed = applyCurrentVerificationAssessment(trace, null, { finalized: true, now: "2026-09-19T09:00:00.000Z" });
  const completed = completeIdentityVerification(assessed, "alice", "2026-09-19T09:30:00.000Z");
  const shared = { demoCase: props.demoCase, result: { ownershipResolutionTrace: completed } };
  const view = render(<AnalystResolutionView mode="REVIEW" {...shared} />);
  expect(screen.getByRole("heading", { name: "Current ownership/control assessment" })).toBeInTheDocument();
  expect(screen.getByText("1 of 1")).toBeInTheDocument();
  expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
  expect(screen.getByText(completed.verificationAssessment.assessmentVersionId)).toBeInTheDocument();
  view.unmount();
  render(<AnalystResolutionView mode="AUDIT" {...shared} />);
  expect(screen.getByRole("heading", { name: "Assessment and identity-verification history" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "identity verification completed" })).toBeInTheDocument();
});

test("a no-nominee declaration is presented as a declaration rather than an unknown ownership edge", () => {
  const nomineeDeclaration = {
    id: "resolution:nominee", comparisonItemId: "ownership-comparison:nominee-declaration", resolutionStatus: "RESOLVED_CUSTOMER_CONFIRMED", ownershipEstablishment: "ESTABLISHED_CUSTOMER_DECLARATION",
    resultingFact: { type: "ENTITY_ATTRIBUTE", attribute: "nominee_arrangement", value: false, evidenceReferences: [] },
    reason: "Customer declared that no nominee, bare-trust or similar arrangement applies.", factRequirements: [], questions: [], evidence: [],
  };
  const shared = { demoCase: props.demoCase, result: { ownershipResolutionTrace: { ...trace, ownershipFacts: [...trace.ownershipFacts, nomineeDeclaration] } } };
  const view = render(<AnalystResolutionView mode="REVIEW" {...shared} />);
  expect(screen.getByRole("heading", { name: "Ownership declarations" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Nominee arrangement for Customer Limited" })).toBeInTheDocument();
  expect(screen.getByText("No nominee arrangement declared")).toBeInTheDocument();
  expect(screen.getByText("No nominee ownership route added")).toBeInTheDocument();
  expect(screen.queryByText(/Unknown party/)).not.toBeInTheDocument();
  view.unmount();

  render(<AnalystResolutionView mode="AUDIT" {...shared} />);
  expect(screen.getByRole("heading", { name: "Nominee arrangement for Customer Limited" })).toBeInTheDocument();
  expect(screen.queryByText(/Unknown party/)).not.toBeInTheDocument();
});

// UBO-29: the analyst reopens a finalised review from this screen.
describe("reopening a finalised review", () => {
  const { fireEvent, waitFor } = require("@testing-library/react");
  const finalised = { ...trace, discoveryState: "IDV_IN_PROGRESS", verificationAssessment: { assessmentVersionId: "ubo-assessment:abc", calculatedAt: "2026-09-30T10:00:00.000Z", finalized: true, verificationPopulation: [] } };
  const reopenProps = { demoCase: { demoCaseId: "case-1", company: { legalName: "Customer Limited" } }, result: { ownershipResolutionTrace: finalised } };

  test("is offered only on a finalised review", () => {
    const { rerender } = render(<AnalystResolutionView mode="REVIEW" {...props} />);
    expect(screen.queryByRole("button", { name: /reopen/i })).toBeNull();
    rerender(<AnalystResolutionView mode="AUDIT" {...reopenProps} />);
    expect(screen.queryByRole("button", { name: /reopen/i })).toBeNull();
    rerender(<AnalystResolutionView mode="REVIEW" {...reopenProps} />);
    expect(screen.getByRole("button", { name: "Reopen review" })).toBeInTheDocument();
  });

  test("asks once more, then reopens this case and reloads it from the server", async () => {
    const reopenCase = jest.fn().mockResolvedValue(undefined);
    render(<AnalystResolutionView mode="REVIEW" {...reopenProps} reopenCase={reopenCase} />);
    fireEvent.click(screen.getByRole("button", { name: "Reopen review" }));
    expect(reopenCase).not.toHaveBeenCalled();
    expect(screen.getByText(/finalised assessment is set aside/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Yes, reopen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reopen review" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, reopen" }));
    await waitFor(() => expect(reopenCase).toHaveBeenCalledWith("case-1", "reopen:ubo-assessment:abc:2026-09-30T10:00:00.000Z"));
  });

  test("says so when the server refuses", async () => {
    const reopenCase = jest.fn().mockRejectedValue(new Error("Only the analyst can reopen a review."));
    render(<AnalystResolutionView mode="REVIEW" {...reopenProps} reopenCase={reopenCase} />);
    fireEvent.click(screen.getByRole("button", { name: "Reopen review" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, reopen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the analyst can reopen a review.");
  });
});
