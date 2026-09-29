import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PreviewBanner } from "../PreviewBanner";

// The "Go to admin" affordance only renders in the amber (missing) state.
// Strict tenant resolution means a bare /admin strands the operator on the
// no-tenant landing screen - the link must carry the active tenant.

let openSpy;

beforeEach(() => {
  openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("Go to admin carries the tenant when one is supplied", () => {
  render(<PreviewBanner missing tenantId="acme" />);
  fireEvent.click(screen.getByRole("button", { name: /Go to admin/i }));
  expect(openSpy).toHaveBeenCalledWith("/admin?tenant=acme", "_blank");
});

test("Go to admin does not emit a dangling ?tenant= when tenantId is empty", () => {
  render(<PreviewBanner missing tenantId="" />);
  fireEvent.click(screen.getByRole("button", { name: /Go to admin/i }));
  expect(openSpy).toHaveBeenCalledWith("/admin", "_blank");
});
