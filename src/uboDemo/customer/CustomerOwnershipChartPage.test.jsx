import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import CustomerOwnershipChartPage from "./CustomerOwnershipChartPage";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";
import {
  CUSTOMER_OWNERSHIP_CHART_SESSION_KEY,
  readCustomerDemoContext,
  writeCustomerOwnershipChartSession,
} from "./customerOwnershipChartSession";
import { CUSTOMER_OWNERSHIP_CHART_PATH, isCustomerOwnershipChartPath } from "./customerRoute";

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
  owners: [{ name: "Mitchell Fortescue", partyType: "NATURAL_PERSON", relationshipLabel: "Economic ownership in Better Holdco", measurement: { type: "EXACT", value: 75 } }],
  assertions: [{ factId: "fact-1", category: "Economic ownership", statement: "Mitchell Fortescue → economic ownership (75%) → Better Holdco", supportStateLabel: "supported" }],
};

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
  window.history.replaceState({}, "", CUSTOMER_OWNERSHIP_CHART_PATH);
  window.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, result: analysis }) }));
});

afterEach(() => { jest.restoreAllMocks(); });

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
  expect(screen.queryByText("Research")).not.toBeInTheDocument();
});

test("the customer ownership step can inspect every registry assertion handed over by the analyst demo", () => {
  seed({ researchResult: { candidateSources: [{ requestId: "request-1", candidateFacts: [
    { factId: "fact-1", type: "RELATIONSHIP", relationship: "ECONOMIC_OWNERSHIP", subject: { name: "Alice" }, object: { name: "Target Ltd" }, measurement: { type: "EXACT", value: 10 }, evidenceReferences: [{ referenceId: "ref-1" }] },
    { factId: "fact-2", type: "RELATIONSHIP", relationship: "VOTING_RIGHTS", subject: { name: "Bob" }, object: { name: "Target Ltd" }, measurement: { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true }, evidenceReferences: [{ referenceId: "ref-2" }] },
  ] }] } });
  render(<CustomerOwnershipChartPage />);
  expect(screen.getByText(/Registry assertions already available/i)).toBeInTheDocument();
  expect(screen.getByText("2 assertions")).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Registry assertions already available/i));
  expect(screen.getByText(/Alice → economic ownership \(10%\) → Target Ltd/i)).toBeInTheDocument();
  expect(screen.getByText(/Bob → voting rights \(\(25%, 50%\]\) → Target Ltd/i)).toBeInTheDocument();
  expect(screen.getByText(/ref-1/)).toBeInTheDocument();
  expect(screen.getByText(/ref-2/)).toBeInTheDocument();
});

test("direct route fails closed when demo context has not been seeded", () => {
  render(<CustomerOwnershipChartPage />);
  expect(screen.getByRole("heading", { name: /Start with a demo company/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Enter company details/i })).toHaveAttribute("href", "/ubo-demo/");
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
  expect(await screen.findByRole("heading", { name: "Certification found" })).toBeInTheDocument();
  expect(screen.getByText("Alex Palmer")).toBeInTheDocument();
  expect(screen.getByText(/Verification of this certification is still required/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "How we understood your chart" })).toBeInTheDocument();
  expect(screen.getByTitle("Visualised ownership structure")).toBeInTheDocument();
  expect(screen.getByText("Mitchell Fortescue")).toBeInTheDocument();
  expect(screen.getByText(/Candidate fact · not a UBO conclusion/i)).toBeInTheDocument();
  expect(screen.getByText(/Mitchell Fortescue → economic ownership/i)).toBeInTheDocument();
  expect(screen.getByText(/No registry comparison performed/i)).toBeInTheDocument();
  const certificationCard = screen.getByRole("heading", { name: "Certification found" }).closest("section");
  const graphCard = screen.getByRole("heading", { name: "How we understood your chart" }).closest("section");
  const ownersCard = screen.getByRole("heading", { name: "1 owner identified" }).closest("section");
  expect(certificationCard.compareDocumentPosition(graphCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(graphCard.compareDocumentPosition(ownersCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
  expect(await screen.findByRole("alert")).toHaveTextContent("document was received");
  expect(screen.getByRole("alert")).toHaveTextContent("Reference: provider_timeout (502)");
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

test("the result page stops before comparison, open-question consumption or final decisioning", () => {
  seed();
  writeCustomerOwnershipChartSession({ context: readCustomerDemoContext(), result: analysis });
  render(<CustomerOwnershipChartPage />);
  expect(screen.getByText(/This page stops after chart analysis/i)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Open questions/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/matched|contradicted/i)).not.toBeInTheDocument();
});
