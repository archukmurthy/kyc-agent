import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import UboDemoRoot from "./UboDemoRoot";
import { DEMO_RESEARCH_PATH, DEMO_START_PATH, isUboDemoPath } from "./demoRoute";
import {
  DEMO_SESSION_KEY,
  OWNERSHIP_TYPES,
  emptyDemoDraft,
  writeDemoSession,
} from "./demoSession";

function renderStart() {
  window.history.replaceState({}, "", DEMO_START_PATH);
  return render(<UboDemoRoot />);
}

function completeRequiredFields({ name = "Acme Holdings Limited", number = "00445790" } = {}) {
  fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/Registration number/), { target: { value: number } });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  window.localStorage.clear();
});

test("new demo route loads without claiming the existing Lab route", () => {
  renderStart();
  expect(screen.getByRole("heading", { name: /research your company/i })).toBeInTheDocument();
  expect(isUboDemoPath("/ubo-demo/")).toBe(true);
  expect(isUboDemoPath("/ubo-control-lab/")).toBe(false);
});

test("country and ownership type use the approved defaults", () => {
  renderStart();
  expect(screen.getByLabelText(/Country of registration/)).toHaveValue("GB");
  expect(screen.getByLabelText(/Ownership type/)).toHaveValue("PRIVATE_LIMITED");
  expect(screen.getByRole("option", { name: "United Kingdom" }).selected).toBe(true);
  expect(screen.getByRole("option", { name: "Private limited company (Ltd)" }).selected).toBe(true);
});

test("company name and registration number are required while case reference is optional", () => {
  renderStart();
  fireEvent.click(screen.getByRole("button", { name: /Start research/ }));
  expect(screen.getByText("Enter the registered company name.")).toBeInTheDocument();
  expect(screen.getByText("Enter the company registration number.")).toBeInTheDocument();

  completeRequiredFields();
  fireEvent.click(screen.getByRole("button", { name: /Start research/ }));
  expect(window.location.pathname).toBe(DEMO_RESEARCH_PATH);
  expect(screen.getByText("Not provided")).toBeInTheDocument();
});

test("registration number preserves leading zeros and Start research creates the demo case", () => {
  renderStart();
  completeRequiredFields({ number: "0012AB34" });
  fireEvent.click(screen.getByRole("button", { name: /Start research/ }));

  expect(screen.getByRole("heading", { name: "Researching Acme Holdings Limited" })).toBeInTheDocument();
  expect(screen.getByText("0012AB34")).toBeInTheDocument();
  const stored = JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY));
  expect(stored.demoCase.company.registrationNumber).toBe("0012AB34");
  expect(stored.demoCase.demoCaseId).toMatch(/^demo-/);
});

test("ownership options map exactly to stable semantic codes", () => {
  expect(OWNERSHIP_TYPES.map(({ code }) => code)).toEqual([
    "PRIVATE_LIMITED", "PUBLIC_LIMITED", "PUBLICLY_LISTED", "LLP", "PARTNERSHIP",
    "CHARITY", "TRUST", "CIC", "OTHER",
  ]);
  renderStart();
  fireEvent.change(screen.getByLabelText(/Ownership type/), { target: { value: "LLP" } });
  expect(screen.getByLabelText(/Ownership type/)).toHaveValue("LLP");
});

test("draft values survive a component refresh and edit navigation", () => {
  const first = renderStart();
  completeRequiredFields({ name: "Persisted Company", number: "00000008" });
  fireEvent.change(screen.getByLabelText(/Case ID/), { target: { value: "CASE-8" } });
  first.unmount();

  render(<UboDemoRoot />);
  expect(screen.getByLabelText(/Company name/)).toHaveValue("Persisted Company");
  expect(screen.getByLabelText(/Registration number/)).toHaveValue("00000008");
  expect(screen.getByLabelText(/Case ID/)).toHaveValue("CASE-8");
});

test("research screen restores the saved demo case after refresh", () => {
  const draft = { ...emptyDemoDraft(), legalName: "Restored Limited", registrationNumber: "00001234" };
  writeDemoSession({
    draft,
    demoCase: {
      demoCaseId: "demo-restored",
      referenceCaseId: "REF-42",
      company: {
        legalName: draft.legalName,
        registrationNumber: draft.registrationNumber,
        countryCode: "GB",
        countryName: "United Kingdom",
        ownershipType: "PRIVATE_LIMITED",
      },
    },
  });
  window.history.replaceState({}, "", DEMO_RESEARCH_PATH);
  render(<UboDemoRoot />);
  expect(screen.getByRole("heading", { name: "Researching Restored Limited" })).toBeInTheDocument();
  expect(screen.getByText("REF-42")).toBeInTheDocument();
  expect(screen.getByText("Research integration coming next")).toBeInTheDocument();
});

test("Start new case clears the browser-local session and returns to defaults", () => {
  renderStart();
  completeRequiredFields();
  fireEvent.click(screen.getByRole("button", { name: /Start research/ }));
  expect(window.localStorage.getItem(DEMO_SESSION_KEY)).not.toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Start new case" }));
  expect(window.location.pathname).toBe(DEMO_START_PATH);
  expect(screen.getByLabelText(/Company name/)).toHaveValue("");
  expect(screen.getByLabelText(/Country of registration/)).toHaveValue("GB");
  expect(window.localStorage.getItem(DEMO_SESSION_KEY)).toBeNull();
});
