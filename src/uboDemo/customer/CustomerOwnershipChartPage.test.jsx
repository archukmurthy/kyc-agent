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
  expect(screen.getByText("Mitchell Fortescue")).toBeInTheDocument();
  expect(screen.getByText(/Candidate fact · not a UBO conclusion/i)).toBeInTheDocument();
  expect(screen.getByText(/Mitchell Fortescue → economic ownership/i)).toBeInTheDocument();
  expect(screen.getByText(/No registry comparison performed/i)).toBeInTheDocument();
});

test("invalid file types are rejected before any request", () => {
  seed();
  const { container } = render(<CustomerOwnershipChartPage />);
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(["chart"], "chart.txt", { type: "text/plain" })] } });
  expect(screen.getByRole("alert")).toHaveTextContent("PDF, PNG or JPEG");
  fireEvent.click(screen.getByRole("button", { name: /Upload and analyse/i }));
  expect(window.fetch).not.toHaveBeenCalled();
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
