/**
 * The customer's way in. Written from their side: the right person gets in,
 * the wrong person is told why, and someone with no link is an analyst trying
 * the view - who goes through the trial gate exactly as before.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import CustomerGate from "./CustomerGate";
import { clearCustomerSession, currentCustomerSession } from "../../auth/customerSession";

function respondWith(byAction) {
  window.fetch = jest.fn(async (url, options) => {
    const { action } = JSON.parse(options.body);
    const [status, payload] = byAction[action] || [404, {}];
    return { ok: status < 400, status, json: async () => payload };
  });
}

function at(path) {
  window.history.replaceState(null, "", path);
}

afterEach(() => {
  clearCustomerSession();
  at("/");
});

const page = <p>Customer page</p>;
const trialGate = (children) => <div data-testid="trial-gate">{children}</div>;

test("a link from the person it was sent to opens their case, and leaves the address bar", async () => {
  respondWith({ open: [200, { session: "s-1", caseId: "case-1", expiresAt: "2026-10-01T00:00:00.000Z" }] });
  at("/ubo-demo/customer/?link=signed-link-token");
  render(<CustomerGate fallback={trialGate}>{page}</CustomerGate>);
  expect(await screen.findByText("Customer page")).toBeInTheDocument();
  expect(screen.queryByTestId("trial-gate")).toBeNull();
  expect(currentCustomerSession()).toEqual({ session: "s-1", caseId: "case-1", expiresAt: "2026-10-01T00:00:00.000Z" });
  expect(window.location.search).toBe("");
  expect(window.fetch).toHaveBeenCalledWith("/api/ubo-customer-link", expect.objectContaining({ credentials: "same-origin" }));
});

test("a forwarded link opened by someone else is refused, with the reason", async () => {
  respondWith({ open: [403, { error: "wrong_recipient", message: "This link was sent to a different email address." }] });
  at("/ubo-demo/customer/?link=signed-link-token");
  render(<CustomerGate fallback={trialGate}>{page}</CustomerGate>);
  expect(await screen.findByText(/sent to a different email address/i, { selector: "h1" })).toBeInTheDocument();
  expect(screen.queryByText("Customer page")).toBeNull();
  expect(currentCustomerSession()).toBeNull();
});

test("after a page load an open session is resumed", async () => {
  respondWith({ resume: [200, { session: "s-1", caseId: "case-1" }] });
  at("/ubo-demo/customer/questions");
  render(<CustomerGate fallback={trialGate}>{page}</CustomerGate>);
  expect(await screen.findByText("Customer page")).toBeInTheDocument();
  expect(screen.queryByTestId("trial-gate")).toBeNull();
});

test("with no link and no session, it is an analyst trying the view - through the trial gate", async () => {
  respondWith({ resume: [401, { error: "no_customer_session" }] });
  at("/ubo-demo/customer/");
  render(<CustomerGate fallback={trialGate}>{page}</CustomerGate>);
  expect(await screen.findByTestId("trial-gate")).toBeInTheDocument();
  expect(currentCustomerSession()).toBeNull();
});

// Found in the browser test: in development React runs a page's start-up
// twice. The first run took the link off the address bar and was thrown
// away; the second saw no link and showed the staff preview, so the wrong
// person was never told the link was not theirs.
test("under React's double start-up the wrong person is still told, and the link is checked once", async () => {
  respondWith({ open: [403, { error: "wrong_recipient", message: "This link was sent to a different email address." }], resume: [401, {}] });
  at("/ubo-demo/customer/?link=signed-link-token");
  render(<React.StrictMode><CustomerGate fallback={trialGate}>{page}</CustomerGate></React.StrictMode>);
  expect(await screen.findByText("This link was sent to a different email address")).toBeInTheDocument();
  expect(screen.queryByTestId("trial-gate")).toBeNull();
  const opens = window.fetch.mock.calls.filter(([, options]) => JSON.parse(options.body).action === "open");
  expect(opens).toHaveLength(1);
});

test("under React's double start-up the right person still gets in", async () => {
  respondWith({ open: [200, { session: "s-2", caseId: "case-2", expiresAt: "2026-10-01T00:00:00.000Z" }], resume: [401, {}] });
  at("/ubo-demo/customer/?link=another-signed-link");
  render(<React.StrictMode><CustomerGate fallback={trialGate}>{page}</CustomerGate></React.StrictMode>);
  expect(await screen.findByText("Customer page")).toBeInTheDocument();
  expect(currentCustomerSession()).toEqual({ session: "s-2", caseId: "case-2", expiresAt: "2026-10-01T00:00:00.000Z" });
});
