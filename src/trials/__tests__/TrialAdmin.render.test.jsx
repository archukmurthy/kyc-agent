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
jest.mock("../trialApi", () => ({
  listInvites: (...a) => mockListInvites(...a),
  createInvite: (...a) => mockCreateInvite(...a),
  revokeInvite: (...a) => mockRevokeInvite(...a),
  inviteLink: (code) => `https://example.test/ubo-demo?invite=${code}`,
}));

beforeEach(() => {
  mockListInvites.mockReset();
  mockCreateInvite.mockReset();
  mockRevokeInvite.mockReset();
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
