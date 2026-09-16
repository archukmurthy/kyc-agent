import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import CustomerCompanyPage from "./CustomerCompanyPage";
import { DEMO_SESSION_KEY } from "../demoSession";
import { CUSTOMER_OWNERSHIP_CHART_PATH, isCustomerCompanyPath } from "./customerRoute";
import { CUSTOMER_OWNERSHIP_CHART_SESSION_KEY } from "./customerOwnershipChartSession";

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/ubo-demo/customer/");
});

test("customer company input continues directly to ownership with no research step", () => {
  const { container } = render(<CustomerCompanyPage />);
  expect(isCustomerCompanyPath(window.location.pathname)).toBe(true);
  expect(isCustomerCompanyPath("/ubo-demo/")).toBe(false);
  expect(screen.queryByText("Research")).not.toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("Enter the registered company name"), { target: { value: "ASDA Delivery Limited" } });
  fireEvent.change(screen.getByPlaceholderText("For example, 00445790"), { target: { value: "03873501" } });
  fireEvent.change(screen.getByPlaceholderText("Your internal reference"), { target: { value: "CASE-99" } });
  const form = container.querySelector("form");
  expect(form).toHaveAttribute("action", CUSTOMER_OWNERSHIP_CHART_PATH);
  fireEvent.submit(form);
  const saved = JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY));
  expect(saved.demoCase).toEqual(expect.objectContaining({
    referenceCaseId: "CASE-99",
    company: expect.objectContaining({ legalName: "ASDA Delivery Limited", registrationNumber: "03873501" }),
  }));
  expect(saved.researchResult).toBeNull();
});

test("customer company input does not attach an unbound research reference to a newly entered company", () => {
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({
    contractVersion: "ubo-demo-browser-session-v1",
    draft: {},
    researchResultReference: { contract: "future", token: "opaque-1" },
  }));
  const { container } = render(<CustomerCompanyPage />);
  fireEvent.change(screen.getByPlaceholderText("Enter the registered company name"), { target: { value: "ASDA Delivery Limited" } });
  fireEvent.change(screen.getByPlaceholderText("For example, 00445790"), { target: { value: "03873501" } });
  fireEvent.submit(container.querySelector("form"));
  expect(JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY)).researchResultReference).toBeUndefined();
});

test("changing company creates a new case and clears cross-company research and active chart state", () => {
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({
    contractVersion: "ubo-demo-browser-session-v1",
    draft: { legalName: "Old Company Limited", registrationNumber: "00999999", countryCode: "GB", ownershipType: "PRIVATE_LIMITED", referenceCaseId: "" },
    demoCase: { demoCaseId: "old-case", referenceCaseId: "", company: { legalName: "Old Company Limited", registrationNumber: "00999999", countryCode: "GB", countryName: "United Kingdom", ownershipType: "PRIVATE_LIMITED" } },
    researchResult: { candidateSources: [{ candidateFacts: [{ factId: "old-fact" }] }] },
  }));
  window.localStorage.setItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY, JSON.stringify({ contractVersion: "ubo-demo-customer-ownership-chart-session-v1", context: { demoCaseId: "old-case" }, result: { artifact: { artifactId: "old-artifact" } } }));
  const { container } = render(<CustomerCompanyPage />);
  fireEvent.change(screen.getByPlaceholderText("Enter the registered company name"), { target: { value: "Vodafone Limited" } });
  fireEvent.change(screen.getByPlaceholderText("For example, 00445790"), { target: { value: "01471587" } });
  fireEvent.submit(container.querySelector("form"));

  const saved = JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY));
  expect(saved.demoCase.demoCaseId).not.toBe("old-case");
  expect(saved.researchResult).toBeNull();
  expect(window.localStorage.getItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY)).toBeNull();
});

test("a connected analyst case keeps its case identity and every source assertion when customer ownership continues", () => {
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({
    contractVersion: "ubo-demo-browser-session-v1",
    draft: { legalName: "ASDA Delivery Limited", registrationNumber: "01396513", countryCode: "GB", ownershipType: "PRIVATE_LIMITED", referenceCaseId: "CASE-63" },
    demoCase: { demoCaseId: "analyst-case-63", referenceCaseId: "CASE-63", company: { legalName: "ASDA Delivery Limited", registrationNumber: "01396513", countryCode: "GB", countryName: "United Kingdom", ownershipType: "PRIVATE_LIMITED" } },
    researchResult: {
      candidateSources: [{ candidateFacts: [{ factId: "fact-1" }, { factId: "fact-2" }] }],
      analystCustomerRequests: [{ requestId: "request-need-1", informationNeedId: "need-1", title: "Trust status", question: "Whether a trust is present in the ownership chain.", about: [{ legalName: "ASDA Delivery Limited" }] }],
    },
  }));
  const { container } = render(<CustomerCompanyPage />);
  expect(screen.getByText(/2 source assertions will continue/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Questions to help complete this review" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Trust status" })).toBeInTheDocument();
  expect(screen.getByText(/Whether a trust is present/)).toBeInTheDocument();
  fireEvent.submit(container.querySelector("form"));
  const saved = JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY));
  expect(saved.demoCase.demoCaseId).toBe("analyst-case-63");
  expect(saved.researchResult.candidateSources[0].candidateFacts.map(({ factId }) => factId)).toEqual(["fact-1", "fact-2"]);
  expect(saved.researchResult.analystCustomerRequests[0].informationNeedId).toBe("need-1");
});
