import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import CustomerCompletePage from "./CustomerCompletePage";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";
import { CUSTOMER_IDV_PATH } from "./customerRoute";
import { DISCOVERY_STATE } from "./verificationAssessment";
import { uboStore } from "../browserStore";

const demoCase = { demoCaseId: "complete-case", company: { legalName: "Customer Limited" } };

beforeEach(() => uboStore.clear());

function seed(discoveryState) {
  uboStore.setItem(DEMO_SESSION_KEY, JSON.stringify({ contractVersion: DEMO_SESSION_CONTRACT, demoCase, researchResult: { ownershipResolutionTrace: { discoveryState } } }));
}

test("complete page fails closed until every current IDV requirement is complete", () => {
  seed(DISCOVERY_STATE.IDV_IN_PROGRESS);
  render(<CustomerCompletePage />);
  expect(screen.getByRole("heading", { name: /Finish identity verification first/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Return to identity verification/i })).toHaveAttribute("href", CUSTOMER_IDV_PATH);
});

test("complete page opens after the shared case reaches IDV complete", () => {
  seed(DISCOVERY_STATE.IDV_COMPLETE);
  render(<CustomerCompletePage />);
  expect(screen.getByRole("heading", { name: "Thank you" })).toBeInTheDocument();
});

test("a customer who has finished is told what happens next, not offered another demo", () => {
  const { setCustomerSession, clearCustomerSession } = require("../../auth/customerSession");
  seed(DISCOVERY_STATE.IDV_COMPLETE);
  setCustomerSession({ session: "s-1", caseId: "complete-case" });
  try {
    render(<CustomerCompletePage />);
    expect(screen.getByText(/sent to the person reviewing your application/)).toBeInTheDocument();
    expect(screen.getByText("You can close this page.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Start another demo/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/population/)).not.toBeInTheDocument();
  } finally {
    clearCustomerSession();
  }
});

test("an analyst trying the customer view can start another demo", () => {
  seed(DISCOVERY_STATE.IDV_COMPLETE);
  render(<CustomerCompletePage />);
  expect(screen.getByRole("link", { name: /Start another demo/ })).toBeInTheDocument();
});
