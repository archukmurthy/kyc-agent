import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import CustomerCompanyPage from "./CustomerCompanyPage";
import { DEMO_SESSION_KEY } from "../demoSession";
import { CUSTOMER_OWNERSHIP_CHART_PATH, isCustomerCompanyPath } from "./customerRoute";

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/ubo-demo/");
});

test("customer company input continues directly to ownership with no research step", () => {
  const { container } = render(<CustomerCompanyPage />);
  expect(isCustomerCompanyPath(window.location.pathname)).toBe(true);
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

test("customer company input preserves an existing opaque research reference", () => {
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({
    contractVersion: "ubo-demo-browser-session-v1",
    draft: {},
    researchResultReference: { contract: "future", token: "opaque-1" },
  }));
  const { container } = render(<CustomerCompanyPage />);
  fireEvent.change(screen.getByPlaceholderText("Enter the registered company name"), { target: { value: "ASDA Delivery Limited" } });
  fireEvent.change(screen.getByPlaceholderText("For example, 00445790"), { target: { value: "03873501" } });
  fireEvent.submit(container.querySelector("form"));
  expect(JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY)).researchResultReference)
    .toEqual({ contract: "future", token: "opaque-1" });
});
