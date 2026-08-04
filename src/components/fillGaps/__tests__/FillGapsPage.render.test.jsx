/**
 * FillGapsPage.render.test.jsx — CHARACTERISATION of the Fill Gaps SHELL while
 * it is still inline JSX in App.js.
 *
 * WHY NOW: slice 2 of the Fill Gaps extraction lifts the shell — gapSectionOrder,
 * renderGapSection, and the page's own JSX — into FillGapsPage.jsx. Unlike every
 * extraction before it, there is NO renderFillGaps() function to relocate: the
 * page is inline JSX, so slice 2 AUTHORS the component boundary rather than
 * inheriting one. That is exactly the kind of move a net has to cover, because
 * "I moved a function" is checkable by eye and "I invented a boundary" is not.
 *
 * SCOPE: the shell ONLY. The stakeholder cluster landed in slice 1 with its own
 * green oracle (StakeholderGapForms.render.test.jsx, 29 tests), so the deep
 * person-card assertions belong there, not here. This file asserts the surface
 * AROUND them — the gap sections, the gapRef wiring, the Continue gate, and the
 * fact that the stakeholder component is still mounted at all.
 *
 * The page cannot be rendered in isolation (the shell closes over App's state,
 * gapRef and the schema), so this drives the REAL app through the wizard, the
 * same harness the stakeholder net uses: Input → Applicant → Confirm → Fill Gaps.
 *
 * CHARACTERISATION, not specification: these assert what the shell does TODAY.
 * A surprising assertion is a recorded fact. After the extraction this file must
 * stay green UNCHANGED — editing it to make the move pass defeats the point.
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

const buttonsWithText = (text) =>
  Array.from(document.querySelectorAll("button")).filter(
    (b) => (b.textContent || "").trim() === text
  );

/**
 * Confirm's footer gate blocks on every row/person still needing input. Clear it
 * the way a customer does: the per-person "Confirm all" controls, then every
 * remaining row tick. Looped because confirming a person re-renders and reveals
 * the next batch. (Mirrors the stakeholder net's helper.)
 */
async function satisfyConfirmGate() {
  for (let pass = 0; pass < 4; pass += 1) {
    buttonsWithText("✓ Confirm all").forEach((b) => fireEvent.click(b));
    await settle(0);
    buttonsWithText("✓").forEach((b) => fireEvent.click(b));
    await settle(0);
    const cont = Array.from(document.querySelectorAll("button")).find((b) =>
      /Confirm and Continue/.test(b.textContent || "")
    );
    if (cont) return cont;
  }
  throw new Error("Confirm gate never opened — the driver, not the shell, is broken");
}

/** Company → dummy research → Applicant → Confirm → Fill Gaps. */
async function driveToFillGaps() {
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

  // SearchableSelect opens on FOCUS, not click — fireEvent.click does not focus
  // in jsdom.
  fireEvent.focus(screen.getByPlaceholderText(/Select ownership type/i));
  pickOption("Private Limited Company");

  fireEvent.change(screen.getByPlaceholderText(/Select or type country/i), {
    target: { value: "United King" },
  });
  pickOption("GB — United Kingdom");

  fireEvent.click(screen.getByRole("button", { name: /Dummy Research/i }));
  await settle(5000);

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

  fireEvent.click(await satisfyConfirmGate());
  await settle(0);
}

/** The card a gap section renders into — the <h3>'s parent. */
const gapSection = (heading) =>
  screen.getByRole("heading", { level: 3, name: heading }).parentElement;

/** Section headings in DOM order, so ordering can be asserted as ordering. */
const sectionHeadings = () =>
  Array.from(document.querySelectorAll("h3")).map((h) => h.textContent.trim());

const continueBtn = () => screen.getByRole("button", { name: /Continue to Documents/i });

describe("the Fill Gaps shell", () => {
  it("renders under the four-condition guard", async () => {
    await driveToFillGaps();
    expect(screen.getByText(/Additional Information Required/)).toBeInTheDocument();
    // jurisdictionBadge + entityBadge ride in the same heading.
    const h2 = screen.getByRole("heading", { level: 2, name: /Additional Information Required/ });
    expect(within(h2).getByText(/United Kingdom/)).toBeInTheDocument();
    expect(within(h2).getByText("Corporate")).toBeInTheDocument();
  });

  it("counts the outstanding gaps, excluding the documents section", async () => {
    await driveToFillGaps();
    // getCombinedGaps().filter(g => g.section !== "documents").length
    expect(screen.getByText("17 fields need your input")).toBeInTheDocument();
  });

  it("renders the test-data control and both navigation controls", async () => {
    await driveToFillGaps();
    expect(screen.getByRole("button", { name: /Fill with test data/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to Review/i })).toBeInTheDocument();
    expect(continueBtn()).toBeInTheDocument();
  });

  it("goes Back to Review", async () => {
    await driveToFillGaps();
    fireEvent.click(screen.getByRole("button", { name: /Back to Review/i }));
    await settle(0);
    expect(screen.getByText("People Found")).toBeInTheDocument();
    expect(screen.queryByText(/Additional Information Required/)).not.toBeInTheDocument();
  });

  it("renders no amendment-documents panel when nothing was corrected", async () => {
    await driveToFillGaps();
    // AmendmentDocuments renders nothing for an empty list — a mount point that
    // is present but silent, which is what this journey produces.
    expect(screen.queryByTestId("amendment-documents")).not.toBeInTheDocument();
  });
});

describe("renderGapSection", () => {
  it("renders a card per populated section, with its icon, title and subtitle", async () => {
    await driveToFillGaps();
    const stakeholders = gapSection("👥 Stakeholders & Transaction Mix");
    expect(
      within(stakeholders).getByText("Directors, UBOs, signatories and payment-mix breakdown")
    ).toBeInTheDocument();
    const account = gapSection("💰 Expected Account Usage");
    expect(
      within(account).getByText("Transaction volumes, purpose, and source of funds")
    ).toBeInTheDocument();
  });

  it("orders sections by gapSectionOrder's pinned list", async () => {
    await driveToFillGaps();
    const headings = sectionHeadings();
    // "stakeholders" precedes "account" in the pinned order.
    expect(headings.indexOf("👥 Stakeholders & Transaction Mix")).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf("💰 Expected Account Usage")).toBeGreaterThan(
      headings.indexOf("👥 Stakeholders & Transaction Mix")
    );
  });

  it("EXCLUDES the applicant section — it was collected on the Applicant page", async () => {
    await driveToFillGaps();
    // The call site filters s !== "applicant" before mapping.
    expect(screen.queryByText("Applicant Details")).not.toBeInTheDocument();
    expect(screen.queryByText(/Person authorised to submit this application/)).not.toBeInTheDocument();
  });

  it("HIDES the documents section, which renderGapSection short-circuits", async () => {
    await driveToFillGaps();
    expect(screen.queryByText(/Additional Documents/)).not.toBeInTheDocument();
    expect(screen.queryByText("Upload supporting documentation")).not.toBeInTheDocument();
  });

  it("lays a twoCol section out as a two-column grid", async () => {
    await driveToFillGaps();
    const grid = gapSection("👥 Stakeholders & Transaction Mix").querySelector(
      'div[style*="grid-template-columns"]'
    );
    expect(grid).toBeTruthy();
    expect(grid).toHaveStyle({ display: "grid" });
  });

  it("does NOT grid a section whose config says twoCol: false", async () => {
    await driveToFillGaps();
    // account is twoCol:false in sectionConfig, so its field wrapper gets {}.
    const grid = gapSection("💰 Expected Account Usage").querySelector(
      'div[style*="grid-template-columns"]'
    );
    expect(grid).toBeNull();
  });

  it("renders the gap fields, addressed by their derived placeholder", async () => {
    await driveToFillGaps();
    // placeholder = g.placeholder || ("Enter " + g.label.toLowerCase()) —
    // StableInput sets no DOM id and its label is not associated with the input.
    ["Enter intended use of account", "Enter source of funds",
     "Enter top credit transaction countries", "Enter top debit transaction countries"]
      .forEach((p) => expect(screen.getByPlaceholderText(p)).toBeInTheDocument());
    // A schema-supplied placeholder wins over the derived one.
    expect(
      screen.getByPlaceholderText(/For each director or officer, include/)
    ).toBeInTheDocument();
  });

  it("marks a required gap field with an asterisk", async () => {
    await driveToFillGaps();
    const account = gapSection("💰 Expected Account Usage");
    expect(within(account).getByText(/Intended Use of Account/)).toBeInTheDocument();
    expect(within(account).getAllByText("*").length).toBeGreaterThan(0);
  });
});

describe("the gapRef wiring", () => {
  it("keeps a value typed into a gap field", async () => {
    await driveToFillGaps();
    const field = screen.getByPlaceholderText("Enter intended use of account");
    fireEvent.change(field, { target: { value: "Supplier payments" } });
    await settle(0);
    expect(field.value).toBe("Supplier payments");
  });

  it("fills every gap field from the test-data control", async () => {
    await driveToFillGaps();
    const before = screen.getByPlaceholderText("Enter intended use of account");
    expect(before.value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /Fill with test data/i }));
    await settle(0);

    // fillTestData writes gapRef.current directly and bumps setFormVersion; the
    // inputs only re-read from the ref because of that bump, so a value showing
    // here proves the manual-invalidation path still works.
    ["Enter intended use of account", "Enter source of funds",
     "Enter top credit transaction countries"].forEach((p) => {
      expect(screen.getByPlaceholderText(p).value.trim().length).toBeGreaterThan(0);
    });
  });
});

describe("the Continue gate — two refusals, asserted separately", () => {
  it("(a) refuses on stakeholder errors, listing each one", async () => {
    await driveToFillGaps();
    fireEvent.click(continueBtn());
    await settle(0);

    // validateStakeholders() runs FIRST and short-circuits, so this is the
    // refusal an incomplete person card produces.
    expect(screen.getByText("Please fix the following before continuing:")).toBeInTheDocument();
    expect(screen.getByText("Please enter nationality for Trustees.")).toBeInTheDocument();
    expect(screen.getByText("Please answer the PEP question for Trustees.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(1);
    // Refusal (a) never shows refusal (b)'s message.
    expect(screen.queryByText("Please fill all required fields.")).not.toBeInTheDocument();
    expect(screen.getByText(/Additional Information Required/)).toBeInTheDocument();
  });

  it("(b) refuses on an unfilled required gap, once the people are valid", async () => {
    await driveToFillGaps();
    // Test data satisfies every person card AND every gap, so clearing one
    // required gap isolates the allGapsFilled() branch from the people branch.
    fireEvent.click(screen.getByRole("button", { name: /Fill with test data/i }));
    await settle(0);
    fireEvent.change(screen.getByPlaceholderText("Enter intended use of account"), {
      target: { value: "" },
    });
    await settle(0);

    fireEvent.click(continueBtn());
    await settle(0);

    expect(screen.getByText("Please fill all required fields.")).toBeInTheDocument();
    // Refusal (b) never shows refusal (a)'s banner — which is how a failure here
    // names WHICH gate broke.
    expect(
      screen.queryByText("Please fix the following before continuing:")
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Additional Information Required/)).toBeInTheDocument();
  });

  it("advances to Required Documents when both gates are satisfied", async () => {
    await driveToFillGaps();
    fireEvent.click(screen.getByRole("button", { name: /Fill with test data/i }));
    await settle(0);

    fireEvent.click(continueBtn());
    await settle(0);

    expect(screen.queryByText(/Additional Information Required/)).not.toBeInTheDocument();
    expect(screen.getByText(/Required Documents/)).toBeInTheDocument();
  });
});

describe("the StakeholderGapForms mount", () => {
  // Light on purpose: the cluster's own oracle (StakeholderGapForms.render.test.jsx,
  // 29 tests) owns the deep assertions. All this pins is that the shell still
  // mounts it and renders what it returns — the thing slice 2 could break.
  it("still renders the extracted stakeholder component below the gap sections", async () => {
    await driveToFillGaps();
    expect(screen.getByText("People — additional details needed")).toBeInTheDocument();
    expect(screen.getByText(/UBO \/ Ownership Analysis/)).toBeInTheDocument();
    expect(screen.getAllByText("Trustees").length).toBeGreaterThan(0);
  });

  it("mounts it AFTER the gap sections, in the shell's own order", async () => {
    await driveToFillGaps();
    const headings = sectionHeadings();
    expect(headings.indexOf("👥 UBO / Ownership Analysis")).toBeGreaterThan(
      headings.indexOf("💰 Expected Account Usage")
    );
  });
});
