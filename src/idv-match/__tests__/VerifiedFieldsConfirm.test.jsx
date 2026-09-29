import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import VerifiedFieldsConfirm from "../VerifiedFieldsConfirm";

test("shows verified fields and confirms them", () => {
  const onConfirm = jest.fn();
  render(<VerifiedFieldsConfirm fields={{ firstName: "John", lastName: "Smith", documentNumber: "X123", gender: "M" }} onConfirm={onConfirm} />);
  expect(screen.getByText("John")).toBeInTheDocument();
  expect(screen.getByText("X123")).toBeInTheDocument();
  expect(screen.getByText("Confirm your verified details")).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Confirm & continue/));
  expect(onConfirm).toHaveBeenCalledWith({ firstName: "John", lastName: "Smith", documentNumber: "X123", gender: "M" });
});

test("a wrong field can be edited before confirming", () => {
  const onConfirm = jest.fn();
  render(<VerifiedFieldsConfirm fields={{ firstName: "Jon", lastName: "Smith" }} onConfirm={onConfirm} />);
  fireEvent.click(screen.getAllByText("Edit")[0]); // first name
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "John" } });
  fireEvent.click(screen.getByText(/Confirm & continue/));
  expect(onConfirm).toHaveBeenCalledWith({ firstName: "John", lastName: "Smith" });
});
