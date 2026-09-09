import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReviewerCase from "../ReviewerCase";

const caseData = {
  enabled: true, status: "Approved",
  decisions: [{ band: "A", outcome_type: "auto_match", resolved_by: "system" }],
  events: [{ event_type: "extraction_presented", actor: "system" }],
  maskedFields: { document_number: "••••4567", first_name: "••••" },
};

test("shows status, decisions, events and masked fields", () => {
  render(<ReviewerCase caseData={caseData} />);
  expect(screen.getByText("Approved")).toBeInTheDocument();
  expect(screen.getByText(/Band A/)).toBeInTheDocument();
  expect(screen.getByText("••••4567")).toBeInTheDocument();
  expect(screen.getByText(/extraction_presented/)).toBeInTheDocument();
});

test("Reveal fetches and shows the full value via the audited callback", async () => {
  const onReveal = jest.fn(async () => ({ value: "X1234567" }));
  render(<ReviewerCase caseData={caseData} onReveal={onReveal} />);
  fireEvent.click(screen.getAllByText("Reveal (audited)")[0]);
  await waitFor(() => expect(screen.getByText("X1234567")).toBeInTheDocument());
  expect(onReveal).toHaveBeenCalledWith("document_number");
});

test("renders nothing when disabled", () => {
  const { container } = render(<ReviewerCase caseData={{ enabled: false }} />);
  expect(container).toBeEmptyDOMElement();
});
