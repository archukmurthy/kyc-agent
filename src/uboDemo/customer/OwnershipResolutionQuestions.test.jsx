import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { uboStore } from "../browserStore";
const mockPersistDefault = async () => ({ researchRelease: { mayProceed: true } });
let mockPersist = mockPersistDefault;
jest.mock("../pocCaseClient", () => ({ ...jest.requireActual("../pocCaseClient"), persistPocCase: (...args) => mockPersist(...args) }));
import OwnershipResolutionQuestions from "./OwnershipResolutionQuestions";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";
import { DISCOVERY_STATE } from "./verificationAssessment";

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

function qualifyingChartAnalysis() {
  return {
    entityLabels: { alice: "Alice Morgan", target: "Target Limited" },
    view: {
      graph: { nodes: [{ entityId: "alice", primaryName: "Alice Morgan", category: "NATURAL_PERSON" }, { entityId: "target", primaryName: "Target Limited", category: "LEGAL_ENTITY" }], relationships: [{ relationshipId: "chart-fact", subjectEntityId: "alice", objectEntityId: "target", measurement: { type: "EXACT", value: 40 } }] },
      qualifications: [{ personEntityId: "alice", routeStatus: "ROUTE_SATISFIED" }],
      qualificationBases: [{ personEntityId: "alice", route: "EFFECTIVE_INTEREST", dimension: "ECONOMIC", assessmentState: "SATISFIED", policyId: "UK_UBO_POLICY", policyVersion: "1", threshold: { comparator: ">", value: 25 }, recordedCalculation: { value: { type: "EXACT", value: "40" } }, orderedPathReferences: [{ pathId: "alice-direct", relationshipIds: ["chart-fact"], contribution: { type: "EXACT", value: "40" } }] }],
    },
  };
}

beforeEach(() => {
  uboStore.clear();
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

afterEach(() => { jest.restoreAllMocks(); mockPersist = mockPersistDefault; });

test("verified ownership creates no customer question and keeps analyst assessment details off the customer page", () => {
  render(<OwnershipResolutionQuestions {...props({ type: "EXACT", value: 40 }, { type: "EXACT", value: 40 })} />);
  expect(screen.queryByText(/What percentage of Target Limited/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Has the company's ownership changed/i)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /hold shares or ownership rights on behalf/i })).toBeInTheDocument();
  expect(screen.queryByText("How we reached the ownership results")).not.toBeInTheDocument();
  expect(screen.queryByText(/Analyst reasoning and traceability/i)).not.toBeInTheDocument();
});

test("Continue stays disabled until discovery is ready and finalizes the shared verification assessment", async () => {
  const input = props({ type: "EXACT", value: 40 }, { type: "EXACT", value: 40 });
  input.result.chartAnalysis = qualifyingChartAnalysis();
  uboStore.setItem(DEMO_SESSION_KEY, JSON.stringify({ contractVersion: DEMO_SESSION_CONTRACT, demoCase: { demoCaseId: context.demoCaseId, company: context.company }, researchResult: input.researchResult }));
  render(<OwnershipResolutionQuestions {...input} />);
  const continueButton = screen.getByRole("button", { name: /Continue to identity verification/i });
  expect(continueButton).toBeDisabled();
  const nominee = screen.getByRole("heading", { name: /hold shares or ownership rights on behalf/i }).closest("article");
  fireEvent.click(within(nominee).getByLabelText("No"));
  fireEvent.click(within(nominee).getByRole("button", { name: /Save answer/i }));
  await waitFor(() => expect(continueButton).toBeEnabled());
  fireEvent.submit(continueButton.closest("form"));
  const trace = JSON.parse(uboStore.getItem(DEMO_SESSION_KEY)).researchResult.ownershipResolutionTrace;
  expect(trace.discoveryState).toBe(DISCOVERY_STATE.IDV_IN_PROGRESS);
  expect(trace.verificationAssessment.finalized).toBe(true);
  expect(trace.verificationPopulation).toEqual([expect.objectContaining({ personName: "Alice Morgan", verificationStatus: "NOT_STARTED" })]);
});

test("a restored completed questionnaire consumes its one StrictMode recalculation and enables IDV", async () => {
  const input = props({ type: "RANGE", lowerBound: 10, upperBound: 40, lowerInclusive: true, upperInclusive: true }, { type: "UNKNOWN" });
  window.fetch = jest.fn(() => new Promise(() => {}));
  const firstVisit = render(<OwnershipResolutionQuestions {...input} />);
  fireEvent.change(screen.getByLabelText("Ownership percentage"), { target: { value: "40" } });
  fireEvent.click(screen.getAllByRole("button", { name: /Save answer/i })[0]);
  const nominee = screen.getByRole("heading", { name: /hold shares or ownership rights on behalf/i }).closest("article");
  fireEvent.click(within(nominee).getByLabelText("No"));
  fireEvent.click(within(nominee).getByRole("button", { name: /Save answer/i }));
  await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(Object.values(JSON.parse(uboStore.getItem("ubo-demo.ownership-resolution.v1:case-questions:chart-artifact")).answers)).toHaveLength(2));
  firstVisit.unmount();

  let finishRecalculation;
  window.fetch = jest.fn(() => new Promise((resolve) => { finishRecalculation = resolve; }));
  render(<React.StrictMode><OwnershipResolutionQuestions {...input} /></React.StrictMode>);
  await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(1));
  finishRecalculation({
    ok: true,
    json: async () => ({ success: true, result: { ...input.result, chartAnalysis: qualifyingChartAnalysis() } }),
  });

  await waitFor(() => expect(screen.getByRole("button", { name: /Continue to identity verification/i })).toBeEnabled());
  expect(screen.getByText("Questions complete")).toBeInTheDocument();
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
  expect(screen.queryByText("How we reached the ownership results")).not.toBeInTheDocument();
  expect(screen.queryByText(/identity verification not required/i)).not.toBeInTheDocument();
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
  expect(uboStore.length).toBeGreaterThan(0);

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

test("an uncertain explanation remains in answer history without exposing analyst review internals", () => {
  render(<OwnershipResolutionQuestions {...props({ type: "EXACT", value: 60 }, { type: "EXACT", value: 20 })} />);
  const discrepancyQuestion = screen.getByRole("heading", { name: /Has the company's ownership changed/i }).closest("article");
  fireEvent.click(within(discrepancyQuestion).getByLabelText("I'm not sure"));
  fireEvent.click(within(discrepancyQuestion).getByRole("button", { name: /Save answer/i }));
  expect(screen.getByRole("heading", { name: "Answered questions" })).toBeInTheDocument();
  expect(screen.queryByText("Analyst review required")).not.toBeInTheDocument();
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
    // The preview link renders one update after the acceptance message; waiting
    // for it rather than asserting at once is what makes this stable under load.
    expect(await within(acceptedEvidence).findByText("View uploaded document")).toBeInTheDocument();
    fireEvent.click(within(acceptedEvidence).getByText("View uploaded document"));
    expect(within(acceptedEvidence).getByTitle("Preview of current-register.pdf")).toHaveAttribute("src", "blob:accepted-evidence");
    expect(screen.getByText(/Supporting evidence has been accepted and remains visible below/i)).toBeInTheDocument();
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test("supporting evidence follows a durable queued extraction job to completion", async () => {
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
  window.fetch.mockClear();

  window.fetch
    .mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ success: true, job: { jobId: "job-support-1", state: "QUEUED" } }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        job: {
          jobId: "job-support-1",
          state: "COMPLETE",
          result: {
            artifact: { artifactId: "support-artifact", integrityVerified: true },
            candidateFacts: [ownership("evidence-fact", { type: "EXACT", value: 30 }, "evidence-ref")],
          },
        },
      }),
    });

  const fileInput = container.querySelector('.ubo-resolution-evidence input[type="file"]');
  fireEvent.change(fileInput, { target: { files: [new File(["%PDF-1.4\n%%EOF"], "current-register.pdf", { type: "application/pdf" })] } });

  await waitFor(() => expect(screen.getByText("File received · evidence accepted")).toBeInTheDocument());
  expect(window.fetch).toHaveBeenCalledTimes(2);
  const processRequest = JSON.parse(window.fetch.mock.calls[1][1].body);
  expect(processRequest).toEqual({ operation: "PROCESS_EXTRACTION_JOB", jobId: "job-support-1" });
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
  expect(window.fetch).not.toHaveBeenCalled();
});

test("an answer the server refused says it was not saved and can be sent again", async () => {
  const sent = [];
  mockPersist = async (operation, command) => {
    if (operation !== "SUBMIT_ANSWER") return { researchRelease: { mayProceed: true } };
    sent.push(command.idempotencyKey);
    if (sent.length === 1) throw new Error("The case changed while this step was being worked out.");
    return { researchRelease: { mayProceed: true } };
  };
  render(<OwnershipResolutionQuestions {...props({ type: "EXACT", value: 40 }, { type: "EXACT", value: 40 })} />);
  const nominee = screen.getByRole("heading", { name: /hold shares or ownership rights on behalf/i }).closest("article");
  fireEvent.click(within(nominee).getByLabelText("No"));
  fireEvent.click(within(nominee).getByRole("button", { name: /Save answer/i }));
  const refused = await screen.findByText(/This answer was not saved: The case changed/i);
  fireEvent.click(within(refused.closest("article")).getByRole("button", { name: /Save again/i }));
  await waitFor(() => expect(sent).toHaveLength(2));
  await waitFor(() => expect(screen.queryByText(/This answer was not saved/i)).not.toBeInTheDocument());
});

test("a case finalised before the page loaded goes straight on to identity verification and cannot be edited", () => {
  const input = props({ type: "EXACT", value: 40 }, { type: "EXACT", value: 40 });
  const sent = [];
  mockPersist = async (operation) => { sent.push(operation); return {}; };
  const finalizedTrace = { discoveryState: DISCOVERY_STATE.IDV_IN_PROGRESS, verificationAssessment: { finalized: true, assessmentVersionId: "assessment-1" } };
  uboStore.setItem(DEMO_SESSION_KEY, JSON.stringify({ contractVersion: DEMO_SESSION_CONTRACT, demoCase: { demoCaseId: context.demoCaseId, company: context.company }, researchResult: { ...input.researchResult, ownershipResolutionTrace: finalizedTrace } }));
  render(<OwnershipResolutionQuestions {...input} />);
  expect(screen.getByText(/Your answers have been submitted/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Continue to identity verification/i })).toHaveAttribute("href", "/ubo-demo/customer/idv");
  expect(screen.queryByRole("button", { name: /Continue to identity verification/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Edit answer/i })).not.toBeInTheDocument();
  expect(sent).not.toContain("FINALIZE_ASSESSMENT");
});

test("an answer shows it is saving until the server confirms, and only one sync is sent for the page", async () => {
  const calls = [];
  let finishAnswer;
  mockPersist = (operation) => {
    calls.push(operation);
    if (operation === "SUBMIT_ANSWER") return new Promise((resolve) => { finishAnswer = () => resolve({}); });
    return Promise.resolve({});
  };
  render(<OwnershipResolutionQuestions {...props({ type: "EXACT", value: 40 }, { type: "EXACT", value: 40 })} />);
  const nominee = screen.getByRole("heading", { name: /hold shares or ownership rights on behalf/i }).closest("article");
  fireEvent.click(within(nominee).getByLabelText("No"));
  fireEvent.click(within(nominee).getByRole("button", { name: /Save answer/i }));
  expect(await screen.findByText(/Saving…/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Saving your answers/i })).toBeDisabled();
  await act(async () => { finishAnswer(); });
  await waitFor(() => expect(screen.queryByText(/Saving…/)).not.toBeInTheDocument());
  // The answer made the server recompute; no extra sync follows it.
  expect(calls.filter((operation) => operation === "SYNC_RESOLUTION")).toHaveLength(1);
  expect(calls.filter((operation) => operation === "SUBMIT_ANSWER")).toHaveLength(1);
});
