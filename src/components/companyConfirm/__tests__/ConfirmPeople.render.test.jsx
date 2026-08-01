/**
 * ConfirmPeople.render.test.jsx — CHARACTERISATION of the Confirm page parts
 * that still render from App.js.
 *
 * ConfirmStep.render.test.jsx covers the shell. Everything below it — the
 * pre-filled row table, the source badges, the People cards and their
 * per-attribute rows — is injected into ConfirmStep as render-function PROPS
 * (renderUnifiedFoundTable / renderStakeholderConfirmSection), which close over
 * App's state and refs. They cannot be rendered in isolation, so this file
 * drives the REAL app through the wizard to the Confirm step.
 *
 * That is precisely why this net matters: those ~1,400 lines are the ones a
 * future extraction has to move, and this is the only thing that would notice
 * if the move changed behaviour.
 *
 * Assert what the page does TODAY. A surprising assertion here is a recorded
 * fact, not a bug to fix in this file.
 */

import React from "react";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import KYCAgent from "../../../App";

jest.setTimeout(60000);

beforeEach(() => {
  // /api/config, track-event and ipify fire on mount. Rejecting them makes the
  // app fall back to buildLocalDefaultConfig(), which ships the Corporate:GB
  // schema — deterministic, no network.
  global.fetch = jest.fn(() => Promise.reject(new Error("offline test")));
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Pick an option out of a SearchableSelect (it commits on mousedown). */
function pickOption(labelText) {
  const option = screen
    .getAllByText(labelText, { exact: false })
    .find((el) => el.children.length === 0);
  expect(option).toBeTruthy();
  fireEvent.mouseDown(option.parentElement);
}

const settle = async (ms = 5000) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

/** Company → dummy research → Applicant → Confirm. */
async function driveToConfirm() {
  await act(async () => {
    render(<KYCAgent />);
  });
  await settle(0);

  fireEvent.change(screen.getByPlaceholderText(/Tesco PLC/i), {
    target: { value: "Britannia Group Limited" },
  });

  fireEvent.change(screen.getByPlaceholderText(/Select or type entity type/i), {
    target: { value: "Corporate" },
  });
  pickOption("🏛 Corporate");

  // SearchableSelect opens on FOCUS, not click (see handleInputFocus). A
  // fireEvent.click does not focus in jsdom, so focus explicitly.
  fireEvent.focus(screen.getByPlaceholderText(/Select ownership type/i));
  pickOption("Private Limited Company");

  fireEvent.change(screen.getByPlaceholderText(/Select or type country/i), {
    target: { value: "United King" },
  });
  pickOption("GB — United Kingdom");

  fireEvent.click(screen.getByRole("button", { name: /Dummy Research/i }));
  await settle(5000);

  // Applicant page — fill via the test-data control, satisfy the signatory
  // upload, continue.
  fireEvent.click(screen.getByRole("button", { name: /Fill with test data/i }));
  const fileInput = document.querySelector('input[type="file"]');
  if (fileInput) {
    fireEvent.change(fileInput, {
      target: { files: [new File(["%PDF"], "id.pdf", { type: "application/pdf" })] },
    });
  }
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: /^Continue/i }));
  await settle(0);
}

describe("driving the app to Confirm", () => {
  it("reaches the Confirm step with the People section rendered", async () => {
    await driveToConfirm();
    expect(screen.getByText("People Found")).toBeInTheDocument();
    expect(screen.getByText("Pre-filled Fields")).toBeInTheDocument();
  });
});

describe("the pre-filled row table", () => {
  it("renders a high-confidence row confirmed, with the tick/pencil pair", async () => {
    await driveToConfirm();
    // Trade Name is tier1 in the dummy set: settled, so ✓ + ✎ (never ✕).
    expect(screen.getByText("ACME Holdings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Trade Name" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Trade Name" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Trade Name as incorrect" })).not.toBeInTheDocument();
  });

  it("renders a low-confidence row needing attention, with the tick/cross pair", async () => {
    await driveToConfirm();
    // LEI Number is tier2 in the dummy set: unsettled, so ✓ + ✕ (never ✎).
    expect(screen.getByRole("button", { name: "Mark LEI Number as incorrect" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit LEI Number" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/please confirm this is correct/i).length).toBeGreaterThan(0);
  });

  it("renders the source badge with the source name, click-to-reveal", async () => {
    await driveToConfirm();
    const badges = screen.getAllByTitle(/Click to show fetch timestamp/i);
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.some((b) => /Companies House/.test(b.textContent))).toBe(true);
  });

  it("makes the two gate-confirmed rows read-only (no controls at all)", async () => {
    await driveToConfirm();
    // Settled on the Applicant page's five-fact gate, so Confirm shows them
    // without a control pair.
    expect(screen.getByText("Private Limited Company")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm Business Type" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm Companies House Number" })).not.toBeInTheDocument();
  });
});

describe("the People section", () => {
  it("renders a card per stakeholder with a confirm checkbox", async () => {
    await driveToConfirm();
    expect(screen.getAllByLabelText(/^Confirm John Smith/).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/^Confirm Jane Doe/).length).toBeGreaterThan(0);
  });

  it("renders per-attribute rows with their control pair once expanded", async () => {
    await driveToConfirm();
    fireEvent.click(screen.getAllByRole("button", { name: /Expand all/i })[0]);
    await settle(0);
    expect(screen.getAllByRole("button", { name: "Confirm Full legal name" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Confirm Nationality" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Confirm Date of birth" }).length).toBeGreaterThan(0);
  });

  it("badges a person whose data needs confirming, and leaves a settled one unbadged", async () => {
    await driveToConfirm();
    // The Investor Relations directors are tier2, so every attribute needs an
    // explicit tick and those cards carry a "N need you" badge. Companies
    // House people are tier1 and carry none.
    const badges = screen.queryAllByText(/\d+ needs? you/);
    expect(badges.length).toBeGreaterThan(0);
    // No "Complete" badge exists any more — having nothing to say says nothing.
    expect(screen.queryByText(/✓ Complete/)).not.toBeInTheDocument();
  });

  it("tags an attribute research did not return as next-page work, in green", async () => {
    await driveToConfirm();
    fireEvent.click(screen.getAllByRole("button", { name: /Expand all/i })[0]);
    await settle(0);
    expect(screen.getAllByText("collected on next page").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/On the next page you'll complete:/).length).toBeGreaterThan(0);
  });

  it("does NOT offer the add-a-person panel on this page", async () => {
    await driveToConfirm();
    expect(screen.queryByText(/Add a director or beneficial owner we missed/i)).not.toBeInTheDocument();
  });
});

describe("the tiles reflect the real derived counts", () => {
  it("renders four tiles whose values are numbers derived from the fixture", async () => {
    await driveToConfirm();
    ["Needs You", "Confirmed", "Corrected", "Docs Needed"].forEach((label) => {
      const tile = screen.getByText(label).parentElement;
      expect(within(tile).getAllByText(/^\d+$/)[0]).toBeInTheDocument();
    });
    // Nothing has been touched yet, so nothing is corrected.
    const corrected = screen.getByText("Corrected").parentElement;
    expect(within(corrected).getAllByText(/^\d+$/)[0]).toHaveTextContent("0");
  });
});

describe("the submit gate on real data", () => {
  it("blocks while low-confidence rows are unresolved", async () => {
    await driveToConfirm();
    const back = screen.getByRole("button", { name: /← Back/ });
    const footer = back.parentElement;
    expect(within(footer).getByText(/Resolve these to continue/)).toBeInTheDocument();
    const cta = within(footer).getAllByRole("button").pop();
    expect(cta).toBeDisabled();
  });
});
