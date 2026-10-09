import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { JourneyPicker } from "../JourneyPicker";

// Btn is a required prop (rendered unconditionally in the footer) with no
// default - omitting it crashes render with "Element type is invalid"
// regardless of Card C, so a minimal stand-in is supplied here.
const base = {
  selectedJourneyCard: null,
  setSelectedJourneyCard: () => {},
  setError: () => {},
  searchAttempts: 0,
  demoMode: false,
  Btn: ({ children, ...props }) => <button {...props}>{children}</button>,
};

test("Card C is hidden when the tenant configured no manual form URL", () => {
  render(<JourneyPicker {...base} manualFormUrl="" />);
  expect(screen.queryByText(/I'll complete the form myself/i)).not.toBeInTheDocument();
});

test("Card C renders when the tenant configured one", () => {
  render(<JourneyPicker {...base} manualFormUrl="https://acme.example/apply" />);
  expect(screen.getByText(/I'll complete the form myself/i)).toBeInTheDocument();
});
