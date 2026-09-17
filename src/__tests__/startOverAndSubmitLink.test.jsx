/**
 * Start Over clears the lookup and the saved draft (the shared resetAll root),
 * and a submission names its source dossier with the customer's credential.
 * Drives the real app the same way ApplicantPage.render.test.jsx does.
 *
 * Also covers the Task 8 review addition: a brand-new application (Start Over,
 * then a fresh company lookup) must not be treated as a customer re-search —
 * resetAll must drop seededBy back to "analyst" and searchAttempts back to 0
 * for a non-link journey, or the fresh application inherits the previous
 * company's search cap and never reaches /api/research.
 */
import React from "react";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import KYCAgent from "../App";
import * as submissionDraft from "../utils/submissionDraft";

jest.setTimeout(60000);

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.reject(new Error("offline test")));
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const settle = async (ms = 5000) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

function pickOption(labelText) {
  const option = screen
    .getAllByText(labelText, { exact: false })
    .find((el) => el.children.length === 0);
  expect(option).toBeTruthy();
  fireEvent.mouseDown(option.parentElement);
}

async function fillLookup(companyName) {
  fireEvent.change(screen.getByPlaceholderText(/Tesco PLC/i), { target: { value: companyName } });
  fireEvent.change(screen.getByPlaceholderText(/Select or type entity type/i), { target: { value: "Corporate" } });
  pickOption("🏛 Corporate");
  fireEvent.focus(screen.getByPlaceholderText(/Select ownership type/i));
  pickOption("Private Limited Company");
  fireEvent.change(screen.getByPlaceholderText(/Select or type country/i), { target: { value: "United King" } });
  pickOption("GB - United Kingdom");
}

async function driveToApplicant(companyName = "Britannia Group Limited") {
  await act(async () => {
    render(<KYCAgent />);
  });
  await settle(0);
  await fillLookup(companyName);
  fireEvent.click(screen.getByRole("button", { name: /Dummy Research/i }));
  await settle(5000);
}

test("Start Over from the Applicant page returns to an empty lookup and clears the saved draft", async () => {
  const clearDraft = jest.spyOn(submissionDraft, "clearDraft");
  await driveToApplicant();
  fireEvent.click(screen.getByRole("button", { name: /^Start Over$/ }));
  await settle(0);

  expect(clearDraft).toHaveBeenCalled();
  expect(screen.getByPlaceholderText(/Tesco PLC/i)).toHaveValue("");
  expect(screen.getByPlaceholderText(/Select or type country/i)).toHaveValue("");
});

describe("Start Over does not carry a customer's search cap into a brand-new application", () => {
  // Same fixture shape as ApplicantPage.render.test.jsx's correction suite.
  const researchBody = {
    content: [{ type: "text", text: "{\"companyName\":\"Britannia Holdings Limited\",\"found\":[]}" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  };

  function routeFetch(routes) {
    global.fetch = jest.fn((url, init) => {
      const path = String(url).split("?")[0];
      const handler = routes[path];
      if (!handler) return Promise.reject(new Error("offline test"));
      return Promise.resolve(handler(init));
    });
  }
  const calls = (path) => global.fetch.mock.calls.filter(([url]) => String(url).split("?")[0] === path);
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const card = (title) => screen.getByText(title).parentElement;
  const CARD_B = "Let AI research your company";

  beforeEach(() => {
    window.confirm = jest.fn(() => true);
  });

  it("a fresh company after Start Over reaches /api/research directly, with no cap message and no /api/research-attempt call", async () => {
    await driveToApplicant();
    routeFetch({
      // The customer's correction below spends their last search (now at the
      // two-search cap) under the OLD company.
      "/api/research-attempt": () => ok({ allowed: true, attemptsUsed: 2, remaining: 0 }),
      "/api/research": () => ok(researchBody),
    });

    const gate = screen.getByTestId("foundational-facts-gate");
    fireEvent.click(within(gate).getByLabelText(/Confirm Company legal name/i));
    await settle(0);
    fireEvent.change(screen.getByTestId("correct-companyName"), { target: { value: "Britannia Holdings Limited" } });
    fireEvent.click(screen.getByTestId("facts-apply-corrections"));
    await settle(5000);
    await settle(5000);
    // Sanity: the correction really did spend the customer's search (seededBy
    // "customer", searchAttempts now at the cap) before Start Over.
    expect(calls("/api/research-attempt")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /^Start Over$/ }));
    await settle(0);

    // A brand-new application, filled from the empty lookup Start Over left.
    await fillLookup("Acme Newco Limited");
    fireEvent.click(screen.getByRole("button", { name: /^Continue/ }));
    await settle(0);

    fireEvent.click(card(CARD_B));
    await settle(0);
    fireEvent.click(screen.getByRole("button", { name: /^Continue/ }));
    await settle(5000);

    // Not treated as a customer re-search: no cap banner, no attempt spent...
    expect(screen.queryByText(/You've used your available searches/)).not.toBeInTheDocument();
    expect(calls("/api/research-attempt")).toHaveLength(1); // still just the one from the correction, above
    // ...and the new company's research actually ran.
    const researchCalls = calls("/api/research");
    expect(researchCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(researchCalls[researchCalls.length - 1][1].body);
    expect(body.companyName).toBe("Acme Newco Limited");
  });
});
