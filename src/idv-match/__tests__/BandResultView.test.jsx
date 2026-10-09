import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import BandResultView from "../BandResultView";

const success = { enabled: true, band: "A", outcomeType: "auto_match", applicantView: { title: "Identity verified", body: "Your identity has been matched to the selected company officer." } };
const review = { enabled: true, outcomeType: "unresolved_to_review", applicantView: { title: "We're completing our checks", body: "Your application has been saved. We'll be in touch if we need anything further." } };
const bandC = { enabled: true, band: "C", outcomeType: "demoted_to_loa_path", route: "loa_path", applicantView: { title: "We couldn't confirm your details against the company's registered officers", body: "To continue, please provide a letter of authorization." } };
const dialogue = {
  enabled: true, band: "B",
  dialogue: {
    prompt: { title: "Help us confirm your details", intro: "The name on your identity document differs slightly from the company's registered record.", documentLabel: "Identity document:", companyLabel: "Company record:", documentName: "Ada Lovelace", companyName: "LOVELACE, Ada", question: "What explains the difference?" },
    options: [
      { id: "same_spelling", label: "Same name, different spelling" },
      { id: "changed_name", label: "I changed my name" },
      { id: "registry_incorrect", label: "The company record is out of date or incorrect" },
      { id: "wrong_person", label: "I selected the wrong person" },
      { id: "not_sure", label: "I'm not sure" },
    ],
    submitLabel: "Submit explanation",
  },
};

test("Band A renders the verbatim success copy", () => {
  render(<BandResultView result={success} />);
  expect(screen.getByText("Identity verified")).toBeInTheDocument();
  expect(screen.getByText("Your identity has been matched to the selected company officer.")).toBeInTheDocument();
});

test("unresolved renders the neutral in-review copy, no mention of discrepancy", () => {
  render(<BandResultView result={review} />);
  expect(screen.getByText("We're completing our checks")).toBeInTheDocument();
  expect(screen.queryByText(/discrepan|mismatch|review your/i)).toBeNull();
});

test("Band C renders LOA copy + routes to the letter-of-authorization flow", () => {
  const onProvideLoa = jest.fn();
  render(<BandResultView result={bandC} onProvideLoa={onProvideLoa} />);
  expect(screen.getByText("We couldn't confirm your details against the company's registered officers")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Provide letter of authorization"));
  expect(onProvideLoa).toHaveBeenCalled();
});

test("Band C shows editable cells + blank fields + inline LOA upload, gating Continue until uploaded", () => {
  const onConfirm = jest.fn();
  const result = { ...bandC, verifiedFields: { firstName: "Bob", documentNumber: "Z9" } };
  const { rerender } = render(
    <BandResultView
      result={result}
      onConfirm={onConfirm}
      extraFields={<label>Email address<input aria-label="Email address" /></label>}
      loaUpload={<div>UPLOAD LOA HERE</div>}
      loaUploaded={false}
    />,
  );
  // editable cells + blank field + the inline LOA upload are all shown
  expect(screen.getByText("Confirm your verified details")).toBeInTheDocument();
  expect(screen.getByText("Bob")).toBeInTheDocument();
  expect(screen.getByLabelText("Email address")).toBeInTheDocument();
  expect(screen.getByText("UPLOAD LOA HERE")).toBeInTheDocument();
  // Continue is BLOCKED until the LOA is uploaded - clicking does nothing
  expect(screen.getByText(/Upload your letter of authorization/)).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Confirm & continue/));
  expect(onConfirm).not.toHaveBeenCalled();
  // once uploaded, Continue works
  rerender(
    <BandResultView
      result={result}
      onConfirm={onConfirm}
      extraFields={<label>Email address<input aria-label="Email address" /></label>}
      loaUpload={<div>UPLOAD LOA HERE</div>}
      loaUploaded={true}
    />,
  );
  fireEvent.click(screen.getByText(/Confirm & continue/));
  expect(onConfirm).toHaveBeenCalledWith({ firstName: "Bob", documentNumber: "Z9" });
});

test("dialogue shows the two names, the five options, and Submit explanation", () => {
  render(<BandResultView result={dialogue} />);
  expect(screen.getByText("Help us confirm your details")).toBeInTheDocument();
  expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  expect(screen.getByText("LOVELACE, Ada")).toBeInTheDocument();
  for (const label of ["Same name, different spelling", "I changed my name", "The company record is out of date or incorrect", "I selected the wrong person", "I'm not sure"]) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
  expect(screen.getByText("Submit explanation")).toBeInTheDocument();
  // never a "Use this name" / "Confirm" pick-one label
  expect(screen.queryByText(/use this name|confirm this|pick one/i)).toBeNull();
});

test("choosing an explanation and submitting reports the category", () => {
  const onSubmitExplanation = jest.fn();
  render(<BandResultView result={dialogue} onSubmitExplanation={onSubmitExplanation} />);
  fireEvent.click(screen.getByLabelText(/Same name, different spelling/));
  fireEvent.click(screen.getByText("Submit explanation"));
  expect(onSubmitExplanation).toHaveBeenCalledWith("same_spelling");
});

test("name-change upload affordance appears with the verbatim prompt", () => {
  const onUploadEvidence = jest.fn();
  const prompt = "Please upload a document that shows both names, such as a marriage certificate or deed poll";
  render(<BandResultView result={dialogue} uploadPrompt={prompt} onUploadEvidence={onUploadEvidence} />);
  expect(screen.getByText(prompt)).toBeInTheDocument();
  const file = new File(["x"], "cert.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("name change document"), { target: { files: [file] } });
  fireEvent.click(screen.getByText("Upload document"));
  expect(onUploadEvidence).toHaveBeenCalledWith("changed_name", file);
});

test("a passing outcome with verified fields shows the confirm/edit panel", () => {
  const onConfirm = jest.fn();
  const result = { enabled: true, band: "A", outcomeType: "auto_match", applicantView: { title: "Identity verified", body: "matched." }, verifiedFields: { firstName: "John", dateOfBirth: "1985-05-24" } };
  render(<BandResultView result={result} onConfirm={onConfirm} />);
  expect(screen.getByText("Confirm your verified details")).toBeInTheDocument();
  expect(screen.getByText("John")).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Confirm & continue/));
  expect(onConfirm).toHaveBeenCalledWith({ firstName: "John", dateOfBirth: "1985-05-24" });
});

test("missing/unreadable data shows a retry, not a pass", () => {
  const onRetry = jest.fn();
  render(<BandResultView result={{ enabled: true, needsRetry: true }} onRetry={onRetry} />);
  fireEvent.click(screen.getByText("Try again"));
  expect(onRetry).toHaveBeenCalled();
});

test("renders nothing when the flag is off", () => {
  const { container } = render(<BandResultView result={{ enabled: false }} />);
  expect(container).toBeEmptyDOMElement();
});

test("requiresReview HARD STOPS the applicant even with verifiedFields + Band C/loa_path shape (no-match screening hit)", () => {
  const onConfirm = jest.fn();
  const onProvideLoa = jest.fn();
  const result = {
    enabled: true, band: "C", outcomeType: "unresolved_to_review", route: "loa_path",
    requiresReview: true, screeningHit: true,
    applicantView: { title: "We're completing our checks", body: "Your application has been saved. We'll be in touch if we need anything further." },
    verifiedFields: { firstName: "Bob", documentNumber: "Z9" },
  };
  render(<BandResultView result={result} onConfirm={onConfirm} onProvideLoa={onProvideLoa} />);
  expect(screen.getByText("We're completing our checks")).toBeInTheDocument();
  expect(screen.queryByText(/confirm/i)).toBeNull();
  expect(screen.queryByText(/continue/i)).toBeNull();
  expect(screen.queryByText(/letter of authorization/i)).toBeNull();
});

test("requiresReview HARD STOPS the applicant on a matched-hit outcome (band B)", () => {
  const onConfirm = jest.fn();
  const onProceed = jest.fn();
  const result = {
    enabled: true, band: "B", outcomeType: "unresolved_to_review",
    requiresReview: true,
    applicantView: { title: "We're completing our checks", body: "Your application has been saved. We'll be in touch if we need anything further." },
    verifiedFields: { firstName: "Bob" },
  };
  render(<BandResultView result={result} onConfirm={onConfirm} onProceed={onProceed} />);
  expect(screen.getByText("We're completing our checks")).toBeInTheDocument();
  expect(screen.queryByText(/confirm/i)).toBeNull();
  expect(screen.queryByText(/continue/i)).toBeNull();
});

test("outcomeType unresolved_to_review HARD STOPS even without a requiresReview field (defense in depth)", () => {
  const onConfirm = jest.fn();
  const onProceed = jest.fn();
  const result = {
    enabled: true, band: "B", outcomeType: "unresolved_to_review",
    // requiresReview deliberately omitted - the outcomeType alone must still hard-stop.
    applicantView: { title: "We're completing our checks", body: "Your application has been saved. We'll be in touch if we need anything further." },
    verifiedFields: { firstName: "Bob" },
  };
  render(<BandResultView result={result} onConfirm={onConfirm} onProceed={onProceed} />);
  expect(screen.getByText("We're completing our checks")).toBeInTheDocument();
  expect(screen.queryByText(/confirm/i)).toBeNull();
  expect(screen.queryByText(/continue/i)).toBeNull();
});
