import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import CustomerOwnershipChartPage from "./CustomerOwnershipChartPage";
import { graphForChartPresentation, projectGraph, provisionalUboLabel, reconcileSubjectIdentity } from "./ChartAnalysisPanel";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";
import {
  CUSTOMER_OWNERSHIP_CHART_LIBRARY_KEY,
  CUSTOMER_OWNERSHIP_JOB_KEY,
  CUSTOMER_OWNERSHIP_CHART_SESSION_KEY,
  readCustomerDemoContext,
  saveCustomerOwnershipChartExtraction,
  writeCustomerOwnershipChartSession,
  writeCustomerOwnershipJob,
} from "./customerOwnershipChartSession";
import { CUSTOMER_OWNERSHIP_CHART_PATH, CUSTOMER_QUESTIONS_PATH, isCustomerOwnershipChartPath } from "./customerRoute";

const demoCase = {
  demoCaseId: "demo-customer-1",
  referenceCaseId: "CASE-42",
  company: {
    legalName: "Better Comms VOIP Ltd",
    registrationNumber: "00123456",
    countryCode: "GB",
    countryName: "United Kingdom",
    ownershipType: "PRIVATE_LIMITED",
  },
};

const analysis = {
  contractVersion: "ubo-demo-customer-ownership-chart-result-v1",
  company: { ...demoCase.company },
  artifact: { artifactId: "artifact-1", originalFilename: "ownership-chart.png", mediaType: "image/png", sizeBytes: 2048, integrityVerified: true },
  certification: {
    status: "FOUND",
    verificationStatus: "VERIFICATION_REQUIRED",
    signerName: "Alex Palmer",
    signerPostnominal: "ACA",
    signerCapacity: "Management Accountant",
    professionalReference: "ACA No: 5246593",
    certificationDate: "2026-05-05",
    declaration: "I certify that this company structure chart is true, correct and accurate",
    signaturePresence: "Visible signature-like mark",
  },
  sourceGraph: {
    contractVersion: "ubo-ownership-graph-projection-v1",
    projectionId: "source-graph-1",
    subject: { entityId: "company-1", displayName: "Better Comms VOIP Ltd", category: "LEGAL_ENTITY", semantics: ["SUBJECT"] },
    nodes: [
      { entityId: "person-1", displayName: "Mitchell Fortescue", category: "NATURAL_PERSON", semantics: ["NOT_CONFIRMED_UBO"] },
      { entityId: "company-1", displayName: "Better Comms VOIP Ltd", category: "LEGAL_ENTITY", semantics: ["SUBJECT"] },
    ],
    relationships: [{ relationshipId: "fact-1", sourceEntityId: "person-1", targetEntityId: "company-1", relationshipType: "ECONOMIC_OWNERSHIP", dimension: "ECONOMIC", measurement: { type: "EXACT", value: 75 }, indicators: [], qualifiers: {}, support: { claimCount: 1, claimIds: ["fact-1"], evidenceReferences: [] } }],
    calculations: [], qualifications: [], unresolved: [], conflicts: [], reviews: [],
    decision: { snapshotId: "source-1", snapshotHash: "sha256:abc", checkpoint: { type: "SOURCE_INTERPRETATION" }, orchestrationState: "SOURCE_INTERPRETATION_ONLY" },
    summary: { totalEntities: 2, totalRelationships: 1, qualifyingPeople: 0, unresolvedBranches: 0, conflicts: 0, reviewRequirements: 0 },
  },
  sourceCoverage: { state: "CONNECTED", sourceRelationshipCount: 1, subjectConnectedRelationshipCount: 1, disconnectedRelationshipIds: [] },
  evidence: { ownershipDiagramCompleteness: {
    profileVersion: "ownership-chart-extraction-v2",
    schemaVersion: "ownership-chart-schema-v2",
    instructionVersion: "ownership-chart-instructions-v3",
    verificationStrategyVersion: "ownership-chart-targeted-verification-v2",
  } },
  chartAnalysis: {
    contractVersion: "ubo-demo-chart-analysis-v1",
    calculationSemanticsVersion: "ubo-demo-chart-calculation-v2",
    state: "EVALUATED",
    entityLabels: { "person-1": "Mitchell Fortescue", "company-1": "Better Comms VOIP Ltd" },
    view: {
      graph: null,
      qualifications: [{ personEntityId: "person-1", routeStatus: "SATISFIED" }],
      qualificationBases: [{ basisId: "effective-75", personEntityId: "person-1", route: "EFFECTIVE_INTEREST", dimension: "ECONOMIC", assessmentState: "SATISFIED", recordedCalculation: { value: { type: "EXACT", value: "75" } }, orderedPathReferences: [{ pathId: "direct-75", relationshipIds: ["fact-1"], contribution: { type: "EXACT", value: "75" } }] }],
    },
  },
  candidateFacts: [{ factId: "fact-1", type: "RELATIONSHIP", relationship: "ECONOMIC_OWNERSHIP", subject: { name: "Mitchell Fortescue", entityType: "NATURAL_PERSON" }, object: { name: "Better Holdco", entityType: "LEGAL_ENTITY" }, measurement: { type: "EXACT", value: 75 }, qualifiers: { currentState: "CURRENT" }, evidenceReferences: [{ referenceId: "artifact-1" }] }],
  owners: [{ name: "Mitchell Fortescue", partyType: "NATURAL_PERSON", relationshipLabel: "Economic ownership in Better Holdco", measurement: { type: "EXACT", value: 75 } }],
  assertions: [{ factId: "fact-1", category: "Economic ownership", statement: "Mitchell Fortescue → economic ownership (75%) → Better Holdco", supportStateLabel: "supported" }],
};
analysis.chartAnalysis.view.graph = analysis.sourceGraph;

function seed(overrides = {}) {
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({
    contractVersion: DEMO_SESSION_CONTRACT,
    draft: {},
    demoCase,
    researchResult: { deliberately: "opaque" },
    ...overrides,
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", CUSTOMER_OWNERSHIP_CHART_PATH);
  window.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, result: analysis }) }));
});

afterEach(() => { jest.restoreAllMocks(); });

function openOwnershipAnalysis() {
  fireEvent.click(screen.getByRole("link", { name: /View ownership analysis/i }));
}

test("direct customer route renders from seeded company and case context", () => {
  seed();
  render(<CustomerOwnershipChartPage />);
  expect(isCustomerOwnershipChartPath(window.location.pathname)).toBe(true);
  expect(screen.getByRole("heading", { name: /Help us understand your ownership structure/i })).toBeInTheDocument();
  expect(screen.getByText("Better Comms VOIP Ltd")).toBeInTheDocument();
  expect(screen.getByText("00123456")).toBeInTheDocument();
  expect(screen.getByText("CASE-42")).toBeInTheDocument();
  expect(screen.getByText(/certified chart can make verification quicker/i)).toBeInTheDocument();
  expect(screen.getByText("Ownership").closest("li")).toHaveClass("current");
  expect(screen.getByText("Company")).toHaveClass("ubo-customer-progress-label");
  expect(screen.getByText("Questions")).toHaveClass("ubo-customer-progress-label");
  expect(screen.queryByText("Review")).not.toBeInTheDocument();
  expect(screen.queryByText("Research")).not.toBeInTheDocument();
});

test("processed ownership continues to the separate questions step", () => {
  seed();
  const context = readCustomerDemoContext();
  writeCustomerOwnershipChartSession({ context, result: analysis });
  render(<CustomerOwnershipChartPage />);
  expect(screen.queryByText("Questions & resolution")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Continue to questions/i })).toHaveAttribute("href", CUSTOMER_QUESTIONS_PATH);
  const nextStep = screen.getByRole("heading", { name: /Continue to questions/i }).closest("section");
  expect(screen.getByRole("link", { name: /View ownership analysis/i })).toHaveAttribute("href", `${CUSTOMER_OWNERSHIP_CHART_PATH}?view=analysis`);
  expect(within(nextStep).queryByRole("link", { name: /View ownership analysis/i })).not.toBeInTheDocument();
  expect(within(nextStep).getAllByRole("link")).toHaveLength(1);
  expect(screen.queryByRole("heading", { name: "Calculation view" })).not.toBeInTheDocument();
});

test("an incomplete empty extraction never appears successful or enables questions", () => {
  seed();
  const context = readCustomerDemoContext();
  const incomplete = {
    ...analysis,
    extractionQuality: { state: "EXTRACTION_INCOMPLETE", canContinueToQuestions: false, metrics: { ownershipEdgeCount: 0, unresolvedPartyCount: 2 } },
    sourceGraph: { ...analysis.sourceGraph, relationships: [] },
  };
  writeCustomerOwnershipChartSession({ context, result: incomplete });
  render(<CustomerOwnershipChartPage />);
  expect(screen.getByText(/Could not confidently reconstruct the complete ownership structure/i)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Continue to questions/i })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /Replace chart/i }).length).toBeGreaterThan(0);
});

test("the top ownership-analysis link opens a restored analysis directly", () => {
  seed();
  const context = readCustomerDemoContext();
  writeCustomerOwnershipChartSession({ context, result: analysis });
  window.history.replaceState({}, "", `${CUSTOMER_OWNERSHIP_CHART_PATH}?view=analysis`);
  render(<CustomerOwnershipChartPage />);
  expect(screen.getByRole("heading", { name: "Calculation view" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /View ownership analysis/i })).toHaveAttribute("aria-current", "page");
});

test("the customer ownership step can inspect every registry assertion handed over by the analyst demo", () => {
  seed({ researchResult: { analystCustomerRequests: [{ requestId: "request-need-1", informationNeedId: "need-1", title: "Trust status", question: "Whether a trust is present in the ownership chain." }], candidateSources: [{ requestId: "request-1", candidateFacts: [
    { factId: "fact-1", type: "RELATIONSHIP", relationship: "ECONOMIC_OWNERSHIP", subject: { name: "Alice" }, object: { name: "Target Ltd" }, measurement: { type: "EXACT", value: 10 }, evidenceReferences: [{ referenceId: "ref-1" }] },
    { factId: "fact-2", type: "RELATIONSHIP", relationship: "VOTING_RIGHTS", subject: { name: "Bob" }, object: { name: "Target Ltd" }, measurement: { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true }, evidenceReferences: [{ referenceId: "ref-2" }] },
  ] }] } });
  render(<CustomerOwnershipChartPage />);
  expect(screen.queryByRole("heading", { name: "Questions to help complete this review" })).not.toBeInTheDocument();
  const registryAssertions = screen.getByText(/Registry assertions already available/i).closest("section");
  expect(within(registryAssertions).getByText(/2 assertions/)).toBeInTheDocument();
  expect(within(registryAssertions).getByRole("button", { name: "Expand" })).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(within(registryAssertions).getByRole("button", { name: "Expand" }));
  expect(screen.getByText(/Alice → economic ownership → Target Ltd/i)).toBeInTheDocument();
  expect(screen.getByText("10%")).toBeInTheDocument();
  expect(screen.getByText(/Bob → voting rights → Target Ltd/i)).toBeInTheDocument();
  expect(screen.getByText("(25%, 50%]")).toBeInTheDocument();
  expect(screen.getByText(/ref-1/)).toBeInTheDocument();
  expect(screen.getByText(/ref-2/)).toBeInTheDocument();
});

test("direct route fails closed when demo context has not been seeded", () => {
  render(<CustomerOwnershipChartPage />);
  expect(screen.getByRole("heading", { name: /Start with a demo company/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Enter company details/i })).toHaveAttribute("href", "/ubo-demo/customer/");
});

test("one uploaded chart is sent to the isolated Evidence demo endpoint and renders source-backed results", async () => {
  seed();
  const { container } = render(<CustomerOwnershipChartPage />);
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const file = new File([bytes], "ownership-chart.png", { type: "image/png" });
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: /Upload and analyse/i }));
  await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(1));
  const [url, request] = window.fetch.mock.calls[0];
  const body = JSON.parse(request.body);
  expect(url).toBe("/api/ubo-demo-customer-ownership-chart");
  expect(body.demoContext).toEqual(demoCase);
  expect(body.file).toEqual(expect.objectContaining({ originalFilename: "ownership-chart.png", declaredMediaType: "image/png", sizeBytes: 12 }));
  expect(body.file.contentBase64).toBeTruthy();
  expect(body.demoContext.researchResult).toBeUndefined();
  await screen.findByRole("heading", { name: /Continue to questions/i });
  openOwnershipAnalysis();
  expect(screen.getByRole("heading", { name: "Certification found" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View chart" }));
  expect(screen.getByRole("img", { name: "Preview of ownership-chart.png" })).toHaveAttribute("src", expect.stringMatching(/^data:image\/png;base64,/));
  expect(screen.getByRole("button", { name: "Hide chart" })).toBeInTheDocument();
  expect(screen.getByText("Alex Palmer")).toBeInTheDocument();
  expect(screen.getByText(/Verification of this certification is still required/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "How we understood your chart" })).toBeInTheDocument();
  expect(screen.getByTitle("Visualised ownership structure")).toBeInTheDocument();
  expect(screen.getAllByText("Mitchell Fortescue").length).toBeGreaterThanOrEqual(1);
  expect(screen.queryByRole("heading", { name: "1 owner identified" })).not.toBeInTheDocument();
  const chartAssertions = screen.getByText("Assertions extracted from your ownership chart").closest("section");
  fireEvent.click(within(chartAssertions).getByRole("button", { name: "Expand" }));
  expect(screen.getByText(/Mitchell Fortescue → economic ownership/i)).toBeInTheDocument();
  expect(screen.getByText(/not analyst-approved or independently verified/i)).toBeInTheDocument();
  const certificationCard = screen.getByRole("heading", { name: "Certification found" }).closest("section");
  const graphCard = screen.getByRole("heading", { name: "How we understood your chart" }).closest("section");
  const calculationCard = screen.getByRole("heading", { name: "Calculation view" }).closest("section");
  const nextStepCard = screen.getByRole("heading", { name: "Continue to questions" }).closest("section");
  expect(certificationCard.compareDocumentPosition(graphCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(graphCard.compareDocumentPosition(chartAssertions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(chartAssertions.compareDocumentPosition(calculationCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(calculationCard.compareDocumentPosition(nextStepCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Full source graph" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "All", exact: true })).toBeChecked();
  expect(within(calculationCard).getByRole("radio", { name: /Effective ownership/ })).toBeChecked();
  expect(screen.getByText("Mitchell Fortescue", { selector: ".ubo-customer-calculations small" })).toBeInTheDocument();
  expect(screen.getByText(/Mitchell Fortescue → Better Comms VOIP Ltd/)).toBeInTheDocument();
  expect(calculationCard).not.toHaveTextContent(/person-1|chart-party:/i);
  expect(screen.getByText("Provisional chart assessment")).toBeInTheDocument();
  expect(screen.queryByText(/Source assertion map/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Calculation scope/i)).not.toBeInTheDocument();
  [certificationCard, graphCard, calculationCard].forEach((card) => {
    const collapse = within(card).getByRole("button", { name: "Collapse" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(collapse);
    expect(within(card).getByRole("button", { name: "Expand" })).toHaveAttribute("aria-expanded", "false");
  });
  expect(within(chartAssertions).getByRole("button", { name: "Collapse" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("status")).toHaveTextContent(/Evidence saved the Artifact and validated extraction durably/i);
  expect(JSON.parse(window.localStorage.getItem(CUSTOMER_OWNERSHIP_CHART_LIBRARY_KEY)).records).toHaveLength(1);
});

test("a queued upload polls the durable job and ignores a rapid duplicate click", async () => {
  seed();
  window.fetch = jest.fn(async (_url, request) => {
    const body = JSON.parse(request.body);
    const job = body.operation === "PROCESS_EXTRACTION_JOB"
      ? { jobId: "job-1", artifactId: "artifact-1", correlationId: "corr-1", state: "COMPLETE", result: analysis }
      : { jobId: "job-1", artifactId: "artifact-1", correlationId: "corr-1", state: "QUEUED" };
    return { ok: true, json: async () => ({ success: true, job }) };
  });
  const { container } = render(<CustomerOwnershipChartPage />);
  const file = new File([Uint8Array.from([137, 80, 78, 71])], "ownership-chart.png", { type: "image/png" });
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  const upload = screen.getByRole("button", { name: /Upload and analyse/i });
  fireEvent.click(upload); fireEvent.click(upload);
  await screen.findByRole("heading", { name: /Continue to questions/i });
  expect(window.fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(window.fetch.mock.calls[1][1].body)).toEqual({ operation: "PROCESS_EXTRACTION_JOB", jobId: "job-1" });
  expect(window.localStorage.getItem(CUSTOMER_OWNERSHIP_JOB_KEY)).toBeNull();
});

test("refresh resumes the same persisted extraction job without uploading bytes again", async () => {
  seed();
  writeCustomerOwnershipJob({ jobId: "job-refresh", demoCaseId: demoCase.demoCaseId, artifactId: "artifact-1", correlationId: "corr-refresh" });
  window.fetch = jest.fn(async (_url, request) => {
    const body = JSON.parse(request.body);
    expect(body).toEqual({ operation: "GET_EXTRACTION_JOB", jobId: "job-refresh" });
    return { ok: true, json: async () => ({ success: true, job: { jobId: "job-refresh", artifactId: "artifact-1", correlationId: "corr-refresh", state: "COMPLETE", result: analysis } }) };
  });
  render(<CustomerOwnershipChartPage />);
  await screen.findByRole("heading", { name: /Continue to questions/i });
  expect(window.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(window.fetch.mock.calls[0])).not.toContain("contentBase64");
});

test("retry reuses the failed job and existing Artifact", async () => {
  seed();
  let step = 0;
  window.fetch = jest.fn(async (_url, request) => {
    const body = JSON.parse(request.body); step += 1;
    if (step === 1) return { ok: true, json: async () => ({ success: true, job: { jobId: "job-retry", artifactId: "artifact-saved", correlationId: "corr-old", state: "FAILED", failure: { message: "safe" } } }) };
    if (step === 2) {
      expect(body).toEqual({ operation: "RETRY_EXTRACTION_JOB", jobId: "job-retry" });
      return { ok: true, json: async () => ({ success: true, job: { jobId: "job-retry", artifactId: "artifact-saved", correlationId: "corr-new", state: "QUEUED" } }) };
    }
    expect(body).toEqual({ operation: "PROCESS_EXTRACTION_JOB", jobId: "job-retry" });
    return { ok: true, json: async () => ({ success: true, job: { jobId: "job-retry", artifactId: "artifact-saved", correlationId: "corr-new", state: "COMPLETE", result: analysis } }) };
  });
  const { container } = render(<CustomerOwnershipChartPage />);
  const file = new File([Uint8Array.from([137, 80, 78, 71])], "ownership-chart.png", { type: "image/png" });
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: /Upload and analyse/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("saved safely");
  fireEvent.click(screen.getByRole("button", { name: /Try analysis again/i }));
  await screen.findByRole("heading", { name: /Continue to questions/i });
  expect(window.fetch).toHaveBeenCalledTimes(3);
});

test("a restored structured extraction explains when the original chart bytes are unavailable", () => {
  seed();
  const context = readCustomerDemoContext();
  writeCustomerOwnershipChartSession({ context, result: analysis });
  render(<CustomerOwnershipChartPage />);
  fireEvent.click(screen.getByRole("button", { name: "View chart" }));
  expect(screen.getByText(/original file is not available in this browser tab/i)).toBeInTheDocument();
  expect(screen.getByText(/upload the file again to enable preview/i)).toBeInTheDocument();
});

test("a saved same-company extraction can be replayed without a provider call", () => {
  seed();
  const context = readCustomerDemoContext();
  saveCustomerOwnershipChartExtraction({ context, result: analysis });

  render(<CustomerOwnershipChartPage />);
  expect(screen.getByRole("heading", { name: /Reuse an earlier chart analysis/i })).toBeInTheDocument();
  expect(screen.getByText(/original document bytes are not retained/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Use saved extraction — no provider call/i }));

  expect(window.fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent(/No provider call was made/i);
  openOwnershipAnalysis();
  expect(screen.getByRole("heading", { name: "Certification found" })).toBeInTheDocument();
});

test("a stale saved calculation is re-evaluated through the current engine without uploading bytes", async () => {
  seed();
  const stale = {
    ...analysis,
    chartAnalysis: { ...analysis.chartAnalysis, calculationSemanticsVersion: "ubo-demo-chart-calculation-v1" },
  };
  writeCustomerOwnershipChartSession({ context: readCustomerDemoContext(), result: stale });
  window.fetch = jest.fn(async (_url, request) => {
    const body = JSON.parse(request.body);
    expect(body.operation).toBe("REEVALUATE_SAVED_EXTRACTION");
    expect(JSON.stringify(body)).not.toContain("contentBase64");
    return { ok: true, json: async () => ({ success: true, result: analysis }) };
  });

  render(<CustomerOwnershipChartPage />);

  await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole("status")).toHaveTextContent(/re-evaluated through the current UBO engine/i);
  openOwnershipAnalysis();
  expect(screen.getByText(/Recorded aggregate: 75%/i)).toBeInTheDocument();
  expect(screen.getByText(/75% = 75%/i)).toBeInTheDocument();
  expect(screen.getByText("Provisional UBO · qualifies")).toBeInTheDocument();
});

test("a saved graph from the previous verification strategy is re-evaluated even when its calculation is current", async () => {
  seed();
  const duplicateRelationship = { ...analysis.sourceGraph.relationships[0], relationshipId: "verification-copy" };
  const stale = {
    ...analysis,
    evidence: { ownershipDiagramCompleteness: { ...analysis.evidence.ownershipDiagramCompleteness, verificationStrategyVersion: "ownership-chart-targeted-verification-v1" } },
    candidateFacts: [...analysis.candidateFacts, { ...analysis.candidateFacts[0], factId: "verification-copy" }],
    sourceGraph: { ...analysis.sourceGraph, relationships: [...analysis.sourceGraph.relationships, duplicateRelationship] },
  };
  writeCustomerOwnershipChartSession({ context: readCustomerDemoContext(), result: stale });
  window.fetch = jest.fn(async (_url, request) => {
    const body = JSON.parse(request.body);
    expect(body.operation).toBe("REEVALUATE_SAVED_EXTRACTION");
    expect(body.savedResult.sourceGraph.relationships).toHaveLength(2);
    return { ok: true, json: async () => ({ success: true, result: analysis }) };
  });

  render(<CustomerOwnershipChartPage />);

  await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole("status")).toHaveTextContent(/re-evaluated through the current UBO engine/i);
});

test("an unevaluated chart still lists its ownership steps instead of leaving the calculation panel blank", () => {
  seed();
  const unevaluated = {
    ...analysis,
    candidateFacts: [],
    chartAnalysis: { ...analysis.chartAnalysis, view: { ...analysis.chartAnalysis.view, qualifications: [], qualificationBases: [] } },
  };
  writeCustomerOwnershipChartSession({ context: readCustomerDemoContext(), result: unevaluated });
  render(<CustomerOwnershipChartPage />);
  openOwnershipAnalysis();
  expect(screen.getByText(/No effective-ownership result has been recorded yet/i)).toBeInTheDocument();
  expect(screen.getByText("Mitchell Fortescue", { selector: ".ubo-customer-calculation-empty li strong" }).closest("li")).toHaveTextContent(/Better Comms VOIP Ltd: 75%/i);
});

test("a disconnected Vodafone extraction remains inspectable but is explicitly marked incomplete", () => {
  seed();
  const context = readCustomerDemoContext();
  const incomplete = {
    ...analysis,
    sourceCoverage: undefined,
    sourceGraph: {
      ...analysis.sourceGraph,
      relationships: [{ ...analysis.sourceGraph.relationships[0], targetEntityId: "disconnected-company" }],
    },
  };
  writeCustomerOwnershipChartSession({ context, result: incomplete });

  render(<CustomerOwnershipChartPage />);
  openOwnershipAnalysis();
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.getByRole("alert")).toHaveTextContent(/Incomplete ownership map/);
  expect(screen.getByRole("alert")).toHaveTextContent(/relationship chain does not reach Better Comms VOIP Ltd/i);
  const assertions = screen.getByText("Assertions extracted from your ownership chart").closest("section");
  fireEvent.click(within(assertions).getByRole("button", { name: "Expand" }));
  expect(screen.getByText(/Mitchell Fortescue → economic ownership/i)).toBeInTheDocument();
});

test("replacing a rendered chart preserves the saved extraction for no-cost replay", () => {
  seed();
  const context = readCustomerDemoContext();
  saveCustomerOwnershipChartExtraction({ context, result: analysis });
  writeCustomerOwnershipChartSession({ context, result: analysis });

  render(<CustomerOwnershipChartPage />);
  fireEvent.click(screen.getByRole("button", { name: /Replace chart/i }));

  expect(screen.getByRole("heading", { name: /Reuse an earlier chart analysis/i })).toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem(CUSTOMER_OWNERSHIP_CHART_LIBRARY_KEY)).records).toHaveLength(1);
});

test("invalid file types are rejected before any request", () => {
  seed();
  const { container } = render(<CustomerOwnershipChartPage />);
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(["chart"], "chart.txt", { type: "text/plain" })] } });
  expect(screen.getByRole("alert")).toHaveTextContent("PDF, PNG or JPEG");
  fireEvent.click(screen.getByRole("button", { name: /Upload and analyse/i }));
  expect(window.fetch).not.toHaveBeenCalled();
});

test("a server-side analysis failure distinguishes ingestion from provider timeout", async () => {
  seed();
  window.fetch = jest.fn(async () => ({
    ok: false,
    status: 502,
    json: async () => ({ success: false, code: "provider_timeout", message: "We could not analyse this ownership chart. Please try again." }),
  }));
  const { container } = render(<CustomerOwnershipChartPage />);
  const file = new File([Uint8Array.from([137, 80, 78, 71])], "ownership-chart.png", { type: "image/png" });
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: /Upload and analyse/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("document has been saved safely");
  expect(screen.getByRole("alert")).not.toHaveTextContent("provider_timeout");
  expect(screen.getByRole("alert")).not.toHaveTextContent("502");
});

test("customer result refresh restore is case-bound and preserves an opaque research reference without inspecting it", () => {
  seed({ researchResultReference: { kind: "future-contract", token: "research-ref-1", nested: { intentionally: "unknown" } } });
  const context = readCustomerDemoContext();
  expect(context.opaqueResearchReference).toEqual({ kind: "future-contract", token: "research-ref-1", nested: { intentionally: "unknown" } });
  writeCustomerOwnershipChartSession({ context, result: analysis });
  render(<CustomerOwnershipChartPage />);
  expect(screen.getByText("ownership-chart.png")).toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY)).context.opaqueResearchReference).toEqual(context.opaqueResearchReference);
});

test("an active extraction from another company is never restored even when a reused case ID matches", () => {
  seed();
  const current = readCustomerDemoContext();
  writeCustomerOwnershipChartSession({
    context: {
      ...current,
      company: { ...current.company, legalName: "Old Company Limited", registrationNumber: "00999999" },
    },
    result: {
      ...analysis,
      company: { ...analysis.company, legalName: "Old Company Limited", registrationNumber: "00999999" },
    },
  });

  render(<CustomerOwnershipChartPage />);
  expect(screen.getByRole("heading", { name: /Upload your ownership chart/i })).toBeInTheDocument();
  expect(screen.queryByText("ownership-chart.png")).not.toBeInTheDocument();
});

test("the result page offers read-only source comparison without open-question consumption or final decisioning", () => {
  seed();
  writeCustomerOwnershipChartSession({ context: readCustomerDemoContext(), result: analysis });
  render(<CustomerOwnershipChartPage />);
  openOwnershipAnalysis();
  expect(screen.getByText(/Chart analysis remains provisional/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /No research result available to compare/i })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Open questions/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/matched|contradicted/i)).not.toBeInTheDocument();
});

test("graph scope and relationship filters are presentation-only", () => {
  const graph = {
    subjectEntityId: "customer",
    nodes: ["alice", "holdco", "customer", "unrelated"].map((entityId) => ({ entityId })),
    relationships: [
      { relationshipId: "ownership", subjectEntityId: "alice", objectEntityId: "holdco", dimension: "ECONOMIC" },
      { relationshipId: "to-customer", subjectEntityId: "holdco", objectEntityId: "customer", dimension: "ECONOMIC" },
      { relationshipId: "vote", subjectEntityId: "alice", objectEntityId: "customer", dimension: "VOTING" },
      { relationshipId: "other", subjectEntityId: "unrelated", objectEntityId: "unrelated", dimension: "CONTROL" },
    ],
  };
  expect(projectGraph(graph, "RELEVANT", "ALL").relationships.map(({ relationshipId }) => relationshipId)).toEqual(["ownership", "to-customer", "vote"]);
  expect(projectGraph(graph, "FULL", "VOTING").relationships.map(({ relationshipId }) => relationshipId)).toEqual(["vote"]);
  expect(graph.relationships).toHaveLength(4);
});

test("effective-ownership route states use clear provisional UBO labels", () => {
  expect(provisionalUboLabel("SATISFIED", "EFFECTIVE_INTEREST")).toBe("Provisional UBO · qualifies");
  expect(provisionalUboLabel("NOT_SATISFIED", "EFFECTIVE_INTEREST")).toBe("Provisional UBO · does not qualify");
  expect(provisionalUboLabel("INDETERMINATE", "EFFECTIVE_INTEREST")).toBe("Provisional UBO · cannot determine");
});

test("graph filters preserve source-projection nodes and relationship endpoints", () => {
  const source = {
    subject: { entityId: "customer", displayName: "Customer Ltd" },
    nodes: [
      { entityId: "alice", displayName: "Alice" },
      { entityId: "customer", displayName: "Customer Ltd" },
    ],
    relationships: [{ relationshipId: "r1", sourceEntityId: "alice", targetEntityId: "customer", relationshipType: "ECONOMIC_OWNERSHIP", dimension: "ECONOMIC" }],
  };
  const projected = projectGraph(source, "RELEVANT", "ALL");
  expect(projected.nodes.map(({ entityId }) => entityId)).toEqual(["alice", "customer"]);
  expect(projected.relationships).toHaveLength(1);
  expect(source.nodes).toHaveLength(2);
});

test("British Airways-style downstream source charts render in full by default with honest counts", () => {
  const source = {
    subject: { entityId: "british-airways", displayName: "British Airways PLC" },
    summary: { totalEntities: 10, totalRelationships: 8 },
    nodes: ["british-airways", "cargo", "digital", "northstar", "holdco", "owner-a", "owner-b", "owner-c", "owner-d", "owner-e"]
      .map((entityId) => ({ entityId })),
    relationships: [
      { relationshipId: "r1", sourceEntityId: "british-airways", targetEntityId: "cargo", dimension: "ECONOMIC" },
      { relationshipId: "r2", sourceEntityId: "british-airways", targetEntityId: "digital", dimension: "ECONOMIC" },
      { relationshipId: "r3", sourceEntityId: "owner-a", targetEntityId: "northstar", dimension: "ECONOMIC" },
      { relationshipId: "r4", sourceEntityId: "owner-b", targetEntityId: "holdco", dimension: "ECONOMIC" },
      { relationshipId: "r5", sourceEntityId: "owner-c", targetEntityId: "cargo", dimension: "VOTING" },
      { relationshipId: "r6", sourceEntityId: "owner-d", targetEntityId: "digital", dimension: "CONTROL" },
      { relationshipId: "r7", sourceEntityId: "northstar", targetEntityId: "holdco", dimension: "ECONOMIC" },
      { relationshipId: "r8", sourceEntityId: "owner-e", targetEntityId: "holdco", dimension: "VOTING" },
    ],
  };

  const full = projectGraph(source, "FULL", "ALL");
  expect(full.nodes).toHaveLength(10);
  expect(full.relationships).toHaveLength(8);
  expect(full.summary).toEqual(expect.objectContaining({ totalEntities: 10, totalRelationships: 8 }));

  const relevant = projectGraph(source, "RELEVANT", "ALL");
  expect(relevant.nodes).toHaveLength(1);
  expect(relevant.relationships).toHaveLength(0);
  expect(relevant.summary).toEqual(expect.objectContaining({ totalEntities: 1, totalRelationships: 0 }));
});

test("the onboarding subject and an uppercase chart occurrence resolve to one British Airways node", () => {
  const graph = {
    subject: { entityId: "customer", displayName: "British Airways PLC", semantics: ["SUBJECT"] },
    summary: { totalEntities: 3, totalRelationships: 1 },
    nodes: [
      { entityId: "customer", displayName: "British Airways PLC", semantics: ["SUBJECT"] },
      { entityId: "chart-duplicate", displayName: "BRITISHAIRWAYS PLC", semantics: [] },
      { entityId: "cargo", displayName: "BA Demo Cargo Ltd", semantics: [] },
    ],
    relationships: [{ relationshipId: "ba-cargo", sourceEntityId: "chart-duplicate", targetEntityId: "cargo" }],
  };

  const reconciled = reconcileSubjectIdentity(graph, "British Airways PLC");
  expect(reconciled.nodes.map(({ entityId }) => entityId)).toEqual(["customer", "cargo"]);
  expect(reconciled.relationships[0]).toEqual(expect.objectContaining({ sourceEntityId: "customer", targetEntityId: "cargo" }));
  expect(reconciled.summary).toEqual(expect.objectContaining({ totalEntities: 2, totalRelationships: 1 }));
  expect(graph.nodes).toHaveLength(3);
});

test("chart presentation keeps the complete source graph when the operative engine graph contains only one safe edge", () => {
  const operative = {
    nodes: [{ entityId: "subject" }, { entityId: "direct-owner" }],
    relationships: [{ relationshipId: "operative-1", sourceEntityId: "direct-owner", targetEntityId: "subject", dimension: "ECONOMIC" }],
  };
  const source = {
    nodes: ["subject", "direct-owner", "holdco", "parent", "person"].map((entityId) => ({ entityId })),
    relationships: [
      { relationshipId: "source-1", sourceEntityId: "direct-owner", targetEntityId: "subject", dimension: "ECONOMIC" },
      { relationshipId: "source-2", sourceEntityId: "holdco", targetEntityId: "direct-owner", dimension: "ECONOMIC" },
      { relationshipId: "source-3", sourceEntityId: "parent", targetEntityId: "holdco", dimension: "ECONOMIC" },
      { relationshipId: "source-4", sourceEntityId: "person", targetEntityId: "parent", dimension: "ECONOMIC" },
    ],
  };

  expect(graphForChartPresentation(operative, source)).toBe(source);
  expect(projectGraph(graphForChartPresentation(operative, source), "FULL", "ALL").relationships).toHaveLength(4);
});
