/**
 * The analyst makes and withdraws a customer's link. The link is shown to be
 * copied; nothing is emailed from here.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import CustomerLinkPanel, { customerLinkUrl } from "./CustomerLinkPanel";

function server(byAction) {
  window.fetch = jest.fn(async (url, options) => {
    const body = JSON.parse(options.body);
    const [status, payload] = byAction[body.action];
    return { ok: status < 400, status, json: async () => payload };
  });
}

test("a link is made for the case and the address entered, after the case is saved", async () => {
  server({ create: [200, { token: "tok.en", caseId: "case-1", expiresAt: "2026-10-30T10:00:00.000Z" }] });
  const prepare = jest.fn(async () => {});
  render(<CustomerLinkPanel caseId="case-1" prepare={prepare} />);
  fireEvent.change(screen.getByLabelText("Customer's email address"), { target: { value: "customer@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Create customer link" }));

  expect(await screen.findByLabelText("Customer link")).toHaveValue(customerLinkUrl("tok.en"));
  expect(screen.getByText("customer@example.test")).toBeInTheDocument();
  expect(prepare).toHaveBeenCalled();
  expect(JSON.parse(window.fetch.mock.calls[0][1].body)).toEqual({ action: "create", caseId: "case-1", email: "customer@example.test" });
});

test("no link while research could still change who needs verification", async () => {
  server({ create: [200, {}] });
  render(<CustomerLinkPanel caseId="case-1" prepare={async () => { throw new Error("Discovery is still in progress."); }} />);
  fireEvent.change(screen.getByLabelText("Customer's email address"), { target: { value: "customer@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Create customer link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Discovery is still in progress.");
  expect(window.fetch).not.toHaveBeenCalled();
});

test("every link for the case can be withdrawn", async () => {
  server({ create: [200, { token: "tok.en", expiresAt: "2026-10-30T10:00:00.000Z" }], revoke: [200, { revoked: "case-1" }] });
  render(<CustomerLinkPanel caseId="case-1" />);
  fireEvent.change(screen.getByLabelText("Customer's email address"), { target: { value: "customer@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Create customer link" }));
  fireEvent.click(await screen.findByRole("button", { name: "Withdraw every link for this case" }));
  expect(await screen.findByText(/has been withdrawn/)).toBeInTheDocument();
  expect(JSON.parse(window.fetch.mock.calls[1][1].body)).toEqual({ action: "revoke", caseId: "case-1" });
});

test("the server's refusal is shown", async () => {
  server({ create: [404, { error: "case_not_found", message: "That case is not in your workspace." }] });
  render(<CustomerLinkPanel caseId="case-9" />);
  fireEvent.change(screen.getByLabelText("Customer's email address"), { target: { value: "customer@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Create customer link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("That case is not in your workspace.");
});

test("a link made earlier is reported and can be withdrawn, though it cannot be shown again", async () => {
  server({ revoke: [200, { revoked: "case-1" }] });
  render(<CustomerLinkPanel caseId="case-1" linkStatus={async () => ({ linkSent: true })} />);
  expect(await screen.findByText(/already been made/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Customer link")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Withdraw every link for this case" }));
  expect(await screen.findByText(/has been withdrawn/)).toBeInTheDocument();
  expect(screen.queryByText(/already been made/)).toBeNull();
});

test("a refused copy selects the link and says how to copy it", async () => {
  server({ create: [200, { token: "tok.en", expiresAt: "2026-10-30T10:00:00.000Z" }] });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
  render(<CustomerLinkPanel caseId="case-1" />);
  fireEvent.change(screen.getByLabelText("Customer's email address"), { target: { value: "customer@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Create customer link" }));
  fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/did not allow copying/);
  expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
});
