/**
 * ConfirmStep.render.test.jsx — CHARACTERISATION tests for the Confirm page.
 *
 * These assert what the page does TODAY. They are a baseline, not a
 * specification: if something here looks odd, the test is doing its job by
 * recording it, and the fix belongs in a separate change that deliberately
 * updates the test alongside the code.
 *
 * WHY: ~1,400 lines of Confirm render logic live in App.js with no render
 * coverage — every other test in this repo is pure logic. Any future extraction
 * would be a blind refactor. With this net, an extraction can be done in slices
 * and proved behaviour-identical after each one.
 *
 * SCOPE — this file covers the ConfirmStep SHELL, which is what is already a
 * separate component: the tiles, the header and its hover tooltips, the
 * documents panel, the pre-submit summary and the submit gate. The found-row
 * table and the People section are injected as render-function PROPS from
 * App.js, so they are characterised in ConfirmPeople.render.test.jsx by driving
 * the real app.
 *
 * Counts are supplied as props here (App.js derives them via confirmState,
 * which has its own 100+ tests) — so these tests characterise how the shell
 * PRESENTS state, not how state is derived.
 */

import React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ConfirmStep } from "../ConfirmStep";

// ── Fixtures — the dummy-research shape the app itself ships ──────────────
const foundRow = (over = {}) => ({
  field: "tradeName",
  label: "Trade Name",
  value: "ACME Holdings",
  source: "Companies House",
  sourceTier: "tier1",
  verificationStatus: "verified",
  ...over,
});

const REGULAR = [
  { item: foundRow(), idx: 0 },
  { item: foundRow({ field: "leiNumber", label: "LEI Number", value: "529900T8BM49AURSDO55", source: "Annual Report", sourceTier: "tier2", verificationStatus: "probable" }), idx: 1 },
];

const STEPS = { input: 0, research: 1, applicant: 2, confirm: 3, fillGaps: 4, declare: 5 };

function renderConfirm(over = {}) {
  const props = {
    research: { companyName: "Britannia Group Limited", found: [foundRow(), foundRow({ field: "leiNumber" })] },
    companyName: "Britannia Group Limited",
    coverage: null,
    ownershipType: "private_limited",
    journeyType: "ai_only",
    servedFromCache: false,
    cachedAt: null,
    checks: { 0: true, 1: true },
    confirmCounts: { needsYou: 4, confirmed: 17, corrected: 0, docsNeeded: 0, docsTotal: 0 },
    confirmDocs: [],
    amendmentUploads: {},
    uploadingDocKey: null,
    onAmendmentUpload: jest.fn(),
    onAmendmentRemove: jest.fn(),
    blockers: [],
    blockerMessage: null,
    isPubliclyListedOverride: false,
    setIsPubliclyListedOverride: jest.fn(),
    sortedFound: [foundRow(), foundRow({ field: "leiNumber" })],
    stakeholderFound: [],
    regularFound: REGULAR,
    docCount: 0,
    tier1Count: 18,
    tier2Count: 3,
    tier3Count: 2,
    prefill: { total: 52, document: 0, tier1: 27, tier2: 15, tier3: 10, unverified: 25, other: 0 },
    jurisdictionBadge: <span>🇬🇧 United Kingdom</span>,
    entityBadge: <span>Corporate</span>,
    cardStyle: {},
    STEPS,
    stepsFor: () => [],
    setStep: jest.fn(),
    setCompanyName: jest.fn(),
    setJourneyOpen: jest.fn(),
    setSelectedJourneyCard: jest.fn(),
    setJourneyType: jest.fn(),
    setError: jest.fn(),
    scrollAndSetStep: jest.fn(),
    renderStakeholderConfirmSection: jest.fn(() => <div>PEOPLE SECTION</div>),
    renderUnifiedFoundTable: jest.fn(() => <div>FOUND TABLE</div>),
    renderAddPerson: jest.fn(() => <div>ADD PERSON</div>),
    ...over,
  };
  return { ...render(<ConfirmStep {...props} />), props };
}

/** The tile row: each tile is a value + an uppercase label. */
const tileValue = (label) => {
  const node = screen.getByText(label, { selector: "div" });
  return within(node.parentElement).getAllByText(/^\d+$/)[0].textContent;
};

describe("the four summary tiles", () => {
  it("renders all four with the supplied counts", () => {
    renderConfirm();
    expect(tileValue("Needs You")).toBe("4");
    expect(tileValue("Confirmed")).toBe("17");
    expect(tileValue("Corrected")).toBe("0");
    expect(tileValue("Docs Needed")).toBe("0");
  });

  it("renders a zero tile rather than hiding it", () => {
    renderConfirm({ confirmCounts: { needsYou: 0, confirmed: 0, corrected: 0, docsNeeded: 0 } });
    ["Needs You", "Confirmed", "Corrected", "Docs Needed"].forEach((l) =>
      expect(screen.getByText(l)).toBeInTheDocument()
    );
  });
});

describe("the header", () => {
  it("shows the company name with the jurisdiction and entity badges", () => {
    renderConfirm();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Britannia Group Limited");
    expect(screen.getByText("🇬🇧 United Kingdom")).toBeInTheDocument();
    expect(screen.getByText("Corporate")).toBeInTheDocument();
  });

  it("carries NO permanent 'items need your input' pill — it was removed", () => {
    renderConfirm();
    // Case-SENSITIVE: the removed pill was uppercase ("4 ITEMS NEED YOUR
    // INPUT"). The reassurance line below the name still says "…items need
    // your input" in sentence case, and that one is meant to be there.
    expect(screen.queryByText(/ITEMS? NEEDS? YOUR INPUT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ALL ITEMS REVIEWED/)).not.toBeInTheDocument();
  });

  it("adapts the reassurance line to whether anything is outstanding", () => {
    const { unmount } = renderConfirm();
    expect(screen.getByText(/Only a few items need your input/)).toBeInTheDocument();
    unmount();
    renderConfirm({ confirmCounts: { needsYou: 0, confirmed: 21, corrected: 0, docsNeeded: 0 } });
    expect(screen.getByText(/Nothing needs your input/)).toBeInTheDocument();
  });
});

describe("hover tooltips — hidden by default, shown on hover, no layout shift", () => {
  // The name appears twice — the tooltip trigger in the <h2>, and a <strong>
  // in the reassurance line — so the trigger must be addressed via the heading.
  const nameTrigger = () =>
    within(screen.getByRole("heading", { level: 2 })).getByText("Britannia Group Limited");

  it("hides the pre-fill breakdown until the company name is hovered", () => {
    renderConfirm();
    expect(screen.queryByText(/fields pre-filled/)).not.toBeInTheDocument();
    fireEvent.mouseEnter(nameTrigger());
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("52 fields pre-filled");
    expect(tip).toHaveTextContent("0 from documents");
    expect(tip).toHaveTextContent("27 from official sources");
    expect(tip).toHaveTextContent("25 from company or unverified sources");
    fireEvent.mouseLeave(nameTrigger());
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("puts the coaching copy on the Needs You tile, not in the page flow", () => {
    renderConfirm();
    expect(screen.queryByText(/Amber rows came from company or unverified sources/)).not.toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByText("Needs You").parentElement);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("👋");
    expect(tip).toHaveTextContent("4 items need your input");
    expect(tip).toHaveTextContent(/Amber rows came from company or unverified sources/);
  });

  it("floats the tooltip out of flow so it cannot reflow the page", () => {
    renderConfirm();
    fireEvent.mouseEnter(nameTrigger());
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveStyle({ position: "absolute", pointerEvents: "none" });
  });
});

describe("the found table and People section are injected by App.js", () => {
  it("renders the found table only when there are regular rows", () => {
    const { props } = renderConfirm();
    expect(screen.getByText("FOUND TABLE")).toBeInTheDocument();
    expect(props.renderUnifiedFoundTable).toHaveBeenCalledWith(
      REGULAR, "Pre-filled Fields", expect.any(String)
    );
  });

  it("renders the People section only when stakeholders exist", () => {
    renderConfirm();
    expect(screen.queryByText("People Found")).not.toBeInTheDocument();
    renderConfirm({ stakeholderFound: [{ item: { field: "directors" }, idx: 0 }] });
    expect(screen.getByText("People Found")).toBeInTheDocument();
    expect(screen.getByText("PEOPLE SECTION")).toBeInTheDocument();
  });

  it("does NOT render the add-a-person panel — it was removed from this page", () => {
    renderConfirm({ stakeholderFound: [{ item: { field: "directors" }, idx: 0 }] });
    expect(screen.queryByText("ADD PERSON")).not.toBeInTheDocument();
  });
});

describe("the documents panel", () => {
  const doc = (over = {}) => ({ fieldId: "addressLine1", docType: "Notice of Change of Address", stakeholderId: null, personName: null, ...over });

  it("shows a placeholder when nothing is owed", () => {
    renderConfirm();
    expect(screen.getByText(/None triggered yet/)).toBeInTheDocument();
  });

  it("lists an outstanding document and counts it in the heading", () => {
    renderConfirm({ confirmDocs: [doc()], confirmCounts: { needsYou: 0, confirmed: 5, corrected: 1, docsNeeded: 1 } });
    // CHARACTERISATION: the heading is sentence case in the DOM and only LOOKS
    // uppercase because of textTransform, so a test must not match on "DOCUMENTS
    // WE'LL NEED". Matching the count is the durable part.
    expect(screen.getByText(/Documents we.ll need \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("1 outstanding")).toBeInTheDocument();
  });

  it("attributes a person document to that person by name (the 6a behaviour)", () => {
    renderConfirm({
      confirmDocs: [
        doc({ fieldId: "ubo::sh_john::dob", docType: "Proof of Identity", stakeholderId: "sh_john", personName: "John Smith" }),
        doc({ fieldId: "ubo::sh_jane::dob", docType: "Proof of Identity", stakeholderId: "sh_jane", personName: "Jane Doe" }),
      ],
      confirmCounts: { needsYou: 0, confirmed: 5, corrected: 2, docsNeeded: 2 },
    });
    // Two separate entries of the SAME docType, one per person.
    expect(screen.getAllByText("Proof of Identity")).toHaveLength(2);
    expect(screen.getByText(/— John Smith/)).toBeInTheDocument();
    expect(screen.getByText(/— Jane Doe/)).toBeInTheDocument();
  });

  it("switches to 'All uploaded' once every document is satisfied", () => {
    renderConfirm({
      confirmDocs: [doc()],
      amendmentUploads: { "company::Notice of Change of Address": { name: "notice.pdf", uploadFailed: false } },
      confirmCounts: { needsYou: 0, confirmed: 5, corrected: 1, docsNeeded: 0 },
    });
    expect(screen.getByText("All uploaded")).toBeInTheDocument();
    expect(screen.getByText(/Uploaded — notice.pdf/)).toBeInTheDocument();
  });

  it("surfaces a failed upload rather than treating it as done", () => {
    renderConfirm({
      confirmDocs: [doc()],
      amendmentUploads: { "company::Notice of Change of Address": { name: "notice.pdf", uploadFailed: true } },
      confirmCounts: { needsYou: 0, confirmed: 5, corrected: 1, docsNeeded: 1 },
    });
    expect(screen.getByText(/Upload didn't store/)).toBeInTheDocument();
  });
});

describe("the pre-submit summary line", () => {
  it("states what is being confirmed, corrected and still outstanding", () => {
    renderConfirm({ confirmCounts: { needsYou: 4, confirmed: 17, corrected: 2, docsNeeded: 0 } });
    const line = screen.getByText(/You're confirming/).closest("div");
    expect(line).toHaveTextContent("17");
    expect(line).toHaveTextContent("correcting");
    expect(line).toHaveTextContent("still to review");
  });
});

describe("the submit gate", () => {
  it("blocks with the blocker message when anything is outstanding", () => {
    renderConfirm({
      blockers: [{ kind: "attention_row", fieldId: "leiNumber", label: "LEI Number" }],
      blockerMessage: "1 item needs your input",
    });
    const button = screen.getByRole("button", { name: "1 item needs your input" });
    expect(button).toBeDisabled();
    expect(screen.getByText("Resolve these to continue")).toBeInTheDocument();
  });

  it("enables and offers to continue when nothing is outstanding", () => {
    const { props } = renderConfirm({ blockers: [], blockerMessage: null });
    const button = screen.getByRole("button", { name: "Confirm and Continue" });
    expect(button).toBeEnabled();
    expect(screen.getByText("Everything's ready")).toBeInTheDocument();
    expect(screen.getByText("Nothing outstanding")).toBeInTheDocument();
    fireEvent.click(button);
    expect(props.scrollAndSetStep).toHaveBeenCalledWith(STEPS.fillGaps);
  });

  it("always offers Back to the Applicant page", () => {
    const { props } = renderConfirm();
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(props.scrollAndSetStep).toHaveBeenCalledWith(STEPS.applicant);
  });
});

describe("the cache badge", () => {
  it("appears only when the research was served from cache", () => {
    renderConfirm();
    expect(screen.queryByText(/Served from cache/)).not.toBeInTheDocument();
    renderConfirm({ servedFromCache: true, cachedAt: "2026-07-31T10:00:00.000Z" });
    expect(screen.getByText(/Served from cache/)).toBeInTheDocument();
  });
});
