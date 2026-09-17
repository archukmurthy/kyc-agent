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

test("analyst topic and custom requests share the existing customer Questions experience", () => {
  const input = props({ type: "EXACT", value: 40 }, { type: "EXACT", value: 40 });
  input.researchResult.investigationTopicActivations = [{ id: "topic-voting", caseId: "case-questions", topicCode: "VOTING_RIGHTS", origin: "ANALYST", status: "ACTIVE", createdAt: "2026-09-17T10:00:00.000Z" }];
  input.researchResult.analystCustomerRequests = [{ requestId: "custom-trust-detail", title: "Specific trust detail", question: "Please explain the unusual trust arrangement." }];
  render(<OwnershipResolutionQuestions {...input} />);
  expect(screen.getByRole("heading", { name: /Does any individual have significant voting rights/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Please explain the unusual trust arrangement." })).toBeInTheDocument();
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
  await waitFor(() => expect(within(container.querySelector(".ubo-resolution-question-groups")).queryByText(/What percentage of Target Limited does Alice Morgan currently own/i)).not.toBeInTheDocument());
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

test("start questions again clears saved answers and restores the initial journey", async () => {
  render(<OwnershipResolutionQuestions {...props({ type: "RANGE", lowerBound: 10, upperBound: 40, lowerInclusive: true, upperInclusive: true }, { type: "UNKNOWN" })} />);
  fireEvent.change(screen.getByLabelText("Ownership percentage"), { target: { value: "18" } });
  fireEvent.click(screen.getAllByRole("button", { name: /Save answer/i })[0]);
  await waitFor(() => expect(screen.getByText("18%")).toBeInTheDocument());
  expect(window.localStorage.length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("button", { name: "Start questions again" }));

  expect(screen.queryByRole("heading", { name: "Answered questions" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /What percentage of Target Limited does Alice Morgan currently own/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /hold shares or ownership rights on behalf/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start questions again" })).toBeDisabled();
});

test("questions and evidence identify the company and related ownership issue", () => {
  render(<OwnershipResolutionQuestions {...props({ type: "EXACT", value: 60 }, { type: "EXACT", value: 20 })} />);
  expect(screen.getByRole("heading", { level: 3, name: "Alice Morgan → Target Limited" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 3, name: "Nominee arrangement for Target Limited" })).toBeInTheDocument();

  const discrepancyQuestion = screen.getByRole("heading", { name: /Has the company's ownership changed/i }).closest("article");
  fireEvent.click(within(discrepancyQuestion).getByLabelText(/existing shares were transferred/i));
  fireEvent.click(within(discrepancyQuestion).getByRole("button", { name: /Save answer/i }));

  const evidence = screen.getByText(/Establish the current shareholding after the reported share transfer/i).closest("article");
  expect(within(evidence).getByText("Target Limited")).toBeInTheDocument();
  expect(within(evidence).getByText("Alice Morgan")).toBeInTheDocument();
  const issueGroup = screen.getByRole("heading", { level: 3, name: "Alice Morgan → Target Limited" }).closest("section");
  expect(within(issueGroup).getByText(/Establish the current shareholding after the reported share transfer/i)).toBeInTheDocument();
});

test("web-sourced ownership assertions do not create customer resolution questions", () => {
  const webOwner = { name: "Public Market Investor", entityType: "LEGAL_ENTITY", jurisdiction: "GB" };
  const webFact = {
    ...ownership("web-fact", { type: "UNKNOWN" }, "WEB:TARGET LIMITED:0"),
    subject: webOwner,
  };
  const input = props({ type: "EXACT", value: 40 }, { type: "EXACT", value: 40 });
  input.researchResult.candidateSources[0].candidateFacts.push(webFact);
  render(<OwnershipResolutionQuestions {...input} />);

  expect(screen.queryByText(/What percentage of Target Limited does Public Market Investor currently own/i)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /hold shares or ownership rights on behalf/i })).toBeInTheDocument();
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

test("a media mismatch explains the format problem and keeps re-upload available", async () => {
  const { container } = render(<OwnershipResolutionQuestions {...props({ type: "EXACT", value: 60 }, { type: "EXACT", value: 20 })} />);
  const discrepancyQuestion = screen.getByRole("heading", { name: /Has the company's ownership changed/i }).closest("article");
  fireEvent.click(within(discrepancyQuestion).getByLabelText(/existing shares were transferred/i));
  fireEvent.click(within(discrepancyQuestion).getByRole("button", { name: /Save answer/i }));
  window.fetch.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ success: false, code: "invalid_media", message: "Artifact bytes do not match the declared media type" }),
  });

  const evidence = screen.getByText(/Establish the current shareholding after the reported share transfer/i).closest("article");
  const fileInput = container.querySelector('.ubo-resolution-evidence input[type="file"]');
  fireEvent.change(fileInput, { target: { files: [new File(["not-png"], "evidence.png", { type: "image/png" })] } });

  await waitFor(() => expect(within(evidence).getByText(/contents do not match that format/i)).toBeInTheDocument());
  expect(within(evidence).getByRole("button", { name: "Choose another file" })).toBeInTheDocument();
  expect(within(evidence).getByText(/Accepted file formats: PDF, PNG or JPEG/i)).toBeInTheDocument();
});

test("accepted evidence remains visible with its filename and an inline preview", async () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => "blob:accepted-evidence");
  URL.revokeObjectURL = jest.fn();
  try {
    const { container } = render(<OwnershipResolutionQuestions {...props({ type: "EXACT", value: 60 }, { type: "EXACT", value: 20 })} />);
    const discrepancyQuestion = screen.getByRole("heading", { name: /Has the company's ownership changed/i }).closest("article");
    fireEvent.click(within(discrepancyQuestion).getByLabelText(/existing shares were transferred/i));
    fireEvent.click(within(discrepancyQuestion).getByRole("button", { name: /Save answer/i }));

    const effectiveDate = screen.getByLabelText("Effective date").closest("article");
    fireEvent.change(within(effectiveDate).getByLabelText("Effective date"), { target: { value: "2026-09-01" } });
    fireEvent.click(within(effectiveDate).getByRole("button", { name: /Save answer/i }));
    const percentage = screen.getByLabelText("Ownership percentage").closest("article");
    fireEvent.change(within(percentage).getByLabelText("Ownership percentage"), { target: { value: "30" } });
    fireEvent.click(within(percentage).getByRole("button", { name: /Save answer/i }));
    await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(1));

    const fileInput = container.querySelector('.ubo-resolution-evidence input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [new File(["%PDF-1.4\n%%EOF"], "current-register.pdf", { type: "application/pdf" })] } });

    await waitFor(() => expect(screen.getByText("File received · evidence accepted")).toBeInTheDocument());
    const acceptedEvidence = screen.getByText("current-register.pdf").closest("article");
    expect(within(acceptedEvidence).getByText("satisfied")).toBeInTheDocument();
    expect(within(acceptedEvidence).getByText(/passed the existing Evidence staging/i)).toBeInTheDocument();
    expect(within(acceptedEvidence).getByText("View uploaded document")).toBeInTheDocument();
    fireEvent.click(within(acceptedEvidence).getByText("View uploaded document"));
    expect(within(acceptedEvidence).getByTitle("Preview of current-register.pdf")).toHaveAttribute("src", "blob:accepted-evidence");
    expect(screen.getByText(/Supporting evidence has been accepted and remains visible below/i)).toBeInTheDocument();
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test("a provider outage keeps the received filename and permits retrying the same file", async () => {
  const { container } = render(<OwnershipResolutionQuestions {...props({ type: "EXACT", value: 40 }, { type: "EXACT", value: 40 })} />);
  const declaration = screen.getByRole("heading", { name: /hold shares or ownership rights on behalf/i }).closest("article");
  fireEvent.click(within(declaration).getByLabelText("Yes"));
  fireEvent.click(within(declaration).getByRole("button", { name: /Save answer/i }));
  window.fetch.mockResolvedValueOnce({
    ok: false,
    status: 502,
    json: async () => ({ success: false, code: "provider_unavailable", message: "We could not analyse this ownership chart. Please try again." }),
  });

  const evidence = screen.getByText(/Establish the declared nominee or bare-trust arrangement/i).closest("article");
  const fileInput = container.querySelector('.ubo-resolution-evidence input[type="file"]');
  fireEvent.change(fileInput, { target: { files: [new File(["%PDF-1.4\n%%EOF"], "nominee-agreement.pdf", { type: "application/pdf" })] } });

  await waitFor(() => expect(within(evidence).getByText("analysis unavailable")).toBeInTheDocument());
  expect(within(evidence).getByText("nominee-agreement.pdf")).toBeInTheDocument();
  expect(within(evidence).getByText(/File received · analysis not completed/i)).toBeInTheDocument();
  expect(within(evidence).getByText(/file itself was not rejected/i)).toBeInTheDocument();
  fireEvent.click(within(evidence).getByRole("button", { name: "Retry analysis" }));
  await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(2));
});

test("nominee evidence stays with its issue after all follow-up questions are answered", async () => {
  render(<OwnershipResolutionQuestions {...props({ type: "EXACT", value: 40 }, { type: "EXACT", value: 40 })} />);
  const declaration = screen.getByRole("heading", { name: /hold shares or ownership rights on behalf/i }).closest("article");
  fireEvent.click(within(declaration).getByLabelText("Yes"));
  fireEvent.click(within(declaration).getByRole("button", { name: /Save answer/i }));

  let group = screen.getByRole("heading", { level: 3, name: "Nominee arrangement for Target Limited" }).closest("section");
  expect(within(group).getByText(/Establish the declared nominee or bare-trust arrangement/i)).toBeInTheDocument();
  const registeredHolder = within(group).getByRole("heading", { name: /Who holds the shares or ownership rights on record/i }).closest("article");
  fireEvent.change(within(registeredHolder).getByLabelText("Your answer"), { target: { value: "Registered Holder Limited" } });
  fireEvent.click(within(registeredHolder).getByRole("button", { name: /Save answer/i }));
  group = screen.getByRole("heading", { level: 3, name: "Nominee arrangement for Target Limited" }).closest("section");
  const underlyingOwner = within(group).getByRole("heading", { name: /For whom are those shares or ownership rights held/i }).closest("article");
  fireEvent.change(within(underlyingOwner).getByLabelText("Your answer"), { target: { value: "Underlying Owner Limited" } });
  fireEvent.click(within(underlyingOwner).getByRole("button", { name: /Save answer/i }));
  group = screen.getByRole("heading", { level: 3, name: "Nominee arrangement for Target Limited" }).closest("section");
  const interest = within(group).getByRole("heading", { name: /What percentage or ownership interest is held under this arrangement/i }).closest("article");
  fireEvent.change(within(interest).getByLabelText("Ownership percentage"), { target: { value: "30" } });
  fireEvent.click(within(interest).getByRole("button", { name: /Save answer/i }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "1 supporting evidence request remaining" })).toBeInTheDocument());
  group = screen.getByRole("heading", { level: 3, name: "Nominee arrangement for Target Limited" }).closest("section");
  expect(within(group).getByText(/All questions for this issue are answered/i)).toBeInTheDocument();
  expect(within(group).getByRole("button", { name: "Choose supporting evidence" })).toBeInTheDocument();
  expect(within(group).getByText(/remains unresolved until supporting evidence passes/i)).toBeInTheDocument();
});
