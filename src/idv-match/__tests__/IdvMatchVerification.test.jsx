import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import IdvMatchVerification from "../IdvMatchVerification";

function mockFetch(routes) {
  return jest.fn(async (url, opts) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    const body = key ? routes[key](opts) : {};
    return { ok: true, status: 200, json: async () => body };
  });
}

afterEach(() => { delete global.fetch; });

test("start -> QR/link -> completed -> resolve renders the Band A success", async () => {
  global.fetch = mockFetch({
    "/api/idv-match/session": () => ({ attemptId: "att-1", hostedVerificationUrl: "https://verify.didit.me/s/x" }),
    "/api/idv-match/status": () => ({ status: "Approved", verified: true }),
    "/api/idv-match/resolve": () => ({ enabled: true, band: "A", outcomeType: "auto_match", applicantView: { title: "Identity verified", body: "Your identity has been matched to the selected company officer." } }),
  });

  const onResolved = jest.fn();
  render(<IdvMatchVerification applicationId="app-1" officerCandidate={{ name: "SMITH, John" }} onResolved={onResolved} />);
  fireEvent.click(screen.getByText("Start verification"));
  await screen.findByText("https://verify.didit.me/s/x");

  fireEvent.click(screen.getByText("I've completed verification"));
  await screen.findByText("Identity verified");
  expect(screen.getByText("Your identity has been matched to the selected company officer.")).toBeInTheDocument();
  // reports the outcome reference up (attempt id + band + outcome; no PII)
  expect(onResolved).toHaveBeenCalledWith({ attemptId: "att-1", band: "A", outcomeType: "auto_match" });
});

test("Band B dialogue -> submit same_spelling -> explain resolves to success", async () => {
  global.fetch = mockFetch({
    "/api/idv-match/session": () => ({ attemptId: "att-1", hostedVerificationUrl: "https://verify.didit.me/s/y" }),
    "/api/idv-match/status": () => ({ status: "Approved", verified: true }),
    "/api/idv-match/resolve": () => ({
      enabled: true, band: "B",
      dialogue: { prompt: { title: "Help us confirm your details", intro: "", documentLabel: "Identity document:", companyLabel: "Company record:", documentName: "Ada Lovelace", companyName: "LOVELACE, Ada", question: "What explains the difference?" }, options: [{ id: "same_spelling", label: "Same name, different spelling" }], submitLabel: "Submit explanation" },
    }),
    "/api/idv-match/explain": () => ({ enabled: true, outcomeType: "same_person_variation_accepted", applicantView: { title: "Identity verified", body: "Your identity has been matched to the selected company officer." } }),
  });

  render(<IdvMatchVerification applicationId="app-1" officerCandidate={{ name: "LOVELACE, Ada" }} />);
  fireEvent.click(screen.getByText("Start verification"));
  await screen.findByText("https://verify.didit.me/s/y");
  fireEvent.click(screen.getByText("I've completed verification"));

  await screen.findByText("Help us confirm your details");
  fireEvent.click(screen.getByLabelText(/Same name, different spelling/));
  fireEvent.click(screen.getByText("Submit explanation"));
  await screen.findByText("Identity verified");
});

test("session error surfaces, no crash", async () => {
  global.fetch = mockFetch({ "/api/idv-match/session": () => ({ error: "not_enabled" }) });
  render(<IdvMatchVerification applicationId="app-1" officerCandidate={{ name: "X" }} />);
  fireEvent.click(screen.getByText("Start verification"));
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
});
