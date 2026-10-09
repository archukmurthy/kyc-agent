/**
 * Documents step, real agents (RERES-3 item 9): a researching customer starts
 * the paid document search + registry lookup with a button; analysts and plain
 * onboarding keep the automatic run. SHOW_TEST_TOOLS is forced off here - under
 * Jest it is on, and test mode replaces both agents with dummy results.
 */
import React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import KYCAgent from "../../../App";
import { clearDossierCredentials } from "../../../utils/dossierCredential";

jest.mock("../../../constants/appConstants", () => ({
  ...jest.requireActual("../../../constants/appConstants"),
  SHOW_TEST_TOOLS: false,
}));

jest.setTimeout(60000);

let fetchRoutes = {};
let calls = [];
const okJson = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

beforeEach(() => {
  fetchRoutes = {};
  calls = [];
  global.fetch = jest.fn((url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    const key = Object.keys(fetchRoutes).find((k) => String(url).includes(k));
    if (key) return fetchRoutes[key](url, opts);
    return Promise.reject(new Error("offline test"));
  });
  fetchRoutes["/api/doc-search"] = () => okJson({ documents: [], searchedAt: "2026-09-17T00:00:00Z" });
  fetchRoutes["/api/self-source"] = () => okJson({ results: [], searchedAt: "2026-09-17T00:00:00Z" });
});

afterEach(() => {
  jest.restoreAllMocks();
  clearDossierCredentials();
  localStorage.clear();
  window.history.pushState({}, "", "/");
});

const agentCalls = (path) => calls.filter((c) => c.url.includes(path));
const draftOnDocuments = (agentType, extra = {}) => localStorage.setItem("kyc_draft_v1", JSON.stringify({
  savedAt: new Date().toISOString(), tenantId: "nium", agentType,
  state: { companyName: "Acme Ltd", countryCode: "GB", entityType: "Corporate", journeyType: "ai_documents", step: 1, ...extra },
}));

test("a link customer's documents step searches only when they click the button, once per agent", async () => {
  draftOnDocuments("onboarding", { dossierId: "d-1" });
  fetchRoutes["/api/get-dossier"] = () => okJson({
    success: true,
    dossier: { id: "d-1", company_name: "Acme Ltd", entity_type: "Corporate", country_code: "GB", owned_by: "analyst", customer_searches: 0, raw_research: { found: [] } },
  });
  window.history.pushState({}, "", "/?tenant=nium&dossierToken=signed.tok&journey=customer");
  await act(async () => { render(<KYCAgent />); });
  await screen.findByTestId("foundational-facts-gate");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Resume" })); });

  const button = await screen.findByRole("button", { name: "Find documents automatically" });
  await act(async () => { await Promise.resolve(); });
  expect(agentCalls("/api/doc-search")).toHaveLength(0);
  expect(agentCalls("/api/self-source")).toHaveLength(0);
  expect(screen.queryByText(/No documents could be retrieved automatically/)).not.toBeInTheDocument();

  await act(async () => { fireEvent.click(button); });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Find documents automatically" })).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByText(/No documents could be retrieved automatically/)).toBeInTheDocument());
  expect(agentCalls("/api/doc-search")).toHaveLength(1);
  expect(agentCalls("/api/self-source")).toHaveLength(1);
});

test("an analyst's documents step still searches automatically", async () => {
  fetchRoutes["/api/preboarding-auth"] = (url, opts) => okJson(
    opts && opts.method === "POST"
      ? { success: true, token: "ARCH", tenantId: "nium", companyName: "Nium" }
      : { available: true, reason: null, companyName: "Nium" }
  );
  draftOnDocuments("preboarding");
  window.history.pushState({}, "", "/preboarding?tenant=nium");
  await act(async () => { render(<KYCAgent preboarding />); });
  fireEvent.change(await screen.findByPlaceholderText(/Enter access code/i), { target: { value: "ARCH" } });
  await act(async () => {
    fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => /Access Pre-boarding Agent/i.test(b.textContent)));
  });
  await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Resume" })); });

  await waitFor(() => expect(agentCalls("/api/doc-search")).toHaveLength(1));
  expect(agentCalls("/api/self-source")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Find documents automatically" })).not.toBeInTheDocument();
});
