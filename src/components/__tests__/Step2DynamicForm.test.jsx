/**
 * Step2DynamicForm.test.jsx - covers the persistence lift (App.js drives
 * `uploads` via initialUploads/onUploadsChange so it survives this component
 * unmounting on navigation) and the Continue-button relocation
 * (renderOwnContinue / onExposeContinue), both added alongside the Confirm
 * page's "Confirm All" button.
 */

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import Step2DynamicForm from "../Step2DynamicForm";

const CHECKLIST = [
  {
    requirement: "Certificate of Incorporation",
    standardDocument: "Certificate of Incorporation",
    mandatory: true,
    rfi: "Required from client",
    selfSource: "",
  },
  {
    requirement: "Proof of Address",
    standardDocument: "Proof of Address",
    mandatory: true,
    rfi: "Required from client",
    selfSource: "",
  },
];

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          onboardingCountry: "GB",
          checklist: CHECKLIST,
          rfiItems: CHECKLIST,
          selfSourceItems: [],
          mandatoryGaps: [],
          mandatoryCount: 2,
          flags: {},
        }),
    })
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

const step1Data = {
  companyName: "Britannia Group Limited",
  incorporationCountry: "United Kingdom",
  entityType: "Corporate",
  ownershipType: "Private Limited Company",
};

async function renderForm(props = {}) {
  const utils = render(
    <Step2DynamicForm
      step1Data={step1Data}
      onComplete={jest.fn()}
      docSearchResults={null}
      selfSourceResults={null}
      {...props}
    />
  );
  // useDocumentRequirements resolves the fetch asynchronously.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

describe("initialUploads seeds the cards as already uploaded", () => {
  it("renders a seeded requirement in its uploaded state, not the upload box", async () => {
    await renderForm({
      initialUploads: { "Certificate of Incorporation": { name: "coi.pdf", size: 2048 } },
    });
    expect(screen.getByText("coi.pdf")).toBeInTheDocument();
    // The un-seeded requirement is still asking for a file - only one card
    // ("Proof of Address" appears twice: the card title and its standard-
    // document line, since the fixture reuses the same string for both).
    expect(screen.getAllByText("Proof of Address").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Click to upload").length).toBe(1);
  });
});

describe("onUploadsChange fires on every upload/remove", () => {
  it("fires with the new map on upload", async () => {
    const onUploadsChange = jest.fn();
    await renderForm({ onUploadsChange });

    // Two cards, both un-uploaded, both showing "Click to upload" - the
    // checklist order (COI then POA) is the render order, so the second
    // file input belongs to Proof of Address.
    const poaInput = document.querySelectorAll('input[type="file"]')[1];
    const file = new File(["%PDF"], "poa.pdf", { type: "application/pdf" });
    fireEvent.change(poaInput, { target: { files: [file] } });

    expect(onUploadsChange).toHaveBeenCalledWith(
      expect.objectContaining({ "Proof of Address": file })
    );
  });

  it("fires with the file removed on remove", async () => {
    const onUploadsChange = jest.fn();
    await renderForm({
      initialUploads: { "Certificate of Incorporation": { name: "coi.pdf", size: 2048 } },
      onUploadsChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(onUploadsChange).toHaveBeenCalledWith(
      expect.not.objectContaining({ "Certificate of Incorporation": expect.anything() })
    );
    expect(onUploadsChange).toHaveBeenLastCalledWith({});
  });
});

describe("Continue can move outside this component", () => {
  it("hides its own Continue button and exposes a working handleContinue when renderOwnContinue is false", async () => {
    const onExposeContinue = jest.fn();
    const onComplete = jest.fn();
    await renderForm({ renderOwnContinue: false, onExposeContinue, onComplete });

    expect(screen.queryByRole("button", { name: "Continue →" })).not.toBeInTheDocument();
    expect(onExposeContinue).toHaveBeenCalledWith(expect.any(Function));

    // The exposed function IS handleContinue - calling it behaves exactly
    // like clicking the (now-hidden) internal button would have.
    const exposed = onExposeContinue.mock.calls[onExposeContinue.mock.calls.length - 1][0];
    act(() => exposed());
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ checklist: CHECKLIST })
    );
  });

  it("still renders its own Continue button by default", async () => {
    await renderForm();
    expect(screen.getByRole("button", { name: "Continue →" })).toBeInTheDocument();
  });
});
