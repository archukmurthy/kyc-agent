import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import CaseLedger from "./CaseLedger";

const respond = (data, ok = true) => jest.fn().mockResolvedValue({ ok, json: async () => data });

test("shows each recorded step with its separate times", async () => {
  const fetchImpl = respond({ success: true, events: [{ eventId: "e1", eventType: "CUSTOMER_ANSWER_RECEIVED", actorType: "CUSTOMER", occurredAt: "2026-09-30T09:59:00.000Z", receivedAt: "2026-09-30T10:00:05.000Z", recordedAt: "2026-09-30T10:00:05.100Z", effectiveAt: "2026-09-12T00:00:00.000Z", relatedQuestionId: "q-date", correlationId: "corr-1" }] });
  render(<CaseLedger caseId="case-1" fetchImpl={fetchImpl} />);
  expect(await screen.findByText("customer answer received")).toBeInTheDocument();
  // Readable to a person; the exact recorded instant is kept on the element.
  const times = [...document.querySelectorAll("time")];
  expect(times.map((time) => time.getAttribute("datetime"))).toEqual(expect.arrayContaining(["2026-09-12T00:00:00.000Z", "2026-09-30T10:00:05.000Z", "2026-09-30T10:00:05.100Z"]));
  expect(times.every((time) => time.textContent && !time.textContent.includes("T10:00"))).toBe(true);
  expect(fetchImpl.mock.calls[0][0]).toBe("/api/ubo-poc-case?caseId=case-1&ledger=1");
});

test("says so when the history cannot be read", async () => {
  render(<CaseLedger caseId="case-1" fetchImpl={respond({ success: false, message: "Not found." }, false)} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Not found.");
});
