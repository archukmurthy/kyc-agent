/**
 * ApplicantPage.brandName.test.jsx - Part A gap #4 (task 14).
 *
 * ApplicantPage reuses DocumentUploadCard (exported by Step2DynamicForm.jsx)
 * at three call sites without passing brandName, so those cards fall back to
 * generic "we"/"Auto-sourced" copy instead of the tenant's brand - the same
 * convention App.js already applies when it renders Step2DynamicForm itself
 * (brandName={companyName_}). This test isolates just that prop hand-off: it
 * stubs DocumentUploadCard so it can observe exactly what brandName each call
 * site receives, independent of the isSelfSourced/badge logic inside the real
 * component (the signatoryIdItem/authorityToActItem docs are always
 * client-provided today, so the badge text itself never changes - the prop
 * threading is what this guards).
 */

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("../../Step2DynamicForm", () => ({
  DocumentUploadCard: ({ item, brandName }) => (
    <div data-testid={`doc-card-${item.requirement}`}>brandName:{brandName || "(none)"}</div>
  ),
}));

import KYCAgent from "../../../App";

jest.setTimeout(60000);

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.reject(new Error("offline test")));
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function pickOption(labelText) {
  const option = screen
    .getAllByText(labelText, { exact: false })
    .find((el) => el.children.length === 0);
  expect(option).toBeTruthy();
  fireEvent.mouseDown(option.parentElement);
}

const settle = async (ms = 5000) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

async function driveToApplicant() {
  await act(async () => {
    render(<KYCAgent />);
  });
  await settle(0);

  fireEvent.change(screen.getByPlaceholderText(/Tesco PLC/i), {
    target: { value: "Britannia Group Limited" },
  });
  fireEvent.change(screen.getByPlaceholderText(/Select or type entity type/i), {
    target: { value: "Corporate" },
  });
  pickOption("🏛 Corporate");
  fireEvent.focus(screen.getByPlaceholderText(/Select ownership type/i));
  pickOption("Private Limited Company");
  fireEvent.change(screen.getByPlaceholderText(/Select or type country/i), {
    target: { value: "United King" },
  });
  pickOption("GB - United Kingdom");

  fireEvent.click(screen.getByRole("button", { name: /Dummy Research/i }));
  await settle(5000);
}

test("the Signatory ID upload card receives the tenant's brand name", async () => {
  await driveToApplicant();
  const card = screen.getByTestId("doc-card-Signatory ID");
  // Offline fallback config has no tenant company name, so brandName falls
  // back to the tenant id ("nium") - either way it must NOT be empty/"(none)".
  expect(card.textContent).not.toBe("brandName:(none)");
});
