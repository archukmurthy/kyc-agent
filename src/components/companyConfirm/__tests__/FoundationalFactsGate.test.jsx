import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import FoundationalFactsGate from "../FoundationalFactsGate";

const FACTS = [
  { key: "companyName", label: "Company legal name", value: "Britannia Group Limited", editValue: "Britannia Group Limited", disputable: true },
  { key: "registrationNumber", label: "Registration / company number", value: "01234567", editValue: "01234567", disputable: true },
  { key: "country", label: "Registration country", value: "United Kingdom", editValue: "GB", disputable: true },
  { key: "entityType", label: "Entity type", value: "Corporate", editValue: "Corporate", disputable: true },
  { key: "ownershipType", label: "Ownership type", value: "Private Limited Company", editValue: "private_limited", disputable: true },
];

function Harness({ onApplyCorrections = jest.fn(), correctionBusy = false, correctionError = "", readOnly = false, initialChecks = {}, initialOwnershipFork = null }) {
  const [checks, setChecks] = useState(initialChecks);
  const [ownershipFork, setOwnershipFork] = useState(initialOwnershipFork);
  const [regNumberFork, setRegNumberFork] = useState(null);
  return (
    <FoundationalFactsGate
      facts={FACTS}
      isConfirmed={(k) => checks[k] !== false}
      onToggle={(k) => {
        const was = checks[k] !== false;
        setChecks((p) => ({ ...p, [k]: !was }));
        if (k === "ownershipType") setOwnershipFork(was ? "choose" : null);
        if (k === "registrationNumber") setRegNumberFork(was ? "choose" : null);
      }}
      ownershipFork={ownershipFork}
      regNumberFork={regNumberFork}
      onOwnershipChanged={() => setOwnershipFork("changed")}
      onRegNumberChanged={() => setRegNumberFork("changed")}
      onOwnershipChangeResolved={jest.fn()}
      onRegNumberChangeResolved={jest.fn()}
      onCancel={() => { setChecks({}); setOwnershipFork(null); setRegNumberFork(null); }}
      ownershipTypeOptions={[{ value: "private_limited", label: "Private Limited Company" }, { value: "public_listed", label: "Public Listed Company" }]}
      countryOptions={[{ value: "GB", label: "United Kingdom" }, { value: "IE", label: "Ireland" }]}
      entityTypeOptions={[{ value: "Corporate", label: "Corporate" }, { value: "FI", label: "Financial Institution" }]}
      onApplyCorrections={onApplyCorrections}
      correctionBusy={correctionBusy}
      correctionError={correctionError}
      readOnly={readOnly}
    />
  );
}

const untick = (label) => fireEvent.click(screen.getByLabelText(new RegExp(`Confirm ${label}`, "i")));

test("unticking company name, country or entity type reveals a pre-filled input", () => {
  render(<Harness />);
  untick("Company legal name");
  expect(screen.getByTestId("correct-companyName")).toHaveValue("Britannia Group Limited");
  untick("Registration country");
  expect(screen.getByTestId("correct-country")).toHaveValue("GB");
  untick("Entity type");
  expect(screen.getByTestId("correct-entityType")).toHaveValue("Corporate");
  expect(screen.getByTestId("facts-corrections-panel")).toBeInTheDocument();
});

test("there is no reset-the-application panel any more", () => {
  render(<Harness />);
  untick("Company legal name");
  expect(screen.queryByTestId("facts-reset-confirm")).not.toBeInTheDocument();
  expect(screen.queryByText(/This restarts your application/)).not.toBeInTheDocument();
});

test("Update my details is disabled until a value actually changes, then sends only changed keys", () => {
  const onApplyCorrections = jest.fn();
  render(<Harness onApplyCorrections={onApplyCorrections} />);
  untick("Company legal name");
  untick("Entity type");
  const button = screen.getByTestId("facts-apply-corrections");
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByTestId("correct-companyName"), { target: { value: "  Britannia Holdings Limited " } });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(onApplyCorrections).toHaveBeenCalledWith({ companyName: "Britannia Holdings Limited" });
});

test("an emptied input blocks the update", () => {
  render(<Harness />);
  untick("Company legal name");
  untick("Registration country");
  fireEvent.change(screen.getByTestId("correct-country"), { target: { value: "IE" } });
  fireEvent.change(screen.getByTestId("correct-companyName"), { target: { value: "   " } });
  expect(screen.getByTestId("facts-apply-corrections")).toBeDisabled();
});

test("country maps to countryCode and several corrections go together", () => {
  const onApplyCorrections = jest.fn();
  render(<Harness onApplyCorrections={onApplyCorrections} />);
  untick("Registration country");
  untick("Entity type");
  fireEvent.change(screen.getByTestId("correct-country"), { target: { value: "IE" } });
  fireEvent.change(screen.getByTestId("correct-entityType"), { target: { value: "FI" } });
  fireEvent.click(screen.getByTestId("facts-apply-corrections"));
  expect(onApplyCorrections).toHaveBeenCalledWith({ countryCode: "IE", entityType: "FI" });
});

test("ownership: 'you got it wrong' opens a correction select; 'genuinely changed' still works", () => {
  const onApplyCorrections = jest.fn();
  render(<Harness onApplyCorrections={onApplyCorrections} />);
  untick("Ownership type");
  expect(screen.getByTestId("ownership-fork-panel")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("ownership-misclassified"));
  expect(screen.getByTestId("correct-ownershipType")).toHaveValue("private_limited");
  expect(screen.queryByTestId("ownership-fork-panel")).not.toBeInTheDocument();
  fireEvent.change(screen.getByTestId("correct-ownershipType"), { target: { value: "public_listed" } });
  fireEvent.click(screen.getByTestId("facts-apply-corrections"));
  expect(onApplyCorrections).toHaveBeenCalledWith({ ownershipType: "public_listed" });
});

test("ownership 'genuinely changed' fork is unchanged", () => {
  render(<Harness />);
  untick("Ownership type");
  fireEvent.click(screen.getByTestId("ownership-genuinely-changed"));
  expect(screen.getByTestId("ownership-changed-panel")).toBeInTheDocument();
  expect(screen.queryByTestId("correct-ownershipType")).not.toBeInTheDocument();
});

test("registration number: 'you got it wrong' opens a correction input", () => {
  const onApplyCorrections = jest.fn();
  render(<Harness onApplyCorrections={onApplyCorrections} />);
  untick("Registration / company number");
  fireEvent.click(screen.getByTestId("regnumber-misclassified"));
  const input = screen.getByTestId("correct-registrationNumber");
  expect(input).toHaveValue("01234567");
  fireEvent.change(input, { target: { value: "07654321" } });
  fireEvent.click(screen.getByTestId("facts-apply-corrections"));
  expect(onApplyCorrections).toHaveBeenCalledWith({ registrationNumber: "07654321" });
});

test("re-ticking a fact removes its input; cancel clears everything", () => {
  render(<Harness />);
  untick("Company legal name");
  untick("Company legal name");
  expect(screen.queryByTestId("correct-companyName")).not.toBeInTheDocument();
  untick("Entity type");
  fireEvent.click(screen.getByTestId("facts-corrections-cancel"));
  expect(screen.queryByTestId("facts-corrections-panel")).not.toBeInTheDocument();
  screen.getAllByRole("checkbox").forEach((cb) => expect(cb).toBeChecked());
});

test("busy state disables the button and relabels it; the error is shown", () => {
  render(<Harness correctionBusy correctionError="Something went wrong" />);
  untick("Company legal name");
  fireEvent.change(screen.getByTestId("correct-companyName"), { target: { value: "Other Ltd" } });
  const button = screen.getByTestId("facts-apply-corrections");
  expect(button).toBeDisabled();
  expect(button).toHaveTextContent(/Updating your details/);
  expect(screen.getByTestId("facts-corrections-error")).toHaveTextContent("Something went wrong");
});

test("a save error shows even when no fact is being corrected (the deferred save failed after the panel closed)", () => {
  render(<Harness correctionError="We updated your details but couldn't save them. Please try again." />);
  expect(screen.queryByTestId("facts-corrections-panel")).not.toBeInTheDocument();
  expect(screen.getByTestId("facts-corrections-error")).toHaveTextContent(/couldn't save them/);
});

test("readOnly (analyst Preview) disables every checkbox and hides correction and fork actions", () => {
  render(<Harness readOnly initialChecks={{ companyName: false, ownershipType: false }} initialOwnershipFork="choose" />);
  screen.getAllByRole("checkbox").forEach((cb) => expect(cb).toBeDisabled());
  expect(screen.queryByTestId("correct-companyName")).not.toBeInTheDocument();
  expect(screen.queryByTestId("facts-corrections-panel")).not.toBeInTheDocument();
  expect(screen.queryByTestId("ownership-fork-panel")).not.toBeInTheDocument();
  expect(screen.queryByTestId("ownership-misclassified")).not.toBeInTheDocument();
});
