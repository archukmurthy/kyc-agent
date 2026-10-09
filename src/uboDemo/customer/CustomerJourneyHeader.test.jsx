/**
 * The customer journey never links to the analyst's screens - for a customer
 * or for an analyst previewing it. Hiding them only once a customer session
 * had loaded showed them to customers after a page load (2026-10-08).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import CustomerJourneyHeader from "./CustomerJourneyHeader";
import { clearCustomerSession, setCustomerSession } from "../../auth/customerSession";

afterEach(() => clearCustomerSession());

test("before any session has loaded, no analyst links are shown", () => {
  render(<CustomerJourneyHeader currentStep={5} />);
  expect(screen.queryByText("Open Analyst Review")).toBeNull();
  expect(screen.queryByText("Open Audit")).toBeNull();
});

test("a customer is not shown them", () => {
  setCustomerSession({ session: "s-1", caseId: "case-1" });
  render(<CustomerJourneyHeader currentStep={1} />);
  expect(screen.queryByText("Open Analyst Review")).toBeNull();
  expect(screen.queryByText("Open Audit")).toBeNull();
});
