import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TenantCard from "../TenantCard";

const noop = () => {};

test("shows pre-boarding state and offers the opposite action", () => {
  const onTogglePreboarding = jest.fn();
  render(
    <TenantCard
      tenant={{ tenantId: "acme", companyName: "Acme", isActive: true, preboardingEnabled: false }}
      onResetPassword={noop}
      onToggleStatus={noop}
      onTogglePreboarding={onTogglePreboarding}
    />
  );

  expect(document.body.textContent).toMatch(/Pre-boarding:\s*Off/i);
  fireEvent.click(screen.getByRole("button", { name: /Enable pre-boarding/i }));
  expect(onTogglePreboarding).toHaveBeenCalledWith(
    expect.objectContaining({ tenantId: "acme" })
  );
});

test("an enabled tenant offers Disable", () => {
  render(
    <TenantCard
      tenant={{ tenantId: "acme", companyName: "Acme", isActive: true, preboardingEnabled: true }}
      onResetPassword={noop}
      onToggleStatus={noop}
      onTogglePreboarding={noop}
    />
  );
  expect(document.body.textContent).toMatch(/Pre-boarding:\s*On/i);
  expect(screen.getByRole("button", { name: /Disable pre-boarding/i })).toBeInTheDocument();
});
