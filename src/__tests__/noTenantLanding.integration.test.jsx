/**
 * noTenantLanding.integration.test.jsx - 3-strict tenant resolution at the
 * App level. A bare URL (no ?tenant=) must render NoTenantLanding and must
 * NOT call /api/config for any tenant - there is no default tenant to fetch
 * config for.
 *
 * setupTests.js gives every OTHER test a default "?tenant=nium" so the
 * hundreds of existing render tests keep reaching the real flow. This file
 * deliberately overrides that back to a bare "/" to exercise the case those
 * tests don't.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import KYCAgent from "../App";

beforeEach(() => {
  window.history.pushState({}, "", "/");
  global.fetch = jest.fn(() => Promise.reject(new Error("offline test")));
});

afterEach(() => {
  window.history.pushState({}, "", "/?tenant=nium");
  jest.restoreAllMocks();
});

test("no ?tenant= renders NoTenantLanding, not the onboarding flow", () => {
  render(<KYCAgent />);
  expect(screen.getByText("No tenant selected")).toBeInTheDocument();
});

test("no ?tenant= never calls /api/config (other mount-time fetches, e.g. analytics, are unrelated)", () => {
  render(<KYCAgent />);
  const configCalls = global.fetch.mock.calls.filter(([url]) => String(url).includes("/api/config"));
  expect(configCalls).toHaveLength(0);
});

test("?tenant=acme reaches the normal flow, not the landing", () => {
  window.history.pushState({}, "", "/?tenant=acme");
  render(<KYCAgent />);
  expect(screen.queryByText("No tenant selected")).not.toBeInTheDocument();
});

// The server answers 404 { error: "tenant_not_found" } for an unknown tenant.
// Funnelling that into the offline fallback would render a complete working
// wizard for a typo'd tenant, branded with the typo'd id - the browser
// contradicting the server. A transport failure keeps the offline fallback.
test("a 404 from /api/config renders the unknown-tenant screen, not the wizard", async () => {
  window.history.pushState({}, "", "/?tenant=typo");
  global.fetch = jest.fn((url) =>
    String(url).includes("/api/config")
      ? Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "tenant_not_found" }) })
      : Promise.reject(new Error("offline test"))
  );

  render(<KYCAgent />);

  expect(await screen.findByText("No tenant selected")).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/Tesco PLC/i)).not.toBeInTheDocument();
});

test("a network failure still falls back to the offline config, not the landing", async () => {
  window.history.pushState({}, "", "/?tenant=acme");
  global.fetch = jest.fn(() => Promise.reject(new Error("offline test")));

  render(<KYCAgent />);

  expect(await screen.findByPlaceholderText(/Tesco PLC/i)).toBeInTheDocument();
  expect(screen.queryByText("No tenant selected")).not.toBeInTheDocument();
});
