import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import OwnershipResolutionQuestions from "./OwnershipResolutionQuestions";

const context = {
  demoCaseId: "case-questions",
  referenceCaseId: "CASE-Q1",
  company: { legalName: "Target Limited", registrationNumber: "00112233", countryCode: "GB" },
};
const alice = { name: "Alice Morgan", entityType: "NATURAL_PERSON", jurisdiction: "GB" };
const target = { name: "Target Limited", entityType: "LEGAL_ENTITY", jurisdiction: "GB", externalIdentifiers: [{ namespace: "COMPANIES_HOUSE", value: "00112233" }] };
function ownership(factId, measurement, referenceId) {
  return { factId, type: "RELATIONSHIP", relationship: "ECONOMIC_OWNERSHIP", subject: alice, object: target, measurement, qualifiers: { currentState: "CURRENT" }, evidenceReferences: [{ referenceId }] };
}
function props(researchMeasurement, chartMeasurement) {
  return {
    context,
    company: context.company,
    researchResult: { candidateSources: [{ requestId: "registry-request", candidateFacts: [ownership("registry-fact", researchMeasurement, "registry-ref")] }] },
    result: {
      contractVersion: "ubo-demo-customer-ownership-chart-result-v1",
      company: context.company,
      artifact: { artifactId: "chart-artifact", capturedAt: "2026-09-17T09:00:00.000Z", integrityVerified: true },
      ubo: { operationEvidenceReferences: [], issues: [] },
      candidateFacts: [ownership("chart-fact", chartMeasurement, "chart-ref")],
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.fetch = jest.fn(async (_url, request) => {
    const body = JSON.parse(request.body);
    return {
      ok: true,
      json: async () => ({ success: true, result: {
        ...body.savedResult,
        artifact: { ...body.savedResult?.artifact, integrityVerified: true },
        candidateFacts: body.savedResult?.candidateFacts || [ownership("evidence-fact", { type: "EXACT", value: 30 }, "evidence-ref")],
        chartAnalysis: {
          entityLabels: { "person-alice": "Alice Morgan" },
          view: { qualifications: [{ personEntityId: "person-alice", routeStatus: "NOT_SATISFIED" }] },
        },
      } }),
    };
  });
});

afterEach(() => jest.restoreAllMocks());

test("verified ownership creates no percentage or mismatch question", () => {
  render(<OwnershipResolutionQuestions {...props({ type: "EXACT", value: 40 }, { type: "EXACT", value: 40 })} />);
  expect(screen.queryByText(/What percentage of Target Limited/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Has the company's ownership changed/i)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /hold shares or ownership rights on behalf/i })).toBeInTheDocument();
});

test("an unknown percentage is answered, re-evaluated by the existing endpoint and removed from the open list", async () => {
  const { container } = render(<OwnershipResolutionQuestions {...props({ type: "RANGE", lowerBound: 10, upperBound: 40, lowerInclusive: true, upperInclusive: true }, { type: "UNKNOWN" })} />);
  expect(screen.getByText(/What percentage of Target Limited does Alice Morgan currently own/i)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Ownership percentage"), { target: { value: "18" } });
  fireEvent.click(screen.getAllByRole("button", { name: /Save answer/i })[0]);

  await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(1));
  const request = JSON.parse(window.fetch.mock.calls[0][1].body);
  expect(request.operation).toBe("REEVALUATE_SAVED_EXTRACTION");
  expect(request.savedResult.candidateFacts[0].measurement).toEqual({ type: "EXACT", value: 18 });
  await waitFor(() => expect(within(container.querySelector(".ubo-resolution-question-list")).queryByText(/What percentage of Target Limited does Alice Morgan currently own/i)).not.toBeInTheDocument());
  expect(screen.getByRole("heading", { name: "Answered questions" })).toBeInTheDocument();
  expect(screen.getByText("18%")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /hold shares or ownership rights on behalf/i })).toBeInTheDocument();
  expect(screen.getByText(/DEFINITE_NON_UBO · Identity verification not required/i)).toBeInTheDocument();
});

test("an answered question can be edited without hiding an unanswered sibling", async () => {
  render(<OwnershipResolutionQuestions {...props({ type: "RANGE", lowerBound: 10, upperBound: 40, lowerInclusive: true, upperInclusive: true }, { type: "UNKNOWN" })} />);
  fireEvent.change(screen.getByLabelText("Ownership percentage"), { target: { value: "18" } });
  fireEvent.click(screen.getAllByRole("button", { name: /Save answer/i })[0]);
  await waitFor(() => expect(screen.getByText("18%")).toBeInTheDocument());

  const nomineeQuestion = screen.getByRole("heading", { name: /hold shares or ownership rights on behalf/i });
  expect(nomineeQuestion).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit answer" }));
  expect(screen.getByDisplayValue("18")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Ownership percentage"), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: /Save change/i }));

  await waitFor(() => expect(screen.getByText("30%")).toBeInTheDocument());
  expect(screen.getByRole("heading", { name: /hold shares or ownership rights on behalf/i })).toBeInTheDocument();
  await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(2));
});

test("a discrepancy asks for its cause before showing transfer-specific questions and evidence", () => {
  render(<OwnershipResolutionQuestions {...props({ type: "EXACT", value: 60 }, { type: "EXACT", value: 20 })} />);
  expect(screen.getByRole("heading", { name: /Has the company's ownership changed/i })).toBeInTheDocument();
  expect(screen.queryByText(/When did this ownership change take effect/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Supporting evidence/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText(/existing shares were transferred/i));
  fireEvent.click(screen.getAllByRole("button", { name: /Save answer/i })[0]);

  expect(screen.getByText(/When did this ownership change take effect/i)).toBeInTheDocument();
  expect(screen.getByText(/What percentage of Target Limited does Alice Morgan currently own/i)).toBeInTheDocument();
  expect(screen.getByText(/Establish the current shareholding after the reported share transfer/i)).toBeInTheDocument();
  expect(screen.getByText(/existing Evidence staging, extraction and validation path/i)).toBeInTheDocument();
});

test("an uncertain explanation routes to analyst review and creates no evidence request", () => {
  render(<OwnershipResolutionQuestions {...props({ type: "EXACT", value: 60 }, { type: "EXACT", value: 20 })} />);
  const discrepancyQuestion = screen.getByRole("heading", { name: /Has the company's ownership changed/i }).closest("article");
  fireEvent.click(within(discrepancyQuestion).getByLabelText("I'm not sure"));
  fireEvent.click(within(discrepancyQuestion).getByRole("button", { name: /Save answer/i }));
  expect(screen.getByText("Analyst review required")).toBeInTheDocument();
  expect(screen.queryByText(/Choose supporting evidence/i)).not.toBeInTheDocument();
});
