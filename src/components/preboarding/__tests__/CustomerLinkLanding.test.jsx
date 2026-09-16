import React from "react";
import { render, screen, act } from "@testing-library/react";
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
  expect(call.url).toContain("dossierToken=signed.tok");
  expect(call.url).not.toContain("id=");
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
