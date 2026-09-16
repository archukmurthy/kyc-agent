import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import TenantCard from "../TenantCard";

const noop = () => {};

test("the platform tenant's URLs still carry ?tenant= (they used to drop it)", () => {
  render(
    <TenantCard
      tenant={{ tenantId: "nium", companyName: "Nium", isInternal: true, isActive: true }}
      onResetPassword={noop}
      onToggleStatus={noop}
      onTogglePreboarding={noop}
    />
  );
  const text = document.body.textContent || "";
  expect(text).toContain("/admin?tenant=nium");
  expect(text).toContain("/?tenant=nium");
});

test("an ordinary tenant's URLs carry its own id", () => {
  render(
    <TenantCard
      tenant={{ tenantId: "acme", companyName: "Acme", isActive: true }}
      onResetPassword={noop}
      onToggleStatus={noop}
      onTogglePreboarding={noop}
    />
  );
  const text = document.body.textContent || "";
  expect(text).toContain("/admin?tenant=acme");
  expect(text).toContain("/?tenant=acme");
  expect(text).not.toContain("tenant=nium");
});
