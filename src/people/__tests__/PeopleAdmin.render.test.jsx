/**
 * The people screen. What matters here is that it shows an admin a different
 * screen from an owner - the company field and the owner role are the owner's
 * alone - and that it never lets somebody quietly change their own role.
 *
 * The screen hiding those is courtesy. api/ubo-people.js refuses them on every
 * call, and that is what the node tests cover.
 */
import React from "react";
// fireEvent rather than user-event: it is what every other suite in this repo
// uses, and this needed no new dependency to test.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PeopleAdmin from "../PeopleAdmin";

const mockListPeople = jest.fn();
const mockInvitePerson = jest.fn();
const mockChangeRole = jest.fn();
const mockRemovePerson = jest.fn();
const mockCancelInvitation = jest.fn();
jest.mock("../peopleApi", () => ({
  listPeople: (...a) => mockListPeople(...a),
  invitePerson: (...a) => mockInvitePerson(...a),
  changeRole: (...a) => mockChangeRole(...a),
  removePerson: (...a) => mockRemovePerson(...a),
  cancelInvitation: (...a) => mockCancelInvitation(...a),
}));

const ADMIN_VIEW = {
  people: [
    { userId: "user_admin", email: "boss@acme.test", role: "admin", tenantId: "acme", addedAt: "2026-09-01T10:00:00.000Z" },
    { userId: "user_1", email: "analyst@acme.test", role: "analyst", tenantId: "acme", addedAt: "2026-09-02T10:00:00.000Z" },
  ],
  pending: [],
  you: { userId: "user_admin", role: "admin", tenantId: "acme" },
  grantableRoles: ["admin", "analyst"],
};

beforeEach(() => {
  [mockListPeople, mockInvitePerson, mockChangeRole, mockRemovePerson, mockCancelInvitation].forEach((m) => m.mockReset());
});

test("an admin invites a colleague by email, without naming a company", async () => {
  // Nobody has a Clerk id until they sign in, so an email is the only thing an
  // admin can be asked for. The company is theirs and the server uses it.
  mockListPeople.mockResolvedValue(ADMIN_VIEW);
  mockInvitePerson.mockResolvedValue({ invited: {} });

  render(<PeopleAdmin />);
  await screen.findByText("analyst@acme.test");
  expect(screen.queryByLabelText(/company/i)).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "new@acme.test" } });
  fireEvent.click(screen.getByRole("button", { name: /invite/i }));

  await waitFor(() => expect(mockInvitePerson).toHaveBeenCalledWith(
    expect.objectContaining({ email: "new@acme.test", role: "analyst", tenantId: undefined })
  ));
});

test("an admin is never offered the owner role", async () => {
  mockListPeople.mockResolvedValue(ADMIN_VIEW);
  render(<PeopleAdmin />);
  await screen.findByText("analyst@acme.test");

  const options = Array.from(screen.getByLabelText(/^role$/i).options).map((o) => o.value);
  expect(options).toEqual(["admin", "analyst"]);
});

test("an owner names the company and may hand out any role", async () => {
  mockListPeople.mockResolvedValue({
    people: [{ userId: "user_owner", email: "me@us.test", role: "owner", tenantId: null, addedAt: "2026-09-01T10:00:00.000Z" }],
    pending: [],
    you: { userId: "user_owner", role: "owner", tenantId: null },
    grantableRoles: ["owner", "admin", "analyst"],
  });
  mockInvitePerson.mockResolvedValue({ invited: {} });

  render(<PeopleAdmin />);
  await screen.findByText("me@us.test");

  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "boss@rival.test" } });
  fireEvent.change(screen.getByLabelText(/^role$/i), { target: { value: "admin" } });
  fireEvent.change(screen.getByLabelText(/company/i), { target: { value: "rival" } });
  fireEvent.click(screen.getByRole("button", { name: /invite/i }));

  await waitFor(() => expect(mockInvitePerson).toHaveBeenCalledWith(
    expect.objectContaining({ email: "boss@rival.test", role: "admin", tenantId: "rival" })
  ));
});

test("nobody is offered a way to change or remove themselves", async () => {
  // The server refuses it; the screen should not put the button there in the
  // first place, because the only thing it can produce is an error.
  mockListPeople.mockResolvedValue(ADMIN_VIEW);
  render(<PeopleAdmin />);
  await screen.findByText(/\(you\)/);

  expect(screen.getAllByRole("button", { name: /remove/i })).toHaveLength(1);
  expect(screen.getByLabelText(/role for analyst@acme.test/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/role for boss@acme.test/i)).not.toBeInTheDocument();
});

test("an owner set in the configuration is shown as such, not as removable", async () => {
  // Deleting the stored row would change nothing - PLATFORM_OWNER_CLERK_IDS
  // wins - so a Remove button here could only ever lie.
  mockListPeople.mockResolvedValue({
    people: [
      { userId: "user_owner", email: "me@us.test", role: "owner", tenantId: null },
      { userId: "user_boot", role: "owner", tenantId: null, source: "bootstrap" },
    ],
    pending: [],
    you: { userId: "user_owner", role: "owner", tenantId: null },
    grantableRoles: ["owner", "admin", "analyst"],
  });
  render(<PeopleAdmin />);
  expect(await screen.findByText(/set in configuration/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
});

test("an invitation not yet claimed can be withdrawn", async () => {
  mockListPeople
    .mockResolvedValueOnce({ ...ADMIN_VIEW, pending: [{ email: "new@acme.test", role: "analyst", tenantId: "acme" }] })
    .mockResolvedValueOnce(ADMIN_VIEW);
  mockCancelInvitation.mockResolvedValue({ cancelled: "new@acme.test" });

  render(<PeopleAdmin />);
  fireEvent.click(await screen.findByRole("button", { name: /withdraw/i }));

  await waitFor(() => expect(mockCancelInvitation).toHaveBeenCalledWith("new@acme.test"));
  expect(await screen.findByText(/no invitations waiting/i)).toBeInTheDocument();
});

test("changing somebody's role asks the server and reloads", async () => {
  mockListPeople.mockResolvedValue(ADMIN_VIEW);
  mockChangeRole.mockResolvedValue({ person: {} });

  render(<PeopleAdmin />);
  fireEvent.change(await screen.findByLabelText(/role for analyst@acme.test/i), { target: { value: "admin" } });

  await waitFor(() => expect(mockChangeRole).toHaveBeenCalledWith("user_1", "admin"));
});

test("an analyst is told why the screen is empty", async () => {
  const refusal = new Error("forbidden");
  refusal.status = 403;
  mockListPeople.mockRejectedValue(refusal);

  render(<PeopleAdmin />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/only an owner or an admin/i);
});

test("an email address is required before anything is sent", async () => {
  mockListPeople.mockResolvedValue(ADMIN_VIEW);
  render(<PeopleAdmin />);
  await screen.findByText("analyst@acme.test");

  fireEvent.click(screen.getByRole("button", { name: /invite/i }));

  expect(mockInvitePerson).not.toHaveBeenCalled();
  expect(await screen.findByRole("alert")).toHaveTextContent(/email address is required/i);
});

test("a person nobody has added yet is told that, not told they are the wrong role", async () => {
  // Both arrive as 403. "Only an owner or an admin can manage people" sends
  // somebody looking for a permission problem when what they need is an
  // invitation.
  const refusal = new Error("no_access");
  refusal.status = 403;
  refusal.code = "no_access";
  mockListPeople.mockRejectedValue(refusal);

  render(<PeopleAdmin />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/account is not set up yet/i);
});
