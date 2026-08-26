/**
 * JourneyPicker.render.test.jsx — CHARACTERISATION of the journey-selection
 * screen ("How would you like to complete your application?") while it is still
 * inline JSX in App.js, at {step === STEPS.input && journeyOpen}.
 *
 * WHY NOW: this screen has ZERO existing coverage. Every render test in the repo
 * escapes step 0 via the "🧪 Dummy Research (skip API)" button on the Company
 * Lookup screen, which sets journeyOpen(false)'s sibling path and BYPASSES the
 * picker entirely. So the 374 green tests say nothing about it. This net is
 * load-bearing rather than confirmatory: it is the first oracle the screen has
 * ever had, and it is written BEFORE the extraction so a red test after the move
 * means a broken move.
 *
 * SCOPE: the PICKER only. This drives THROUGH Company Lookup to reach it, but
 * asserts nothing about the lookup screen's own behaviour — that screen gets its
 * own net in C slice 2. The only lookup facts touched here are the four required
 * fields the driver must fill to unlock Continue.
 *
 * The screen cannot be rendered in isolation (it closes over App's journey
 * state, the search-cap policy and the research kickoff functions), so this
 * drives the REAL app, the same harness ApplicantPage/FillGapsPage use —
 * deliberately mirrored rather than reinvented.
 *
 * ROUTING IS THE POINT. A picker that renders perfectly but routes card B to the
 * documents step is a silent, expensive break. Routing is therefore asserted on
 * OBSERVABLE EFFECT, never on function identity:
 *   • card A  → the Documents step actually renders
 *   • cards B/E → the research kickoff actually fires, and the journey it fired
 *     with is read back off the /api/track-event POST body (research_started
 *     carries eventData.journeyType). That is a real side-effect of the routing,
 *     so it survives the JSX moving to another file.
 *   • card C  → window.open is actually called with the manual form URL
 *
 * FLAG STATE UNDER JEST (characterised, not assumed):
 *   NODE_ENV="test"      → SHOW_TEST_TOOLS === true
 *   no ?test=1 in jsdom  → TEST_FLAG === false
 *   jsdom host localhost → demoToggleVisible === true, so the DemoToggle IS
 *                          mounted and demo mode is reachable by clicking it
 *                          (a user-facing control — no production flag is
 *                          flipped to reach the demo assertions below).
 *
 * KNOWN UNREACHABLE (see the report, not a gap in the assertions):
 *   The locked search-cap state. `const [seededBy] = useState("analyst")` has no
 *   setter (App.js ~314), and proceedFromJourney only increments searchAttempts
 *   when seededBy === "customer" (~2521). searchAttempts is therefore pinned at
 *   0 for the whole life of the app, so evaluateSearchCap never returns
 *   locked/isSecondAttempt. The unlocked state is characterised instead, as a
 *   positive assertion that NEITHER banner renders and NO card is disabled.
 *
 * CHARACTERISATION, not specification: these assert what the picker does TODAY.
 * A surprising assertion is a recorded fact. After the extraction this file must
 * stay green UNCHANGED — editing it to make the move pass defeats the point.
 */

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import KYCAgent from "../../../App";

jest.setTimeout(60000);

let openSpy;

beforeEach(() => {
  // /api/config, track-event and ipify fire on mount. Rejecting them makes the
  // app fall back to buildLocalDefaultConfig(), which ships the Corporate:GB
  // schema — deterministic, no network. The rejection is also what drives the
  // research-failure path the B/E routing assertions land on.
  global.fetch = jest.fn(() => Promise.reject(new Error("offline test")));
  // Card C opens the manual form in a new tab; jsdom's window.open is a stub
  // that warns, so replace it and read the call back as the routing evidence.
  openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
  // demoMode persists its opt-in to sessionStorage. Without this, a test that
  // toggles demo mode on leaks into every test that runs after it.
  try { sessionStorage.clear(); } catch (_) { /* ignore */ }
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  try { sessionStorage.clear(); } catch (_) { /* ignore */ }
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

/**
 * Company Lookup → Continue → STOP on the journey picker.
 *
 * This is driveToApplicant's opening, but it clicks the real "Continue →"
 * instead of the Dummy Research shortcut — that shortcut is precisely what has
 * kept this screen uncovered, so using it here would defeat the net.
 */
async function driveToPicker() {
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

  fireEvent.click(screen.getByRole("button", { name: /^Continue/ }));
  await settle(0);
}

/** Turn demo mode on from inside the picker, via the real DemoToggle. */
async function enableDemoMode() {
  const toggle = screen
    .getByTitle(/Skip API calls/i)
    .querySelector('input[type="checkbox"]');
  expect(toggle).toBeTruthy();
  fireEvent.click(toggle);
  await settle(0);
}

/** A journey card, addressed by its title text; the card is the title's parent. */
const card = (title) => screen.getByText(title).parentElement;

const CARD_A = "Upload documents & let AI fill the rest";
const CARD_B = "Let AI research your company";
const CARD_C = "I'll complete the form myself";
const CARD_E = "Run for max prefill";

const continueBtn = () => screen.getByRole("button", { name: /^Continue/ });
const backBtn = () => screen.getByRole("button", { name: /Back/ });

/** The step-indicator pill labels — the observable read-out of journeyType. */
const stepPills = () =>
  Array.from(document.querySelectorAll("span"))
    .map((s) => s.textContent.trim())
    .filter((t) => ["Company", "Documents", "Research", "Applicant"].includes(t));

/**
 * The journeys the research kickoff actually fired with, read off the
 * /api/track-event POST bodies. trackEvent("research_started", …) carries
 * eventData.journeyType, so this reads the routing decision itself rather than
 * inferring it from the UI.
 */
const researchStartedJourneys = () =>
  global.fetch.mock.calls
    .filter(([url]) => url === "/api/track-event")
    .map(([, opts]) => {
      try { return JSON.parse(opts.body); } catch (_) { return null; }
    })
    .filter((b) => b && b.eventType === "research_started")
    .map((b) => b.eventData.journeyType);

/* ══════════════════════════════════════════════════════════════════ */

describe("reaching the journey picker", () => {
  it("opens from Company Lookup's Continue, replacing the lookup screen", async () => {
    await driveToPicker();
    expect(
      screen.getByRole("heading", {
        name: /How would you like to complete your application\?/,
      })
    ).toBeInTheDocument();
    expect(screen.queryByText("Company Lookup")).not.toBeInTheDocument();
  });

  it("renders the sub-heading", async () => {
    await driveToPicker();
    expect(
      screen.getByText(/Choose the option that works best for you/)
    ).toBeInTheDocument();
  });
});

describe("the cards that render", () => {
  it("renders cards A, B, C and E", async () => {
    await driveToPicker();
    expect(screen.getByText(CARD_A)).toBeInTheDocument();
    expect(screen.getByText(CARD_B)).toBeInTheDocument();
    expect(screen.getByText(CARD_C)).toBeInTheDocument();
    expect(screen.getByText(CARD_E)).toBeInTheDocument();
  });

  it("badges card A as Recommended and card E as New", async () => {
    await driveToPicker();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("renders each card's supporting copy", async () => {
    await driveToPicker();
    expect(screen.getByText(/Fastest · Most accurate · Lowest effort/)).toBeInTheDocument();
    expect(screen.getByText(/~30 seconds · No uploads needed/)).toBeInTheDocument();
    expect(screen.getByText(/Full control · No AI · ~15 minutes/)).toBeInTheDocument();
    expect(screen.getByText(/Most comprehensive · Highest coverage/)).toBeInTheDocument();
  });

});

describe("selecting a card", () => {
  it("starts with no card selected", async () => {
    await driveToPicker();
    expect(card(CARD_A)).toHaveStyle({ border: "2px solid rgba(26,58,74,0.18)" });
    expect(card(CARD_B)).toHaveStyle({ border: "2px solid rgba(26,58,74,0.12)" });
  });

  it("applies the selected border and background to the clicked card", async () => {
    await driveToPicker();
    fireEvent.click(card(CARD_A));
    await settle(0);
    expect(card(CARD_A)).toHaveStyle({
      border: "2px solid #1a3a4a",
      background: "#f0f9f6",
    });
  });

  it("selects exactly one card at a time", async () => {
    await driveToPicker();
    fireEvent.click(card(CARD_A));
    await settle(0);
    fireEvent.click(card(CARD_B));
    await settle(0);
    expect(card(CARD_B)).toHaveStyle({ border: "2px solid #1a3a4a" });
    expect(card(CARD_A)).toHaveStyle({ border: "2px solid rgba(26,58,74,0.18)" });
  });

  it("clears a standing error when a card is selected", async () => {
    await driveToPicker();
    fireEvent.click(continueBtn());
    await settle(0);
    expect(screen.getByText("Please choose an option to continue.")).toBeInTheDocument();

    fireEvent.click(card(CARD_B));
    await settle(0);
    expect(
      screen.queryByText("Please choose an option to continue.")
    ).not.toBeInTheDocument();
  });
});

describe("Continue with nothing selected", () => {
  it("blocks and explains", async () => {
    await driveToPicker();
    fireEvent.click(continueBtn());
    await settle(0);
    expect(screen.getByText("Please choose an option to continue.")).toBeInTheDocument();
    // Still on the picker — no routing happened.
    expect(
      screen.getByRole("heading", {
        name: /How would you like to complete your application\?/,
      })
    ).toBeInTheDocument();
    expect(researchStartedJourneys()).toEqual([]);
  });
});

describe("routing — card A (documents + AI)", () => {
  it("advances to the Documents step", async () => {
    await driveToPicker();
    fireEvent.click(card(CARD_A));
    await settle(0);
    fireEvent.click(continueBtn());
    await settle(0);

    expect(
      screen.getByRole("heading", { level: 2, name: "Upload your documents" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: /How would you like to complete your application\?/,
      })
    ).not.toBeInTheDocument();
  });

  it("sets journeyType ai_documents, which inserts the Documents pill", async () => {
    await driveToPicker();
    // Before: the non-ai_documents step names, no Documents pill.
    expect(stepPills()).not.toContain("Documents");

    fireEvent.click(card(CARD_A));
    await settle(0);
    fireEvent.click(continueBtn());
    await settle(0);

    expect(stepPills()).toContain("Documents");
  });

  it("does not kick off research from the picker", async () => {
    await driveToPicker();
    fireEvent.click(card(CARD_A));
    await settle(0);
    fireEvent.click(continueBtn());
    await settle(0);
    expect(researchStartedJourneys()).toEqual([]);
  });
});

describe("routing — card B (AI research only)", () => {
  it("kicks off research with journey ai_only", async () => {
    await driveToPicker();
    fireEvent.click(card(CARD_B));
    await settle(0);
    fireEvent.click(continueBtn());
    await settle(0);

    expect(researchStartedJourneys()).toEqual(["ai_only"]);
  });

  it("leaves the picker and does NOT insert a Documents step", async () => {
    await driveToPicker();
    fireEvent.click(card(CARD_B));
    await settle(0);
    fireEvent.click(continueBtn());
    await settle(0);

    expect(
      screen.queryByRole("heading", {
        name: /How would you like to complete your application\?/,
      })
    ).not.toBeInTheDocument();
    expect(stepPills()).not.toContain("Documents");
  });

  it("falls back to Company Lookup with the failure message when the call fails", async () => {
    await driveToPicker();
    fireEvent.click(card(CARD_B));
    await settle(0);
    fireEvent.click(continueBtn());
    await settle(5000);

    // seededBy is always "analyst", so this is the non-customer branch of
    // doResearch's catch: plain message, back to step 0, picker stays closed.
    expect(screen.getByText(/Research failed: offline test/)).toBeInTheDocument();
    expect(screen.getByText("Company Lookup")).toBeInTheDocument();
  });
});

describe("routing — card C (manual form)", () => {
  it("opens the manual form in a new tab", async () => {
    await driveToPicker();
    fireEvent.click(card(CARD_C));
    await settle(0);
    fireEvent.click(continueBtn());
    await settle(0);

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = openSpy.mock.calls[0];
    expect(typeof url).toBe("string");
    expect(url).toMatch(/^https?:\/\//);
    expect(target).toBe("_blank");
    expect(features).toBe("noopener,noreferrer");
  });

  it("shows the manual-opened notice and STAYS on the picker", async () => {
    await driveToPicker();
    fireEvent.click(card(CARD_C));
    await settle(0);
    fireEvent.click(continueBtn());
    await settle(0);

    expect(screen.getByText(/Opening the manual form in a new tab/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /How would you like to complete your application\?/,
      })
    ).toBeInTheDocument();
  });

  it("does not kick off research", async () => {
    await driveToPicker();
    fireEvent.click(card(CARD_C));
    await settle(0);
    fireEvent.click(continueBtn());
    await settle(0);
    expect(researchStartedJourneys()).toEqual([]);
  });
});

describe("routing — card E (max prefill)", () => {
  it("kicks off research with journey max_prefill", async () => {
    await driveToPicker();
    fireEvent.click(card(CARD_E));
    await settle(0);
    fireEvent.click(continueBtn());
    await settle(0);

    expect(researchStartedJourneys()).toEqual(["max_prefill"]);
  });

  it("routes through standard research — no Documents step", async () => {
    await driveToPicker();
    fireEvent.click(card(CARD_E));
    await settle(0);
    fireEvent.click(continueBtn());
    await settle(0);

    expect(stepPills()).not.toContain("Documents");
  });
});

describe("demo-mode short-circuit", () => {
  it("card A skips the Documents step and lands on Applicant", async () => {
    await driveToPicker();
    await enableDemoMode();

    fireEvent.click(card(CARD_A));
    await settle(0);
    fireEvent.click(continueBtn());
    await settle(5000);

    // doDummyResearch("ai_documents") synthesises the result and jumps straight
    // to the Applicant step — the Documents step is never rendered.
    expect(screen.getByText("Tell us about yourself")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "Upload your documents" })
    ).not.toBeInTheDocument();
  });

  it("card B never calls the real research kickoff", async () => {
    await driveToPicker();
    await enableDemoMode();

    fireEvent.click(card(CARD_B));
    await settle(0);
    fireEvent.click(continueBtn());
    await settle(5000);

    expect(researchStartedJourneys()).toEqual([]);
    expect(screen.getByText("Tell us about yourself")).toBeInTheDocument();
  });

  it("shows the demo-mode notice on the picker while it is on", async () => {
    await driveToPicker();
    await enableDemoMode();
    expect(screen.getByText(/Demo mode active — using sample data/)).toBeInTheDocument();
  });
});

describe("the ← Back control", () => {
  it("returns to Company Lookup", async () => {
    await driveToPicker();
    fireEvent.click(backBtn());
    await settle(0);

    expect(screen.getByText("Company Lookup")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: /How would you like to complete your application\?/,
      })
    ).not.toBeInTheDocument();
  });

  it("clears the manual-opened notice", async () => {
    await driveToPicker();
    fireEvent.click(card(CARD_C));
    await settle(0);
    fireEvent.click(continueBtn());
    await settle(0);
    expect(screen.getByText(/Opening the manual form in a new tab/)).toBeInTheDocument();

    fireEvent.click(backBtn());
    await settle(0);
    expect(
      screen.queryByText(/Opening the manual form in a new tab/)
    ).not.toBeInTheDocument();
  });

  it("clears a standing error", async () => {
    await driveToPicker();
    fireEvent.click(continueBtn());
    await settle(0);
    expect(screen.getByText("Please choose an option to continue.")).toBeInTheDocument();

    fireEvent.click(backBtn());
    await settle(0);
    expect(
      screen.queryByText("Please choose an option to continue.")
    ).not.toBeInTheDocument();
  });

  it("preserves the lookup fields, so Continue reopens the picker", async () => {
    await driveToPicker();
    fireEvent.click(backBtn());
    await settle(0);
    expect(screen.getByPlaceholderText(/Tesco PLC/i)).toHaveValue(
      "Britannia Group Limited"
    );

    fireEvent.click(screen.getByRole("button", { name: /^Continue/ }));
    await settle(0);
    expect(
      screen.getByRole("heading", {
        name: /How would you like to complete your application\?/,
      })
    ).toBeInTheDocument();
  });

  it("clears a previously selected card", async () => {
    await driveToPicker();
    fireEvent.click(card(CARD_A));
    await settle(0);
    expect(card(CARD_A)).toHaveStyle({ border: "2px solid #1a3a4a" });

    fireEvent.click(backBtn());
    await settle(0);
    fireEvent.click(screen.getByRole("button", { name: /^Continue/ }));
    await settle(0);

    // Company Lookup's Continue resets selectedJourneyCard to null.
    expect(card(CARD_A)).toHaveStyle({ border: "2px solid rgba(26,58,74,0.18)" });
  });
});

describe("the search cap — unlocked state (the only reachable one)", () => {
  it("renders neither cap banner at zero attempts", async () => {
    await driveToPicker();
    expect(screen.queryByTestId("search-locked-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("legal-name-alert")).not.toBeInTheDocument();
  });

  it("leaves the two cap-aware cards enabled and fully opaque", async () => {
    await driveToPicker();
    // A and B are the only cards that read `locked` into their style
    // (opacity: locked ? 0.45 : 1). Unlocked, both sit at opacity 1.
    [CARD_A, CARD_B].forEach((title) => {
      expect(card(title)).toHaveStyle({ opacity: "1", cursor: "pointer" });
    });
  });

  it("card E is clickable and sets no opacity at all — it has no lock branch", async () => {
    await driveToPicker();
    // Recorded fact: card E is a search card that proceedFromJourney DOES cap
    // (isSearchCard includes "E"), yet its style has no locked branch, so it
    // never renders dimmed. Pinned as-is; this net does not judge it.
    expect(card(CARD_E)).toHaveStyle({ cursor: "pointer" });
    expect(card(CARD_E).style.opacity).toBe("");
  });

  it("card C carries no lock styling — it is the never-blocked exception", async () => {
    await driveToPicker();
    // Cards A/B read `locked` into cursor+opacity; card C hardcodes
    // cursor:"pointer" and opacity:0.92 and has no locked branch at all.
    expect(card(CARD_C)).toHaveStyle({ cursor: "pointer", opacity: "0.92" });
  });
});

