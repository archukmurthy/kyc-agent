import React from "react";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import KYCAgent from "../../../App";
import { clearDossierCredentials } from "../../../utils/dossierCredential";

jest.setTimeout(60000);

let fetchRoutes = {};
let calls = [];

beforeEach(() => {
  fetchRoutes = {};
  calls = [];
  global.fetch = jest.fn((url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    const key = Object.keys(fetchRoutes).find((k) => String(url).includes(k));
    if (key) return fetchRoutes[key](url, opts);
    return Promise.reject(new Error("offline test"));
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  clearDossierCredentials();
  localStorage.clear();
  window.history.pushState({}, "", "/");
});

async function mountAt(path) {
  window.history.pushState({}, "", path);
  await act(async () => { render(<KYCAgent />); });
  await act(async () => { await Promise.resolve(); });
}

const bodyText = () => document.body.textContent || "";

test("a valid token link loads the dossier through the token and sends it as a credential", async () => {
  fetchRoutes["/api/get-dossier"] = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ success: true, dossier: { id: "d-1", company_name: "Acme Ltd", owned_by: "analyst", raw_research: { found: [] } } }),
  });
  await mountAt("/?tenant=nium&dossierToken=signed.tok&journey=customer");
  const call = calls.find((c) => c.url.includes("/api/get-dossier"));
  expect(call).toBeTruthy();
  // The token travels ONLY in the Authorization header — never the query
  // string, where it would land in server logs, browser history and Referer.
  expect(call.url).not.toContain("dossierToken=");
  expect(call.url).not.toContain("id=");
  expect(call.opts.headers.Authorization).toBe("Bearer dossier:signed.tok");
  expect(bodyText()).not.toMatch(/no longer valid|expired/i);
});

test("an expired link shows the link-unavailable screen and does not start the wizard", async () => {
  fetchRoutes["/api/get-dossier"] = () => Promise.resolve({
    ok: false, status: 410, json: () => Promise.resolve({ error: "link_expired" }),
  });
  await mountAt("/?tenant=nium&dossierToken=old.tok&journey=customer");
  expect(bodyText()).toMatch(/expired/i);
  expect(bodyText()).toMatch(/new one/i);
});

test("a revoked link says so", async () => {
  fetchRoutes["/api/get-dossier"] = () => Promise.resolve({
    ok: false, status: 410, json: () => Promise.resolve({ error: "link_revoked" }),
  });
  await mountAt("/?tenant=nium&dossierToken=old.tok&journey=customer");
  expect(bodyText()).toMatch(/no longer active|revoked/i);
});

test("a 404 on a valid token (dossier gone) shows link-unavailable and does not start the wizard", async () => {
  // Finding 2 (review): a token whose dossier no longer exists is a 404, not
  // a 401/410 - the old code let this fall through into the empty wizard.
  fetchRoutes["/api/get-dossier"] = () => Promise.resolve({
    ok: false, status: 404, json: () => Promise.resolve({ error: "dossier_not_found" }),
  });
  await mountAt("/?tenant=nium&dossierToken=gone.tok&journey=customer");
  expect(bodyText()).toMatch(/isn't valid/i);
  expect(bodyText()).not.toMatch(/Applicant Details/i);
});

test("a legacy dossierId link is treated as no longer valid and never fetched", async () => {
  await mountAt("/?tenant=nium&dossierId=d-1&journey=customer");
  expect(bodyText()).toMatch(/no longer valid/i);
  expect(calls.find((c) => c.url.includes("/api/get-dossier"))).toBeUndefined();
});

test("the dossier's ownership is recorded from the response", async () => {
  fetchRoutes["/api/get-dossier"] = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ success: true, dossier: { id: "d-1", company_name: "Acme Ltd", owned_by: "customer", raw_research: { found: [] } } }),
  });
  await mountAt("/?tenant=nium&dossierToken=signed.tok&journey=customer");
  // A customer (not an analyst) never sees the review-only banner, even on a customer-owned dossier.
  expect(bodyText()).not.toMatch(/Review only/i);
});

test("a link customer's correction saves the committed corrected state and spends a dossier search", async () => {
  window.confirm = jest.fn(() => true);
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  fetchRoutes["/api/get-dossier"] = () => ok({
    success: true,
    dossier: {
      id: "d-1", company_name: "Acme Ltd", entity_type: "Corporate", country_code: "GB",
      owned_by: "analyst", customer_searches: 0,
      // The old company's director: the person selector's fallback source.
      stakeholders: { directors: [{ full_name: "Olga Oldcompany" }] },
      raw_research: { found: [{ field: "company_name", value: "Acme Ltd", verificationStatus: "verified", source: "Companies House" }] },
    },
  });
  fetchRoutes["/api/search-attempt"] = () => ok({ allowed: true, attemptsUsed: 1, remaining: 1, grant: "grant-1" });
  // No companyName in the response: the saved name must come from committed state.
  fetchRoutes["/api/research"] = () => ok({ content: [{ type: "text", text: "{\"found\":[]}" }], usage: { input_tokens: 1, output_tokens: 1 } });
  fetchRoutes["/api/save-dossier"] = () => ok({ success: true, dossierId: "d-1" });
  await mountAt("/?tenant=nium&dossierToken=signed.tok&journey=customer");

  const gate = await screen.findByTestId("foundational-facts-gate");
  expect(screen.getAllByText(/Olga Oldcompany/).length).toBeGreaterThan(0);
  fireEvent.click(within(gate).getByLabelText(/Confirm Company legal name/i));
  fireEvent.change(await screen.findByTestId("correct-companyName"), { target: { value: "Acme Holdings Ltd" } });
  await act(async () => { fireEvent.click(screen.getByTestId("facts-apply-corrections")); });

  await waitFor(() => expect(calls.some((c) => c.url.includes("/api/save-dossier"))).toBe(true), { timeout: 10000 });
  expect(calls.filter((c) => c.url.includes("/api/search-attempt"))).toHaveLength(1);
  expect(calls.some((c) => c.url.includes("/api/research-attempt"))).toBe(false);
  const saves = calls.filter((c) => c.url.includes("/api/save-dossier"));
  expect(saves).toHaveLength(1);
  const body = JSON.parse(saves[0].opts.body);
  expect(body.seededBy).toBe("customer");
  expect(body.saveReason).toBe("customer_correction");
  expect(body.company.name).toBe("Acme Holdings Ltd");
  expect(body).not.toHaveProperty("searchAttempts");
  // Every research call of the run carries the grant the attempt counter issued.
  const research = calls.filter((c) => /\/api\/research(\?|$)/.test(c.url));
  expect(research.length).toBeGreaterThan(0);
  research.forEach((c) => expect(c.opts.headers["X-Research-Grant"]).toBe("grant-1"));
  // The correction is logged once as a change_event (spec §6.2 step 6).
  const events = calls
    .filter((c) => c.url.includes("/api/change-events"))
    .map((c) => JSON.parse(c.opts.body))
    .filter((e) => e.matchedRule === "CUSTOMER-FACT-CORRECTION");
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    submissionId: "d-1", dossierId: "d-1", fieldId: "foundational_facts.correction",
    workflow: "ops_review", escalation: false, jurisdiction: "GB",
    afterValue: { action: "re_search", changed: ["companyName"] },
  });
  expect(events[0].beforeValue.companyName).toBe("Acme Ltd");
  expect(calls.find((c) => c.url.includes("/api/change-events")).opts.headers.Authorization).toBe("Bearer dossier:signed.tok");
  // The corrected company must not offer the old company's directors.
  expect(screen.getByText("Tell us about yourself")).toBeInTheDocument();
  expect(screen.queryByText(/Olga Oldcompany/)).not.toBeInTheDocument();
});

// I1: a link customer is a customer from the moment they land. Reaching the
// documents step without the picker (e.g. Confirm's "Upload docs") and pressing
// Continue must spend a dossier search BEFORE any research runs. The documents
// step is reached here by resuming a saved draft on top of the link landing —
// driving the Applicant step's identity checks to Confirm is not practical here.
const okJson = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const researchJson = () => okJson({ content: [{ type: "text", text: "{\"found\":[]}" }], usage: { input_tokens: 1, output_tokens: 1 } });
async function resumeOnDocumentsAsLinkCustomer(attemptBody, { customerSearches = 0, draft = {} } = {}) {
  window.confirm = jest.fn(() => true);
  localStorage.setItem("kyc_draft_v1", JSON.stringify({
    savedAt: new Date().toISOString(), tenantId: "nium", agentType: "onboarding",
    state: { companyName: "Acme Ltd", countryCode: "GB", entityType: "Corporate", journeyType: "ai_documents", step: 1, dossierId: "d-1", ...draft },
  }));
  fetchRoutes["/api/get-dossier"] = () => okJson({
    success: true,
    dossier: { id: "d-1", company_name: "Acme Ltd", entity_type: "Corporate", country_code: "GB", owned_by: "analyst", customer_searches: customerSearches, raw_research: { found: [] } },
  });
  fetchRoutes["/api/search-attempt"] = () => okJson(attemptBody);
  fetchRoutes["/api/research"] = researchJson;
  fetchRoutes["/api/change-events"] = () => okJson({ success: true });
  await mountAt("/?tenant=nium&dossierToken=signed.tok&journey=customer");
  await screen.findByTestId("foundational-facts-gate");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Resume" })); });
}
async function landOnDocumentsAsLinkCustomer(attemptBody) {
  await resumeOnDocumentsAsLinkCustomer(attemptBody);
  const cont = await screen.findByRole("button", { name: /Continue →/ });
  await act(async () => { fireEvent.click(cont); });
}
const CARD_A = "Upload documents & let AI fill the rest";
// Documents step → Back → the journey picker.
async function backToPicker() {
  const back = await screen.findByRole("button", { name: /← Back/ });
  await act(async () => { fireEvent.click(back); });
  await screen.findByText(CARD_A);
}
async function pickCardAndContinue(title) {
  fireEvent.click(screen.getByText(title).parentElement);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Continue →/ })); });
}
const flagEvents = () => calls
  .filter((c) => c.url.includes("/api/change-events"))
  .map((c) => JSON.parse(c.opts.body))
  .filter((e) => e.fieldId === "reresearch.fallback");
const researchCalls = () => calls.filter((c) => /\/api\/research(\?|$)/.test(c.url));

test("a link customer's Continue from the documents step spends a dossier search before research runs", async () => {
  await landOnDocumentsAsLinkCustomer({ allowed: true, attemptsUsed: 1, remaining: 1 });
  await waitFor(() => expect(researchCalls().length).toBeGreaterThan(0), { timeout: 10000 });
  const spendIdx = calls.findIndex((c) => c.url.includes("/api/search-attempt"));
  const researchIdx = calls.findIndex((c) => /\/api\/research(\?|$)/.test(c.url));
  expect(spendIdx).toBeGreaterThanOrEqual(0);
  expect(spendIdx).toBeLessThan(researchIdx);
  expect(calls.filter((c) => c.url.includes("/api/search-attempt"))).toHaveLength(1);
});

test("a refused search from the documents step runs no research", async () => {
  await landOnDocumentsAsLinkCustomer({ allowed: false, attemptsUsed: 2, remaining: 0 });
  await waitFor(() => expect(calls.some((c) => c.url.includes("/api/search-attempt"))).toBe(true));
  await act(async () => { await Promise.resolve(); });
  expect(researchCalls()).toHaveLength(0);
  expect(flagEvents()).toHaveLength(1);
  expect(flagEvents()[0].afterValue.stage).toBe("search_cap");
});

test("a refused search on the picker flags the refusal as a search-cap fallback", async () => {
  await resumeOnDocumentsAsLinkCustomer({ allowed: false, attemptsUsed: 2, remaining: 0 });
  await backToPicker();
  await pickCardAndContinue(CARD_A);
  await waitFor(() => expect(flagEvents()).toHaveLength(1));
  expect(flagEvents()[0]).toMatchObject({ submissionId: "d-1", dossierId: "d-1", afterValue: { stage: "search_cap", reason: "no_searches_left" } });
  expect(researchCalls()).toHaveLength(0);
});

test("resuming a draft on a link landing keeps the server's dossier and search count", async () => {
  await resumeOnDocumentsAsLinkCustomer(
    { allowed: false, attemptsUsed: 2, remaining: 0 },
    { customerSearches: 1, draft: { searchAttempts: 0, dossierId: "d-stale" } },
  );
  await backToPicker();
  // One search already used → the second-attempt tip.
  expect(screen.getByTestId("legal-name-alert")).toBeInTheDocument();
  await pickCardAndContinue(CARD_A);
  await waitFor(() => expect(calls.some((c) => c.url.includes("/api/search-attempt"))).toBe(true));
  expect(JSON.parse(calls.find((c) => c.url.includes("/api/search-attempt")).opts.body).dossierId).toBe("d-1");
});

test("card A asks the paid-call confirm once, not again when the documents step starts research", async () => {
  await resumeOnDocumentsAsLinkCustomer({ allowed: true, attemptsUsed: 1, remaining: 1, grant: "grant-A" });
  await backToPicker();
  window.confirm.mockClear();
  await pickCardAndContinue(CARD_A);
  const cont = await screen.findByRole("button", { name: /Continue →/ });
  await act(async () => { fireEvent.click(cont); });
  await waitFor(() => expect(researchCalls().length).toBeGreaterThan(0), { timeout: 10000 });
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(calls.filter((c) => c.url.includes("/api/search-attempt"))).toHaveLength(1);
  researchCalls().forEach((c) => expect(c.opts.headers["X-Research-Grant"]).toBe("grant-A"));
});

test("an unused card-A search pays for a later correction instead of spending another", async () => {
  window.confirm = jest.fn(() => true);
  const found = [{ field: "company_name", value: "Acme Ltd", verificationStatus: "verified", source: "Companies House" }];
  // The Applicant-step draft is resumed only after card A was paid and abandoned.
  localStorage.setItem("kyc_draft_v1", JSON.stringify({
    savedAt: new Date().toISOString(), tenantId: "nium", agentType: "onboarding",
    state: { companyName: "Acme Ltd", countryCode: "GB", entityType: "Corporate", journeyType: "ai_only", step: 2, dossierId: "d-1", research: { found } },
  }));
  fetchRoutes["/api/get-dossier"] = () => okJson({
    success: true,
    dossier: { id: "d-1", company_name: "Acme Ltd", entity_type: "Corporate", country_code: "GB", owned_by: "analyst", customer_searches: 0, raw_research: { found } },
  });
  let attempt = 0;
  fetchRoutes["/api/search-attempt"] = () => {
    attempt += 1;
    return okJson({ allowed: true, attemptsUsed: attempt, remaining: 2 - attempt, grant: "grant-" + attempt });
  };
  let researchOk = false;
  fetchRoutes["/api/research"] = () => (researchOk
    ? researchJson()
    : Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "research_failed" }) }));
  fetchRoutes["/api/change-events"] = () => okJson({ success: true });
  fetchRoutes["/api/save-dossier"] = () => okJson({ success: true, dossierId: "d-1" });
  await mountAt("/?tenant=nium&dossierToken=signed.tok&journey=customer");

  const correctName = async (name) => {
    const gate = await screen.findByTestId("foundational-facts-gate");
    fireEvent.click(within(gate).getByLabelText(/Confirm Company legal name/i));
    fireEvent.change(await screen.findByTestId("correct-companyName"), { target: { value: name } });
    await act(async () => { fireEvent.click(screen.getByTestId("facts-apply-corrections")); });
  };
  // Search 1: the correction's research fails → the picker.
  await correctName("Acme Holdings Ltd");
  await screen.findByText(CARD_A);
  researchOk = true;
  // Search 2: card A, then the customer backs out of the documents step.
  await pickCardAndContinue(CARD_A);
  await backToPicker();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Resume" })); });
  calls = [];
  await correctName("Acme Group Ltd");
  await waitFor(() => expect(researchCalls().length).toBeGreaterThan(0), { timeout: 10000 });
  expect(calls.filter((c) => c.url.includes("/api/search-attempt"))).toHaveLength(0);
  expect(attempt).toBe(2);
  researchCalls().forEach((c) => expect(c.opts.headers["X-Research-Grant"]).toBe("grant-2"));
});
