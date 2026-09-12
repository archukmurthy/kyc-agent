import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import NoTenantLanding from "../NoTenantLanding";

describe("NoTenantLanding", () => {
  it("shows a neutral heading, explanation, and a ?tenant= hint", () => {
    render(<NoTenantLanding />);
    expect(screen.getByText("No tenant selected")).toBeInTheDocument();
    expect(screen.getByText(/tenant must be specified in the URL/i)).toBeInTheDocument();
    expect(screen.getByText("?tenant=<your-tenant-id>")).toBeInTheDocument();
  });

  it("names no real tenants — neutral branding only", () => {
    render(<NoTenantLanding />);
    const text = document.body.textContent || "";
    expect(text).not.toMatch(/nium/i);
  });
});
