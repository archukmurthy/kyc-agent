/**
 * CompanyLookupPage.render.test.jsx — CHARACTERISATION of the Company Lookup
 * screen while it is still inline JSX in App.js.
 *
 * WHY NOW: slice 2 of the Journey/Lookup extraction lifts the {step ===
 * STEPS.input && !journeyOpen} branch — the complement of the JourneyPicker
 * branch that landed in slice 1 — into CompanyLookupPage.jsx. Like the picker
 * and the AI-Documents step, it is inline JSX rather than a named render
 * function, so the move AUTHORS the component boundary.
 *
 * COVERAGE STATUS IS THE OPPOSITE OF JourneyPicker's. The picker had no
 * coverage at all before its net. This screen has heavy INCIDENTAL coverage:
 * render(<KYCAgent/>) lands here, and every other net's driver fills these
 * fields to get anywhere. That incidental coverage is worth very little as an
 * oracle — it asserts that the fields can be filled, not that the screen
 * behaves. A driver would keep passing while the licence banner vanished, the
 * ownership dependency inverted, or the reg-number provenance flag silently
 * stopped being set. This file makes the coverage DELIBERATE and NAMED.
 *
 * THE SHARP EDGE THIS NET EXISTS FOR: setRegNumberSource. The reg-number input
 * does two things in one handler — setRegNumber(v) AND setRegNumberSource(v.trim()
 * ? "customer" : null). A move that carries only the first looks perfectly
 * correct on this screen (the text still round-trips) and silently breaks
 * provenance downstream. There is no signal for it here, so the provenance
 * block below drives to the Applicant gate and asserts the note it produces —
 * "✓ You provided this" vs "Found by research — please verify". That is the
 * only place the flag is observable.
 *
 * CHARACTERISATION, not specification: these assert what the screen does TODAY.
 * A surprising assertion is a recorded fact. After the move this file must stay
 * green UNCHANGED — editing it to make the move pass defeats the point.
 *
 * TWO PATHS ARE UNREACHABLE AND ARE NOT ASSERTED (both reported, not papered
 * over):
 *   1. The pendingReseedMode === "re_derive" short-circuit on Continue.
 *      setPendingReseedMode is never called with "re_derive" anywhere in src/ —
 *      its only call site passes null, inside applyReDerive itself. The branch
 *      is dead in the current build.
 *   2. The four inline validation messages ("Please enter a company name." etc).
 *      Continue's disabled prop tests the SAME four conditions as its onClick
 *      guards, so the button cannot be clicked while any message would fire.
 *      Defensive code, currently unreachable through the UI.
 */

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import KYCAgent from "../../../App";

jest.setTimeout(60000);

beforeEach(() => {
  // /api/config, track-event and ipify fire on mount. Rejecting them makes the
  // app fall back to buildLocalDefaultConfig(), which ships FI / Platform /
  // Direct / Corporate and the GB licence — deterministic, no network.
  global.fetch = jest.fn(() => Promise.reject(new Error("offline test")));
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

const bodyText = () => document.body.textContent || "";

const buttonsWithText = (re) =>
  Array.from(document.querySelectorAll("button")).filter((b) =>
    re.test((b.textContent || "").trim())
  );

const continueBtn = () => buttonsWithText(/^Continue →$/)[0];

const nameInput = () => screen.getByPlaceholderText(/Tesco PLC/i);
const regInput = () => screen.getByPlaceholderText(/00445790/i);
const entityInput = () => screen.getByPlaceholderText(/Select or type entity type/i);
const countryInput = () => screen.getByPlaceholderText(/Select or type country/i);
/** Ownership placeholder flips with entityType, so match either wording. */
const ownershipInput = () =>
  screen.getByPlaceholderText(/Select ownership type|Select an entity type first/i);

async function mountLookup() {
  await act(async () => {
    render(<KYCAgent />);
  });
  await settle(0);
}

/** Fill every required field. Leaves reg number blank unless given. */
async function fillAll({ country = "United King", regNumber } = {}) {
  fireEvent.change(nameInput(), { target: { value: "Britannia Group Limited" } });
  if (regNumber !== undefined) {
    fireEvent.change(regInput(), { target: { value: regNumber } });
  }
  fireEvent.change(entityInput(), { target: { value: "Corporate" } });
  pickOption("🏛 Corporate");
  fireEvent.focus(ownershipInput());
  pickOption("Private Limited Company");
  fireEvent.change(countryInput(), { target: { value: country } });
  pickOption(country === "United King" ? "GB — United Kingdom" : "FR — France");
  await settle(0);
}

/* ═══════════════════════════════════════════
   1. The screen and its inputs
   ═══════════════════════════════════════════ */
describe("the lookup screen renders", () => {
  it("is what render(<KYCAgent/>) lands on", async () => {
    await mountLookup();
    expect(
      screen.getByRole("heading", { name: /Company Lookup/i })
    ).toBeInTheDocument();
  });

  it("renders every input in the field set", async () => {
    await mountLookup();
    expect(nameInput()).toBeInTheDocument();
    expect(regInput()).toBeInTheDocument();
    expect(entityInput()).toBeInTheDocument();
    expect(ownershipInput()).toBeInTheDocument();
    expect(countryInput()).toBeInTheDocument();
  });

  it("marks the reg number optional and explains what it buys", async () => {
    await mountLookup();
    expect(bodyText()).toMatch(/Registration \/ Company number \(optional\)/i);
    expect(bodyText()).toMatch(/Leave it blank to search by name/i);
  });

  it("renders the test-mode dummy-research escape hatch", async () => {
    await mountLookup();
    // SHOW_TEST_TOOLS is NODE_ENV !== "production", so true under Jest.
    expect(buttonsWithText(/Dummy Research \(skip API\)/).length).toBe(1);
  });
});

/* ═══════════════════════════════════════════
   2. Entity type → ownership type dependency
   ═══════════════════════════════════════════ */
describe("entity type gates ownership type", () => {
  it("disables ownership until an entity type is chosen, with a guiding placeholder", async () => {
    await mountLookup();
    const own = screen.getByPlaceholderText(/Select an entity type first/i);
    expect(own).toBeDisabled();
  });

  it("enables ownership and flips the placeholder once an entity type is chosen", async () => {
    await mountLookup();
    fireEvent.change(entityInput(), { target: { value: "Corporate" } });
    pickOption("🏛 Corporate");
    await settle(0);

    const own = screen.getByPlaceholderText(/Select ownership type/i);
    expect(own).not.toBeDisabled();
    expect(
      screen.queryByPlaceholderText(/Select an entity type first/i)
    ).not.toBeInTheDocument();
  });

  it("populates ownership options from the chosen entity type", async () => {
    await mountLookup();
    fireEvent.change(entityInput(), { target: { value: "Corporate" } });
    pickOption("🏛 Corporate");
    await settle(0);

    fireEvent.focus(screen.getByPlaceholderText(/Select ownership type/i));
    await settle(0);
    expect(bodyText()).toMatch(/Private Limited Company/i);
  });

  it("CLEARS the ownership selection when the entity type changes", async () => {
    await mountLookup();
    fireEvent.change(entityInput(), { target: { value: "Corporate" } });
    pickOption("🏛 Corporate");
    fireEvent.focus(screen.getByPlaceholderText(/Select ownership type/i));
    pickOption("Private Limited Company");
    await settle(0);
    expect(screen.getByPlaceholderText(/Select ownership type/i).value).toMatch(
      /Private Limited Company/i
    );

    // Switching entity type runs setOwnershipType("") — the selection must go.
    fireEvent.change(entityInput(), { target: { value: "Financial Institution" } });
    pickOption("Financial Institution");
    await settle(0);

    expect(screen.getByPlaceholderText(/Select ownership type/i).value).toBe("");
  });
});

/* ═══════════════════════════════════════════
   3. Reg-number provenance wiring (setRegNumberSource)
   ═══════════════════════════════════════════ */
describe("reg-number provenance", () => {
  it("round-trips the typed value on screen", async () => {
    await mountLookup();
    fireEvent.change(regInput(), { target: { value: "00445790" } });
    await settle(0);
    expect(regInput().value).toBe("00445790");
  });

  /** Company → dummy research → Applicant, where the provenance note renders. */
  async function driveToApplicant(regNumber) {
    await mountLookup();
    await fillAll(regNumber === undefined ? {} : { regNumber });
    fireEvent.click(screen.getByRole("button", { name: /Dummy Research/i }));
    await settle(5000);
  }

  it("a customer-entered reg number reaches the Applicant gate as customer-provided", async () => {
    await driveToApplicant("00445790");
    // regNumberSource === "customer" → regProvenance "customer" → this note.
    expect(bodyText()).toContain("✓ You provided this");
    expect(bodyText()).toContain("00445790");
  });

  it("a blank reg number leaves provenance to research, not the customer", async () => {
    await driveToApplicant();
    expect(bodyText()).not.toContain("✓ You provided this");
    // Dummy research supplies the number instead.
    expect(bodyText()).toMatch(/Found by research|Not provided on lookup/);
  });

  it("clearing the reg number drops the customer flag again", async () => {
    await mountLookup();
    fireEvent.change(regInput(), { target: { value: "00445790" } });
    await settle(0);
    // Blanking runs setRegNumberSource(null) — the trim() branch of the handler.
    fireEvent.change(regInput(), { target: { value: "" } });
    await settle(0);
    expect(regInput().value).toBe("");

    await fillAll();
    fireEvent.click(screen.getByRole("button", { name: /Dummy Research/i }));
    await settle(5000);
    expect(bodyText()).not.toContain("✓ You provided this");
  });
});

/* ═══════════════════════════════════════════
   4. The licence banner
   ═══════════════════════════════════════════ */
describe("licence banner", () => {
  it("is absent until a country is chosen", async () => {
    await mountLookup();
    expect(bodyText()).not.toMatch(/Researching in:/);
  });

  it("shows the licensed-market banner for GB", async () => {
    await mountLookup();
    fireEvent.change(countryInput(), { target: { value: "United King" } });
    pickOption("GB — United Kingdom");
    await settle(0);

    const text = bodyText();
    expect(text).toMatch(/🌍 Researching in:/);
    expect(text).toContain("United Kingdom");
    expect(text).toMatch(/📋 Applicable licence:/);
    // GB is in LICENSED_MARKETS, so no "no licence" fallback copy.
    expect(text).not.toMatch(/has no licence in/);
  });

  it("shows the no-licence fallback for a non-licensed market (FR)", async () => {
    await mountLookup();
    fireEvent.change(countryInput(), { target: { value: "France" } });
    pickOption("FR — France");
    await settle(0);

    const text = bodyText();
    expect(text).toMatch(/🌍 Researching in:/);
    expect(text).toContain("France");
    expect(text).toMatch(/has no licence in/);
  });

  it("adds the Corporate form-set line once an entity type is chosen", async () => {
    await mountLookup();
    fireEvent.change(countryInput(), { target: { value: "United King" } });
    pickOption("GB — United Kingdom");
    await settle(0);
    // Form set only renders with an entity type.
    expect(bodyText()).not.toMatch(/📑 Form set:/);

    fireEvent.change(entityInput(), { target: { value: "Corporate" } });
    pickOption("🏛 Corporate");
    await settle(0);
    expect(bodyText()).toMatch(/📑 Form set:/);
    expect(bodyText()).toContain("Corporate version");
  });

  it("shows the FI form set for a Financial Institution", async () => {
    await mountLookup();
    fireEvent.change(countryInput(), { target: { value: "United King" } });
    pickOption("GB — United Kingdom");
    fireEvent.change(entityInput(), { target: { value: "Financial Institution" } });
    pickOption("Financial Institution");
    await settle(0);

    expect(bodyText()).toContain("FI version");
  });
});

/* ═══════════════════════════════════════════
   5. Force-refresh checkbox
   ═══════════════════════════════════════════ */
describe("force-refresh cache override", () => {
  it("defaults to cache-first with the cost-saving hint", async () => {
    await mountLookup();
    const box = document.querySelector('input[type="checkbox"]');
    expect(box).toBeTruthy();
    expect(box.checked).toBe(false);
    expect(bodyText()).toMatch(/Cache saves API costs/);
    expect(bodyText()).not.toMatch(/Live API call/);
  });

  it("swaps to the cost warning when ticked, and back when unticked", async () => {
    await mountLookup();
    const box = document.querySelector('input[type="checkbox"]');

    fireEvent.click(box);
    await settle(0);
    expect(bodyText()).toMatch(/⚠ Live API call — this will cost tokens/);
    expect(bodyText()).not.toMatch(/Cache saves API costs/);

    fireEvent.click(document.querySelector('input[type="checkbox"]'));
    await settle(0);
    expect(bodyText()).toMatch(/Cache saves API costs/);
    expect(bodyText()).not.toMatch(/Live API call/);
  });
});

/* ═══════════════════════════════════════════
   6. The Continue gate and the seam into JourneyPicker
   ═══════════════════════════════════════════ */
describe("Continue gate", () => {
  /**
   * RECORDED FACT, and a surprising one: App's <Btn> does NOT set the `disabled`
   * attribute. Its disabled prop only styles the button (opacity 0.4, cursor
   * not-allowed) and withholds onClick:
   *
   *   <button style={...} onClick={disabled ? undefined : onClick}>
   *
   * So the gate is real but INERT-BY-STYLE rather than semantically disabled —
   * assistive tech and keyboard users see an enabled button that does nothing.
   * These assertions therefore pin what actually happens (dimmed + click does
   * nothing), not toBeDisabled(), which would be asserting a fiction. Flagged
   * for a separate accessibility decision; NOT changed here.
   */
  const isGated = (btn) => btn.style.opacity === "0.4";

  it("is gated on an empty form (dimmed, not semantically disabled)", async () => {
    await mountLookup();
    expect(isGated(continueBtn())).toBe(true);
    expect(continueBtn().style.cursor).toBe("not-allowed");
  });

  it("stays gated while any required field is missing", async () => {
    await mountLookup();
    fireEvent.change(nameInput(), { target: { value: "Britannia Group Limited" } });
    await settle(0);
    expect(isGated(continueBtn())).toBe(true);

    fireEvent.change(entityInput(), { target: { value: "Corporate" } });
    pickOption("🏛 Corporate");
    await settle(0);
    expect(isGated(continueBtn())).toBe(true); // ownership + country still missing

    fireEvent.focus(ownershipInput());
    pickOption("Private Limited Company");
    await settle(0);
    expect(isGated(continueBtn())).toBe(true); // country still missing
  });

  it("a gated Continue is inert — clicking it does not open the picker", async () => {
    await mountLookup();
    fireEvent.change(nameInput(), { target: { value: "Britannia Group Limited" } });
    await settle(0);

    fireEvent.click(continueBtn());
    await settle(0);

    // Still on the lookup screen; the picker never opened.
    expect(
      screen.getByRole("heading", { name: /Company Lookup/i })
    ).toBeInTheDocument();
  });

  it("ungates once all four required fields are filled", async () => {
    await mountLookup();
    await fillAll();
    expect(isGated(continueBtn())).toBe(false);
    expect(continueBtn().style.opacity).toBe("1");
  });

  it("OPENS the journey picker — the seam into JourneyPicker", async () => {
    await mountLookup();
    await fillAll();

    fireEvent.click(continueBtn());
    await settle(0);

    // setJourneyOpen(true) swaps the branch: lookup out, picker in. Only the
    // transition is pinned here — the picker has its own oracle.
    expect(
      screen.queryByRole("heading", { name: /Company Lookup/i })
    ).not.toBeInTheDocument();
    expect(bodyText()).toMatch(/How would you like to complete your application/i);
  });
});
