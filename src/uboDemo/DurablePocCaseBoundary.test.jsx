/**
 * A case that is not in the signed-in account's workspace says so, and how to
 * get back to the analyst - not a bare "The POC case was not found." (live
 * end-to-end check, 2026-10-08: the browser was still signed in as the
 * customer who had opened their link).
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import DurablePocCaseBoundary from "./DurablePocCaseBoundary";

afterEach(() => { delete window.fetch; window.history.replaceState({}, "", "/"); });

const answer = (status, body) => { window.fetch = jest.fn(async () => ({ ok: status < 400, status, json: async () => body })); };

test("a case outside this account's workspace explains itself and offers sign-out", async () => {
  window.history.replaceState({}, "", "/ubo-demo/customer/questions?case=case-other");
  answer(404, { success: false, code: "case_not_found", message: "The POC case was not found." });
  render(<DurablePocCaseBoundary><p>case page</p></DurablePocCaseBoundary>);
  expect(await screen.findByRole("heading", { name: "This case is not in the account you are signed in to" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  expect(screen.queryByText("case page")).toBeNull();
});

test("any other failure keeps the general message", async () => {
  window.history.replaceState({}, "", "/ubo-demo/review?case=case-1");
  answer(503, { success: false, code: "unavailable", message: "The case could not be saved or restored right now." });
  render(<DurablePocCaseBoundary><p>case page</p></DurablePocCaseBoundary>);
  await waitFor(() => expect(screen.getByRole("heading", { name: "We could not restore this saved case" })).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
});
