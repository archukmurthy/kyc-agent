/**
 * AIDocumentsPage.render.test.jsx — CHARACTERISATION of the AI-Documents step
 * while it is still inline JSX in App.js.
 *
 * WHY NOW: extraction A lifts the `documents` step of the ai_documents journey
 * into components/aiDocuments/AIDocumentsPage.jsx. Like the Fill Gaps shell,
 * this page is an inline IIFE — {isAiDocs && step === STEPS.documents && (() =>
 * …)()} — so there is no named render function to relocate. A AUTHORS the
 * boundary rather than inheriting one, which is precisely the move a net has to
 * cover: "I moved a function" is checkable by eye, "I invented a boundary" is
 * not.
 *
 * A also moves two hoisted handlers that live ~1,350 lines away from the render
 * body — handleManualDocumentUpload / handleManualDocumentRemove. Those are the
 * likeliest thing to be dropped or mis-wired by the move, so the round-trip
 * through them is pinned explicitly below.
 *
 * THE HARNESS REACHES THIS STEP, unlike pre-boarding. The step is in the step
 * switch, and SHOW_TEST_TOOLS is `NODE_ENV !== "production"` — true under Jest —
 * so the entry effect takes its DEMO branch (buildDemoDocSearchResults +
 * buildDemoSelfSourceResults) and renders deterministically with NO network.
 * A consequence worth stating rather than being surprised by: the test-only
 * affordances ("Use demo data", "Run real agent", "Dummy search") DO render, and
 * are characterised here as part of current behaviour.
 *
 * JOURNEY MATTERS. The step only exists on the ai_documents journey, which is
 * journey card A. demoMode must stay OFF: proceedFromJourney short-circuits card
 * A straight to doDummyResearch when demoMode is set, skipping this step
 * entirely. The driver goes through the real picker for that reason.
 *
 * COVERAGE GAP, recorded honestly: the demo self-source fixture never sets
 * `captchaBlocked`, and the manual-upload affordance renders only behind
 * `e.captcha`. So the upload/remove round-trip is NOT reachable from the demo
 * journey. Rather than contort the harness, the round-trip block below drives
 * the app's own real path (the "Run real agent" button → runRealSelfSource) with
 * /api/self-source stubbed to return a captcha-blocked row. That is a fixture
 * variant, not a bypass: the component code under test is unchanged.
 *
 * CHARACTERISATION, not specification: these assert what the step does TODAY.
 * A surprising assertion is a recorded fact. After A's move this file must stay
 * green UNCHANGED — editing it to make the move pass defeats the point.
 */

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import KYCAgent from "../../../App";

jest.setTimeout(60000);

/** Endpoints the tests opt into resolving; everything else stays offline. */
let fetchRoutes = {};

beforeEach(() => {
  fetchRoutes = {};
  // /api/config, track-event and ipify fire on mount. Rejecting them makes the
  // app fall back to buildLocalDefaultConfig(), which ships the Corporate:GB
  // schema — deterministic, no network. Mirrors the other nets.
  global.fetch = jest.fn((url, opts) => {
    const key = Object.keys(fetchRoutes).find((k) => String(url).includes(k));
    if (key) return fetchRoutes[key](url, opts);
    return Promise.reject(new Error("offline test"));
  });
  // handleManualDocumentUpload takes an object URL as its local fallback; jsdom
  // does not implement these.
  if (!URL.createObjectURL) URL.createObjectURL = jest.fn(() => "blob:local/1");
  else jest.spyOn(URL, "createObjectURL").mockReturnValue("blob:local/1");
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const settle = async (ms = 5000) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

/** Pick an option out of a SearchableSelect (it commits on mousedown). */
function pickOption(labelText) {
  const option = screen
    .getAllByText(labelText, { exact: false })
    .find((el) => el.children.length === 0);
  expect(option).toBeTruthy();
  fireEvent.mouseDown(option.parentElement);
}

const buttonsWithText = (re) =>
  Array.from(document.querySelectorAll("button")).filter((b) =>
    re.test((b.textContent || "").trim())
  );

const bodyText = () => document.body.textContent || "";

/** Fill the company form on the input step. Shared by both journeys. */
function fillCompanyForm() {
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
}

/** The journey picker's own Continue (the second one on the page). */
const clickContinue = () => {
  const btn = buttonsWithText(/^Continue →$/).pop();
  expect(btn).toBeTruthy();
  fireEvent.click(btn);
};

/** Company → journey picker → card A (ai_documents) → the Documents step. */
async function driveToDocuments() {
  await act(async () => {
    render(<KYCAgent />);
  });
  await settle(0);

  fillCompanyForm();
  clickContinue(); // opens the journey picker
  await settle(0);

  // Card A is a clickable div, not a button — address it by its visible copy.
  const cardA = screen.getByText(/Upload documents & let AI fill the rest/i);
  fireEvent.click(cardA.parentElement);
  await settle(0);

  clickContinue(); // proceedFromJourney → ai_documents → documents step
  await settle(5000); // let the entry effect seed the demo fixtures
}

/* ═══════════════════════════════════════════
   1. Journey gating
   ═══════════════════════════════════════════ */
describe("journey gating", () => {
  it("renders the Documents step on the ai_documents journey (card A)", async () => {
    await driveToDocuments();
    expect(screen.getByText(/📁 Documents Sourced/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Upload your documents/i })
    ).toBeInTheDocument();
  });

  it("shows a Documents pill in the stepper on this journey", async () => {
    await driveToDocuments();
    // ai_documents inserts Documents between Company and Research.
    expect(bodyText()).toMatch(/Documents/);
    expect(bodyText()).toMatch(/Required Docs/); // the LATER, separate DRS step
  });

  it("does NOT render the Documents step on the ai_only journey (card B)", async () => {
    await act(async () => {
      render(<KYCAgent />);
    });
    await settle(0);
    fillCompanyForm();
    clickContinue();
    await settle(0);

    const cardB = screen.getByText(/Let AI research your company/i);
    fireEvent.click(cardB.parentElement);
    await settle(0);
    clickContinue();
    await settle(5000);

    // ai_only goes Company → Research directly; the sourced panel never mounts.
    expect(screen.queryByText(/📁 Documents Sourced/)).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════
   2. The merged "Documents Sourced" list
   ═══════════════════════════════════════════ */
describe("merged Documents Sourced list", () => {
  it("renders the panel with the DEMO DATA badge under the demo fixtures", async () => {
    await driveToDocuments();
    expect(screen.getByText(/📁 Documents Sourced/)).toBeInTheDocument();
    expect(screen.getByText(/DEMO DATA/)).toBeInTheDocument();
  });

  it("lists every registry requirement from the self-source fixture", async () => {
    await driveToDocuments();
    // buildDemoSelfSourceResults ships five requirements.
    const text = bodyText();
    ["Legal existence", "Constitution", "Business activity", "Ownership / control", "Regulatory status"]
      .forEach((requirement) => expect(text).toContain(requirement));
  });

  it("includes the research-sourced Annual Report alongside the registry rows", async () => {
    await driveToDocuments();
    // Corporate + private_limited → not FI, not listed → annual_report only.
    expect(bodyText()).toContain("Annual Report");
    // The FI-only Wolfsberg document must NOT appear on this entity type.
    expect(bodyText()).not.toContain("Wolfsberg");
  });

  it("labels registry and research origins distinctly", async () => {
    await driveToDocuments();
    const text = bodyText();
    expect(text).toContain("Retrieved from registry"); // SOURCE_LABELS.registry
    expect(text).toContain("Retrieved automatically"); // SOURCE_LABELS.research
    // Nothing was manually uploaded on the demo journey.
    expect(text).not.toContain("Uploaded manually");
  });

  it("orders automated entries before any manual upload", async () => {
    await driveToDocuments();
    const text = bodyText();
    const firstAutomated = Math.min(
      text.indexOf("Retrieved from registry"),
      text.indexOf("Retrieved automatically")
    );
    expect(firstAutomated).toBeGreaterThan(-1);
    // With no manual uploads present, "Uploaded manually" is absent entirely —
    // the manual-last ordering is asserted against real data in the round-trip
    // block below, where a manual entry actually exists.
    expect(text.indexOf("Uploaded manually")).toBe(-1);
  });

  it("flags the requirement the registry could not retrieve automatically", async () => {
    await driveToDocuments();
    // "Regulatory status" ships status manual_retrieval_required +
    // manualReviewFlag, so it is NOT presented as retrieved.
    expect(bodyText()).toContain("Regulatory status");
  });
});

/* ═══════════════════════════════════════════
   3. acceptedDocTypes toggle
   ═══════════════════════════════════════════ */
describe("acceptedDocTypes gating", () => {
  it("offers 'Use this document' for a research-sourced doc and flips to '✓ Using this' on click", async () => {
    await driveToDocuments();

    // acceptedDocTypes starts as an empty Set, so the un-accepted label shows.
    const use = buttonsWithText(/^Use this document$/);
    expect(use.length).toBeGreaterThan(0);
    expect(buttonsWithText(/^✓ Using this$/).length).toBe(0);

    fireEvent.click(use[0]);
    await settle(0);

    expect(buttonsWithText(/^✓ Using this$/).length).toBe(1);
  });

  it("toggles back out of the Set on a second click", async () => {
    await driveToDocuments();

    fireEvent.click(buttonsWithText(/^Use this document$/)[0]);
    await settle(0);
    expect(buttonsWithText(/^✓ Using this$/).length).toBe(1);

    fireEvent.click(buttonsWithText(/^✓ Using this$/)[0]);
    await settle(0);
    expect(buttonsWithText(/^✓ Using this$/).length).toBe(0);
    expect(buttonsWithText(/^Use this document$/).length).toBeGreaterThan(0);
  });

  it("offers the accept control only for research-sourced docs, not registry rows", async () => {
    await driveToDocuments();
    // Five registry rows + one research doc, but only the research doc is
    // gated on acceptedDocTypes.
    expect(buttonsWithText(/^Use this document$/).length).toBe(1);
  });
});

/* ═══════════════════════════════════════════
   4. Test-mode affordances (SHOW_TEST_TOOLS true under Jest)
   ═══════════════════════════════════════════ */
describe("test-mode affordances", () => {
  it("renders the demo/real toggle and the dummy-search escape hatch", async () => {
    await driveToDocuments();
    expect(buttonsWithText(/^Use demo data$/).length).toBe(1);
    expect(buttonsWithText(/^Run real agent$/).length).toBe(1);
    expect(buttonsWithText(/Dummy search \(no cost\)/).length).toBe(1);
  });

  it("hides the demo/real toggle once the real agents have been triggered", async () => {
    await driveToDocuments();
    fireEvent.click(buttonsWithText(/^Run real agent$/)[0]);
    await settle(0);
    // setHasRunRealAgent(true) removes the toggle; the network calls themselves
    // reject offline, which is fine — this pins the wiring, not the outcome.
    expect(buttonsWithText(/^Run real agent$/).length).toBe(0);
    expect(buttonsWithText(/^Use demo data$/).length).toBe(0);
  });
});

/* ═══════════════════════════════════════════
   5. Navigation
   ═══════════════════════════════════════════ */
describe("navigation", () => {
  it("Continue → advances out of the Documents step (proceedFromDocuments)", async () => {
    await driveToDocuments();
    expect(screen.getByText(/📁 Documents Sourced/)).toBeInTheDocument();

    clickContinue();
    await settle(5000);

    expect(screen.queryByText(/📁 Documents Sourced/)).not.toBeInTheDocument();
  });

  it("← Back returns to the journey picker (setJourneyOpen(true))", async () => {
    await driveToDocuments();

    const back = buttonsWithText(/^← Back$/);
    expect(back.length).toBeGreaterThan(0);
    fireEvent.click(back[0]);
    await settle(0);

    // Observable effect of setJourneyOpen(true) + step → input: the picker's
    // cards are on screen again and the sourced panel is gone.
    expect(
      screen.getByText(/Upload documents & let AI fill the rest/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/📁 Documents Sourced/)).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════
   6. Manual upload / remove round-trip
   ──────────────────────────────────────────
   Fixture variant: the demo self-source data never sets captchaBlocked, so the
   upload affordance cannot appear on the demo journey. This drives the app's
   own real path (Run real agent → runRealSelfSource) with /api/self-source
   stubbed to return one captcha-blocked row.
   ═══════════════════════════════════════════ */
describe("manual upload / remove round-trip", () => {
  // Two rows on purpose: one already retrieved, one captcha-blocked. The
  // retrieved row gives the manual-last ordering something to sort against once
  // the blocked row becomes a manual upload.
  const captchaFixture = {
    success: true,
    searchedAt: "2026-01-01T00:00:00.000Z",
    selfSourcedFields: {},
    results: [
      {
        requirement: "Legal existence",
        selfSourceTier: "Preferred self-source",
        status: "retrieved",
        extracted: { matchConfidence: "high" },
        sourceLabel: "Companies House",
        searchUrl: "https://find-and-update.company-information.service.gov.uk/",
        retrievedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        requirement: "Regulatory status",
        selfSourceTier: "Preferred self-source",
        status: "manual_retrieval_required",
        captchaBlocked: true,
        sourceLabel: "FCA Register",
        searchUrl: "https://register.fca.org.uk/",
      },
    ],
  };

  /** Drive to Documents, then swap the demo fixture for the captcha one. */
  async function driveToCaptchaRow() {
    await driveToDocuments();

    fetchRoutes["/api/self-source"] = () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(captchaFixture) });
    // runRealDocSearch fires alongside and is left offline on purpose — the
    // research half of the panel is already covered above.

    fireEvent.click(buttonsWithText(/^Run real agent$/)[0]);
    await settle(5000);
  }

  it("shows the captcha-blocked upload affordance for a blocked registry row", async () => {
    await driveToCaptchaRow();
    expect(bodyText()).toContain("Behind captcha");
    expect(buttonsWithText(/↑ Upload document/).length).toBe(1);
  });

  it("upload replaces the captcha UI with the uploaded filename and a Remove control", async () => {
    await driveToCaptchaRow();

    fetchRoutes["/api/upload-document"] = () =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            blobUrl: "https://blob.example/doc.pdf",
            pathname: "doc-abc.pdf",
            filename: "fca-extract.pdf",
          }),
      });

    const fileInput = document.querySelector('input[type="file"][accept*="pdf"]');
    expect(fileInput).toBeTruthy();
    await act(async () => {
      fireEvent.change(fileInput, {
        target: {
          files: [new File(["%PDF"], "fca-extract.pdf", { type: "application/pdf" })],
        },
      });
    });
    await settle(0);

    const text = bodyText();
    expect(text).toContain("fca-extract.pdf");
    expect(text).toContain("Uploaded manually"); // origin flipped to manual
    expect(text).not.toContain("Behind captcha"); // captcha = blocked && !uploaded
    expect(screen.getByText(/^Remove$/)).toBeInTheDocument();
  });

  it("remove restores manual_retrieval_required so the captcha UI reappears", async () => {
    await driveToCaptchaRow();

    fetchRoutes["/api/upload-document"] = () =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            blobUrl: "https://blob.example/doc.pdf",
            pathname: "doc-abc.pdf",
            filename: "fca-extract.pdf",
          }),
      });

    const fileInput = document.querySelector('input[type="file"][accept*="pdf"]');
    await act(async () => {
      fireEvent.change(fileInput, {
        target: {
          files: [new File(["%PDF"], "fca-extract.pdf", { type: "application/pdf" })],
        },
      });
    });
    await settle(0);
    expect(bodyText()).toContain("fca-extract.pdf");

    fireEvent.click(screen.getByText(/^Remove$/));
    await settle(0);

    const text = bodyText();
    expect(text).not.toContain("fca-extract.pdf");
    expect(text).toContain("Behind captcha"); // captchaBlocked stayed true
    expect(buttonsWithText(/↑ Upload document/).length).toBe(1);
  });

  it("sorts the manual upload AFTER the automated row (manual-last)", async () => {
    await driveToCaptchaRow();

    fetchRoutes["/api/upload-document"] = () =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            blobUrl: "https://blob.example/doc.pdf",
            pathname: "doc-abc.pdf",
            filename: "fca-extract.pdf",
          }),
      });

    const fileInput = document.querySelector('input[type="file"][accept*="pdf"]');
    await act(async () => {
      fireEvent.change(fileInput, {
        target: {
          files: [new File(["%PDF"], "fca-extract.pdf", { type: "application/pdf" })],
        },
      });
    });
    await settle(0);

    // Both origins are now on screen; the automated one must come first in DOM
    // order. This is the assertion the demo journey cannot make, because it
    // never produces a manual entry.
    const text = bodyText();
    const automated = text.indexOf("Retrieved from registry");
    const manual = text.indexOf("Uploaded manually");
    expect(automated).toBeGreaterThan(-1);
    expect(manual).toBeGreaterThan(-1);
    expect(automated).toBeLessThan(manual);
  });

  it("warns, rather than silently losing the file, when the blob upload fails", async () => {
    await driveToCaptchaRow();

    // No /api/upload-document route registered → rejects → uploadFailed: true.
    const fileInput = document.querySelector('input[type="file"][accept*="pdf"]');
    await act(async () => {
      fireEvent.change(fileInput, {
        target: {
          files: [new File(["%PDF"], "fca-extract.pdf", { type: "application/pdf" })],
        },
      });
    });
    await settle(0);

    expect(bodyText()).toContain("Upload could not be stored permanently");
  });
});
