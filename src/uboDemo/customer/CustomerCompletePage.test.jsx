import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import CustomerCompletePage from "./CustomerCompletePage";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";
import { CUSTOMER_IDV_PATH } from "./customerRoute";
import { DISCOVERY_STATE } from "./verificationAssessment";

const demoCase = { demoCaseId: "complete-case", company: { legalName: "Customer Limited" } };

beforeEach(() => window.localStorage.clear());

function seed(discoveryState) {
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({ contractVersion: DEMO_SESSION_CONTRACT, demoCase, researchResult: { ownershipResolutionTrace: { discoveryState } } }));
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
