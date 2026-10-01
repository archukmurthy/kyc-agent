/**
 * The owner screen. The test that matters most is the one where the person is
 * not an owner: the server refuses them, and the screen has to say so rather
 * than showing an empty table that reads as "no invitations yet".
 */
import React from "react";
// fireEvent rather than user-event: it is what every other suite in this
// repo uses, and this needed no new dependency to test.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TrialAdmin from "../TrialAdmin";

const mockListInvites = jest.fn();
const mockCreateInvite = jest.fn();
const mockRevokeInvite = jest.fn();
const mockMarkCustomer = jest.fn();
const mockSetBudget = jest.fn();
jest.mock("../trialApi", () => ({
  listInvites: (...a) => mockListInvites(...a),
  createInvite: (...a) => mockCreateInvite(...a),
  revokeInvite: (...a) => mockRevokeInvite(...a),
  markCustomer: (...a) => mockMarkCustomer(...a),
  setBudget: (...a) => mockSetBudget(...a),
  inviteLink: (code) => `https://example.test/ubo-demo?invite=${code}`,
}));

beforeEach(() => {
  mockListInvites.mockReset();
  mockCreateInvite.mockReset();
  mockRevokeInvite.mockReset();
  mockMarkCustomer.mockReset();
  mockSetBudget.mockReset();
});

test("creating a link asks the server for one and shows it", async () => {
  mockListInvites.mockResolvedValueOnce({ invites: [] }).mockResolvedValueOnce({
    invites: [{ code: "ACME-7D3K", company: "Acme Bank", seats: 5, seatsUsed: 0, days: 7, revoked: false }],
  });
  mockCreateInvite.mockResolvedValue({ invite: { code: "ACME-7D3K" } });

  render(<TrialAdmin />);
  await screen.findByText(/no invitations yet/i);

  fireEvent.change(screen.getByLabelText(/company/i), { target: { value: "Acme Bank" } });
  fireEvent.click(screen.getByRole("button", { name: /create link/i }));

  await waitFor(() => expect(mockCreateInvite).toHaveBeenCalledWith(
    expect.objectContaining({ company: "Acme Bank", seats: 5, days: 7 })
  ));
  expect(await screen.findByText(/example.test\/ubo-demo\?invite=ACME-7D3K/)).toBeInTheDocument();
});

test("a company name is required before anything is sent", async () => {
  mockListInvites.mockResolvedValue({ invites: [] });
  render(<TrialAdmin />);
  await screen.findByText(/no invitations yet/i);

  fireEvent.click(screen.getByRole("button", { name: /create link/i }));

  expect(mockCreateInvite).not.toHaveBeenCalled();
  expect(await screen.findByRole("alert")).toHaveTextContent(/company name is required/i);
});

test("someone who is not an owner is told, not shown an empty table", async () => {
  const refusal = new Error("forbidden");
  refusal.status = 403;
  mockListInvites.mockRejectedValue(refusal);

  render(<TrialAdmin />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/only an owner/i);
});

test("withdrawing a link refreshes the list", async () => {
  mockListInvites
    .mockResolvedValueOnce({ invites: [{ code: "ACME-7D3K", company: "Acme Bank", seats: 5, seatsUsed: 2, days: 7, revoked: false }] })
    .mockResolvedValueOnce({ invites: [{ code: "ACME-7D3K", company: "Acme Bank", seats: 5, seatsUsed: 2, days: 7, revoked: true }] });
  mockRevokeInvite.mockResolvedValue({ revoked: "ACME-7D3K" });

  render(<TrialAdmin />);
  fireEvent.click(await screen.findByRole("button", { name: /withdraw/i }));

  await waitFor(() => expect(mockRevokeInvite).toHaveBeenCalledWith("ACME-7D3K"));
  expect(await screen.findByText(/withdrawn/i)).toBeInTheDocument();
});

test("seats used are visible, so a full invite is obvious before a prospect complains", async () => {
  mockListInvites.mockResolvedValue({
    invites: [{ code: "ACME-7D3K", company: "Acme Bank", seats: 5, seatsUsed: 5, days: 7, revoked: false }],
  });
  render(<TrialAdmin />);
  expect(await screen.findByText("5 / 5")).toBeInTheDocument();
});

test("a person nobody has added yet is told that, not told they are not an owner", async () => {
  const refusal = new Error("no_access");
  refusal.status = 403;
  refusal.code = "no_access";
  mockListInvites.mockRejectedValue(refusal);

  render(<TrialAdmin />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/account is not set up yet/i);
});

test("how much research each prospect has used is on the screen", async () => {
  // Seats say how many arrived. Runs say whether anyone actually used it.
  mockListInvites.mockResolvedValue({
    invites: [{ code: "ACME-7D3K", company: "Acme Bank", seats: 5, seatsUsed: 3, days: 7, budget: 100, budgetSpent: 34, nearlySpent: false, revoked: false }],
  });
  render(<TrialAdmin />);
  expect(await screen.findByText("34 / 100")).toBeInTheDocument();
  expect(screen.getByText("3 / 5")).toBeInTheDocument();
});

test("a prospect about to run out is flagged before they complain", async () => {
  mockListInvites.mockResolvedValue({
    invites: [{ code: "ACME-7D3K", company: "Acme Bank", seats: 5, seatsUsed: 3, days: 7, budget: 100, budgetSpent: 92, nearlySpent: true, revoked: false }],
  });
  render(<TrialAdmin />);
  expect(await screen.findByText(/nearly used up/i)).toBeInTheDocument();
});

test("an invite from before the count existed reads as zero, not as blank", async () => {
  mockListInvites.mockResolvedValue({
    invites: [{ code: "OLD-1", company: "Older Co", seats: 5, seatsUsed: 1, days: 7, budget: 100, revoked: false }],
  });
  render(<TrialAdmin />);
  expect(await screen.findByText("0 / 100")).toBeInTheDocument();
});

test("marking a trial as a customer is one click, shown, and undoable", async () => {
  // A non-buyer's work is deleted 90 days after the trial ends; this mark is
  // what keeps a buyer's.
  mockListInvites
    .mockResolvedValueOnce({ invites: [{ code: "ACME-7D3K", company: "Acme Bank", seats: 5, seatsUsed: 2, days: 7, revoked: false, customer: null }] })
    .mockResolvedValueOnce({ invites: [{ code: "ACME-7D3K", company: "Acme Bank", seats: 5, seatsUsed: 2, days: 7, revoked: false, customer: { markedAt: "2026-09-30T10:00:00.000Z", markedBy: "user_owner" } }] });
  mockMarkCustomer.mockResolvedValue({ code: "ACME-7D3K", customer: true });

  render(<TrialAdmin />);
  fireEvent.click(await screen.findByRole("button", { name: /mark as customer/i }));

  await waitFor(() => expect(mockMarkCustomer).toHaveBeenCalledWith("ACME-7D3K", true));
  expect(await screen.findByText(/customer - work kept/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /undo customer/i })).toBeInTheDocument();
});

test("the owner changes a link's paid AI steps after it has gone out", async () => {
  mockListInvites.mockResolvedValue({
    invites: [{ code: "ACME-7D3K", company: "Acme Bank", seats: 1, seatsUsed: 1, days: 7, budget: 1, budgetSpent: 1, nearlySpent: true, revoked: false }],
  });
  mockSetBudget.mockResolvedValue({ invite: { code: "ACME-7D3K", budget: 3 } });
  render(<TrialAdmin />);
  expect(await screen.findByText("Paid AI steps", { selector: "th" })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Change" }));
  fireEvent.change(screen.getByLabelText("Paid AI steps for Acme Bank"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mockSetBudget).toHaveBeenCalledWith("ACME-7D3K", 3));
  await waitFor(() => expect(mockListInvites).toHaveBeenCalledTimes(2));
});

test("a refused change says why", async () => {
  mockListInvites.mockResolvedValue({
    invites: [{ code: "ACME-7D3K", company: "Acme Bank", seats: 1, seatsUsed: 0, days: 7, budget: 5, budgetSpent: 0, revoked: false }],
  });
  mockSetBudget.mockRejectedValue(new Error("A budget is a whole number from 1 to 10,000."));
  render(<TrialAdmin />);
  fireEvent.click(await screen.findByRole("button", { name: "Change" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("whole number");
});

test("a list that failed to load is never shown as an empty one", async () => {
  // Found in the browser test: a rate-limited load read "No invitations yet"
  // while the owner's links were all there.
  mockListInvites.mockRejectedValue(Object.assign(new Error("You have used all 10 requests for this hour."), { status: 429 }));
  render(<TrialAdmin />);
  expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  expect(screen.queryByText("No invitations yet.")).toBeNull();
});
