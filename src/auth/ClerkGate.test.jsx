/**
 * Signing out, however it happens, also clears a customer session cookie left
 * in this browser (review, 2026-10-09): on a shared computer the next person
 * to sign in as that customer otherwise picked up the review.
 */
import React from "react";
import { render, waitFor } from "@testing-library/react";

jest.mock("@clerk/clerk-react", () => ({
  ClerkProvider: ({ children }) => children,
  SignedIn: () => null,
  SignedOut: ({ children }) => children,
  SignIn: () => null,
  UserButton: () => null,
}));

// The key is read when the module loads, so it is set before the require.
const savedKey = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;
process.env.REACT_APP_CLERK_PUBLISHABLE_KEY = "pk_test_x";
const ClerkGate = require("./ClerkGate").default;
afterAll(() => {
  if (savedKey === undefined) delete process.env.REACT_APP_CLERK_PUBLISHABLE_KEY; else process.env.REACT_APP_CLERK_PUBLISHABLE_KEY = savedKey;
});

test("a signed-out page asks the server to clear the customer session cookie", async () => {
  window.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ left: true }) }));
  try {
    render(<ClerkGate><div>the product</div></ClerkGate>);
    await waitFor(() => expect(window.fetch).toHaveBeenCalled());
    const [url, options] = window.fetch.mock.calls[0];
    expect(url).toBe("/api/ubo-customer-link");
    expect(JSON.parse(options.body)).toEqual({ action: "leave" });
  } finally {
    delete window.fetch;
  }
});
