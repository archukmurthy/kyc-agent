/**
 * What a person sees between signing in and reaching the product.
 *
 * The states that matter are the refusals: a prospect who is signed in but not
 * invited, and one whose trial has run out. Both must read as a situation with
 * a next step, not as a broken page.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import TrialGate from "../TrialGate";

jest.mock("../../auth/ClerkGate", () => ({
  __esModule: true,
  default: ({ children }) => children,
  isClerkEnabled: () => true,
}));

const mockRedeemInvite = jest.fn();
const mockTrialStatus = jest.fn();
jest.mock("../trialApi", () => ({
  redeemInvite: (...args) => mockRedeemInvite(...args),
  trialStatus: (...args) => mockTrialStatus(...args),
}));

function setUrl(search) {
  window.history.replaceState({}, "", `/ubo-demo${search}`);
}

beforeEach(() => {
  mockRedeemInvite.mockReset();
  mockTrialStatus.mockReset();
  setUrl("");
});

test("an invite in the link is redeemed and then removed from the address bar", async () => {
  // A code left in the URL gets bookmarked, shared and sent in referrer
  // headers. It is single-use to us, so it should not linger.
  setUrl("?invite=ACME-7D3K");
  mockRedeemInvite.mockResolvedValue({ access: {} });
  mockTrialStatus.mockResolvedValue({ inTrial: true, trialEndsAt: new Date(Date.now() + 5 * 86400000).toISOString(), budgetLeft: 90 });

  render(<TrialGate><div>the product</div></TrialGate>);

  await waitFor(() => expect(mockRedeemInvite).toHaveBeenCalledWith("ACME-7D3K"));
  expect(await screen.findByText("the product")).toBeInTheDocument();
  expect(window.location.search).not.toContain("invite");
});

test("signed in with no invitation is told what to do, not shown a sign-up form", async () => {
  mockTrialStatus.mockResolvedValue({ inTrial: false });
  render(<TrialGate><div>the product</div></TrialGate>);

  expect(await screen.findByText(/need an invitation/i)).toBeInTheDocument();
  expect(screen.queryByText("the product")).not.toBeInTheDocument();
});

test("a used-up invitation says so plainly", async () => {
  setUrl("?invite=ACME-7D3K");
  const error = new Error("invite_full");
  error.code = "invite_full";
  mockRedeemInvite.mockRejectedValue(error);

  render(<TrialGate><div>the product</div></TrialGate>);
  expect(await screen.findByText(/maximum number of people/i)).toBeInTheDocument();
});

test("an expired trial still shows the work, and explains why research is off", async () => {
  mockTrialStatus.mockResolvedValue({
    inTrial: true,
    readOnly: true,
    trialEndsAt: new Date(Date.now() - 86400000).toISOString(),
  });
  render(<TrialGate><div>the product</div></TrialGate>);

  expect(await screen.findByText(/trial has ended/i)).toBeInTheDocument();
  expect(screen.getByText("the product")).toBeInTheDocument();
});

test("days remaining are shown while the trial is live", async () => {
  mockTrialStatus.mockResolvedValue({
    inTrial: true,
    readOnly: false,
    trialEndsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    budgetLeft: 42,
  });
  render(<TrialGate><div>the product</div></TrialGate>);

  expect(await screen.findByText(/3 days remaining/i)).toBeInTheDocument();
  expect(screen.getByText(/42 paid AI steps left/i)).toBeInTheDocument();
});

test("a broken status call does not become an outage", async () => {
  // The server refuses anything that matters, so a failing status check should
  // let the product render rather than blocking it.
  mockTrialStatus.mockRejectedValue(new Error("network"));
  render(<TrialGate><div>the product</div></TrialGate>);
  expect(await screen.findByText("the product")).toBeInTheDocument();
});

test("a second trial's link for a sign-in already in a trial says what to do, without naming the other trial", async () => {
  setUrl("?invite=VODAPH-LT6Y");
  mockRedeemInvite.mockRejectedValue(Object.assign(new Error("already_in_trial"), { code: "already_in_trial" }));
  const signOut = jest.fn();
  window.Clerk = { signOut };
  try {
    render(<TrialGate><div>the product</div></TrialGate>);
    expect(await screen.findByText("This sign-in already belongs to another trial, sign out and sign in with a different email address.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your current trial" })).toHaveAttribute("href", "/ubo-demo/");
    expect(screen.queryByText(/Ask whoever sent it/)).not.toBeInTheDocument();
    expect(screen.queryByText("the product")).not.toBeInTheDocument();
    window.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ left: true }) }));
    screen.getByRole("button", { name: "Sign out" }).click();
    expect(signOut).toHaveBeenCalledWith({ redirectUrl: expect.stringContaining("invite=VODAPH-LT6Y") });
    // Review, 2026-10-09: signing out left the customer session cookie behind.
    const [url, options] = window.fetch.mock.calls[0];
    expect(url).toBe("/api/ubo-customer-link");
    expect(JSON.parse(options.body)).toEqual({ action: "leave" });
    expect(options.keepalive).toBe(true);
  } finally {
    delete window.Clerk;
    delete window.fetch;
  }
});

test("an invite is redeemed once even when the page starts up twice", async () => {
  // Review, 2026-10-09: React runs start-up twice in development, and both
  // runs redeemed - two requests racing for a seat.
  setUrl("?invite=ACME-7D3K");
  let finish;
  mockRedeemInvite.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  mockTrialStatus.mockResolvedValue({ inTrial: true, trialEndsAt: new Date(Date.now() + 86400000).toISOString() });
  render(<React.StrictMode><TrialGate><div>the product</div></TrialGate></React.StrictMode>);
  await waitFor(() => expect(mockRedeemInvite).toHaveBeenCalled());
  finish({ access: {} });
  expect(await screen.findByText("the product")).toBeInTheDocument();
  expect(mockRedeemInvite).toHaveBeenCalledTimes(1);
});
test("an owner working in a trial is told their steps are not counted", async () => {
  mockTrialStatus.mockResolvedValue({ inTrial: true, unmetered: true, company: "Test LTD", trialEndsAt: new Date(Date.now() - 86400000).toISOString(), readOnly: false, budgetLeft: 7 });
  render(<TrialGate><div>the product</div></TrialGate>);
  expect(await screen.findByText(/not counted against this trial/)).toBeInTheDocument();
  expect(screen.queryByText(/Test LTD/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Your trial has ended/)).not.toBeInTheDocument();
});
