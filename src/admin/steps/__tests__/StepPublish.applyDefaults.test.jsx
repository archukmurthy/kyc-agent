import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StepPublish from "../StepPublish";

const CONFIG = {
  _version: 2,
  licences: [{ id: "GB", jurisdictionCode: "GB" }],
  entityTypes: [{ id: "Corporate", active: true }],
  schemas: { "Corporate:GB": { researchFields: [{ field: "a" }], gapFields: [] } },
  documents: {},
  company: { name: "Acme" },
};

beforeEach(() => {
  window.history.pushState({}, "", "/admin?tenant=acme");
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        templateId: "nium-default",
        config: { _templateId: "nium-default", licences: [{ id: "GB" }, { id: "SG" }], entityTypes: [], schemas: {}, company: { name: "" } },
      }),
    })
  );
  window.confirm = jest.fn(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

test("Apply default settings loads the template into the draft without publishing", async () => {
  const onChange = jest.fn();
  render(<StepPublish config={CONFIG} onChange={onChange} adminToken="tok" tenantId="acme" />);

  fireEvent.click(screen.getByRole("button", { name: /Apply default settings/i }));

  await waitFor(() => expect(onChange).toHaveBeenCalled());
  const applied = onChange.mock.calls[0][0];
  expect(applied._templateId).toBe("nium-default");
  // The template is fetched, never published: no POST to /api/config.
  const posted = global.fetch.mock.calls.filter(([, opts]) => opts && opts.method === "POST");
  expect(posted).toHaveLength(0);
});

test("declining the confirmation leaves the draft untouched", async () => {
  window.confirm = jest.fn(() => false);
  const onChange = jest.fn();
  render(<StepPublish config={CONFIG} onChange={onChange} adminToken="tok" tenantId="acme" />);

  fireEvent.click(screen.getByRole("button", { name: /Apply default settings/i }));

  expect(onChange).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});
