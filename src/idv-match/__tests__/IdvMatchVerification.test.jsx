import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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
  // Auto-start shows the QR/link with no click.
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
  await screen.findByText("https://verify.didit.me/s/y");
  fireEvent.click(screen.getByText("I've completed verification"));

  await screen.findByText("Help us confirm your details");
  fireEvent.click(screen.getByLabelText(/Same name, different spelling/));
  fireEvent.click(screen.getByText("Submit explanation"));
  await screen.findByText("Identity verified");
});

test("screening hold (needsRetry/pending, e.g. screening_pending) keeps the auto-poll going until a terminal band arrives", async () => {
  jest.useFakeTimers();
  try {
    let resolveCalls = 0;
    global.fetch = mockFetch({
      "/api/idv-match/session": () => ({ attemptId: "att-1", hostedVerificationUrl: "https://verify.didit.me/s/z" }),
      "/api/idv-match/resolve": () => {
        resolveCalls += 1;
        // First tick: screening still running — same needsRetry/pending shape as
        // the pre-existing verification_in_progress hold. Second tick: terminal.
        if (resolveCalls === 1) {
          return { enabled: true, needsRetry: true, pending: true, reasons: ["screening_pending"] };
        }
        return { enabled: true, band: "A", outcomeType: "auto_match", applicantView: { title: "Identity verified", body: "Your identity has been matched to the selected company officer." } };
      },
    });

    render(<IdvMatchVerification applicationId="app-1" officerCandidate={{ name: "SMITH, John" }} />);
    await act(async () => { await Promise.resolve(); }); // let auto-start's session call land
    await screen.findByText("https://verify.didit.me/s/z");

    // First poll tick: hold response — must NOT render a terminal result and must
    // keep the QR/link screen up so the interval fires again.
    await act(async () => { jest.advanceTimersByTime(4000); await Promise.resolve(); await Promise.resolve(); });
    expect(resolveCalls).toBe(1);
    expect(screen.queryByText("Identity verified")).not.toBeInTheDocument();
    expect(screen.getByText("https://verify.didit.me/s/z")).toBeInTheDocument();

    // Second poll tick: terminal band arrives — same interval, no extra click.
    await act(async () => { jest.advanceTimersByTime(4000); await Promise.resolve(); await Promise.resolve(); });
    expect(resolveCalls).toBe(2);
    await screen.findByText("Identity verified");
  } finally {
    jest.useRealTimers();
  }
});

test("session error surfaces, no crash", async () => {
  global.fetch = mockFetch({ "/api/idv-match/session": () => ({ error: "not_enabled" }) });
  render(<IdvMatchVerification applicationId="app-1" officerCandidate={{ name: "X" }} />);
  // Auto-start hits the error path — surfaced, no crash.
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
});
