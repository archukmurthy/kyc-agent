/**
 * A customer (a session for one case) is not shown the analyst's screens; an
 * analyst trying the customer view still is.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import CustomerJourneyHeader from "./CustomerJourneyHeader";
import { clearCustomerSession, setCustomerSession } from "../../auth/customerSession";

afterEach(() => clearCustomerSession());

test("an analyst trying the customer view keeps the links to the analyst screens", () => {
  render(<CustomerJourneyHeader currentStep={1} />);
  expect(screen.getByText("Open Analyst Review")).toBeInTheDocument();
  expect(screen.getByText("Open Audit")).toBeInTheDocument();
});

test("a customer is not shown them", () => {
  setCustomerSession({ session: "s-1", caseId: "case-1" });
  render(<CustomerJourneyHeader currentStep={1} />);
  expect(screen.queryByText("Open Analyst Review")).toBeNull();
  expect(screen.queryByText("Open Audit")).toBeNull();
});
