/**
 * Preboarding.render.test.jsx — CHARACTERISATION of the pre-boarding surface
 * while it is still inline in App.js.
 *
 * WHY NOW: extraction B lifts the analyst pre-boarding surface into
 * src/components/preboarding/. It is the last big page and the hardest to net,
 * for one structural reason: pre-boarding is NOT in the step switch. It is
 * reached through EARLY RETURNS above the main return, gated on a ?preboarding=1
 * URL param plus a password.
 *
 * WHY IT IS NETTABLE AT ALL. The param is read DURING RENDER — not in an effect,
 * not cached at module load:
 *
 *     const preboardingParam = new URLSearchParams(window.location.search).get("preboarding")
 *
 * so a test can set it with history.pushState BEFORE render() and the very first
 * render takes the pre-boarding branch. The routing block then calls
 * setAgentType("preboarding") during render and returns null; React re-renders
 * and lands on the gate. That is why this reads as a normal net-first extraction
 * rather than something needing a harness rewrite.
 *
 * THE DOSSIER VIEW NEEDS NO STUB. saveDossier() puts setShowDossierView(true)
 * OUTSIDE its try/catch, so the offline fetch rejection still opens the dossier.
 * The natural drive reaches it; only the POPULATED invite link needs a stub.
 *
 * ONE STUB, DELIBERATELY. /api/save-dossier is stubbed to resolve with a
 * dossierId for the populated-invite tests. Without it dossierId stays null and
 * generateLink() takes its legacy `?ref=` fallback — a real path, covered
 * separately. Both branches are live user paths, so both are pinned. Same shape
 * as the AI-Documents net's /api/self-source stub.
 *
 * CHARACTERISATION, not specification: these assert what the surface does TODAY.
 * After B's move this file must stay green UNCHANGED — with ONE deliberate
 * exception flagged inline below (the back-button dead end).
 */

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import KYCAgent from "../../../App";

jest.setTimeout(60000);

let fetchRoutes = {};

beforeEach(() => {
  fetchRoutes = {};
  global.fetch = jest.fn((url, opts) => {
    const key = Object.keys(fetchRoutes).find((k) => String(url).includes(k));
    if (key) return fetchRoutes[key](url, opts);
    return Promise.reject(new Error("offline test"));
  });
  jest.useFakeTimers();
  // The entry mechanism: the param is read during render, so it must be set
  // BEFORE the first render for the early-return branch to fire.
  window.history.pushState({}, "", "/?preboarding=1");
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

const settle = async (ms = 5000) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

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

const codeInput = () => screen.getByPlaceholderText(/Enter access code/i);

/** Step 1 — pushState is already done in beforeEach; this just mounts. */
async function mountAtGate() {
  await act(async () => {
    render(<KYCAgent />);
  });
  await settle(0);
}

/** Step 2 — ARCH is the PREBOARDING_PASSWORD constant in App.js. */
async function unlock() {
  fireEvent.change(codeInput(), { target: { value: "ARCH" } });
  fireEvent.click(buttonsWithText(/Access Pre-boarding Agent/i)[0]);
  await settle(0);
}

/** Step 3+4 — lookup → dummy research → confirm → auto-save → dossier view. */
async function driveToDossier() {
  await mountAtGate();
  await unlock();

  fireEvent.change(screen.getByPlaceholderText(/Tesco PLC/i), {
    target: { value: "Britannia Group Limited" },
  });
  fireEvent.change(screen.getByPlaceholderText(/Select or type entity type/i), {
    target: { value: "Corporate" },
  });
  pickOption("🏛 Corporate");
  fireEvent.focus(screen.getByPlaceholderText(/Select ownership type/i));
  pickOption("Private Limited Company");
  fireEvent.change(screen.getByPlaceholderText(/Select or type country/i), {
    target: { value: "United King" },
  });
  pickOption("GB — United Kingdom");

  fireEvent.click(screen.getByRole("button", { name: /Dummy Research/i }));
  await settle(5000);
  // The auto-save effect waits ~500ms before calling saveDossier().
  await settle(5000);
}

/** Step 5 — the dossier's invite control. */
async function driveToInvite() {
  await driveToDossier();
  fireEvent.click(buttonsWithText(/Invite Customer to Onboard/i)[0]);
  await settle(0);
}

/* ═══════════════════════════════════════════
   1. The gate — entry and unlock
   ═══════════════════════════════════════════ */
describe("pre-boarding gate", () => {
  it("?preboarding=1 lands on the gate, not the onboarding lookup screen", async () => {
    await mountAtGate();
    expect(bodyText()).toMatch(/Pre-boarding Agent/i);
    expect(codeInput()).toBeInTheDocument();
    // The normal onboarding entry must NOT be what rendered.
    expect(
      screen.queryByRole("heading", { name: /Company Lookup/i })
    ).not.toBeInTheDocument();
  });

  it("renders the access-code prompt as a password field", async () => {
    await mountAtGate();
    expect(codeInput()).toHaveAttribute("type", "password");
    expect(buttonsWithText(/Access Pre-boarding Agent/i).length).toBe(1);
  });

  it("a wrong code does NOT unlock", async () => {
    await mountAtGate();
    fireEvent.change(codeInput(), { target: { value: "WRONG" } });
    fireEvent.click(buttonsWithText(/Access Pre-boarding Agent/i)[0]);
    await settle(0);
    // Still gated.
    expect(screen.getByPlaceholderText(/Enter access code/i)).toBeInTheDocument();
  });

  it("ARCH unlocks and reveals the pre-boarding flow", async () => {
    await mountAtGate();
    await unlock();
    expect(
      screen.queryByPlaceholderText(/Enter access code/i)
    ).not.toBeInTheDocument();
    // Purple pre-boarding chrome, not the onboarding header.
    expect(bodyText()).toMatch(/Pre-boarding/i);
    expect(screen.getByPlaceholderText(/Tesco PLC/i)).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════
   2. THE BACK-BUTTON DEAD END — pins a BUG
   ═══════════════════════════════════════════ */
describe("back to agent selection", () => {
  /**
   * ⚠ PINS THE CURRENT *BROKEN* BEHAVIOUR — this is deliberate.
   *
   * "← Back to agent selection" calls setAgentType(null). The routing block then
   * re-derives agentType from the URL, and ?preboarding=1 is STILL set, so it
   * immediately flips back to "preboarding" and the gate re-traps the user. The
   * button therefore does nothing observable.
   *
   * Compounding it: the agent-selection screen it targets (renderLandingPage) is
   * itself parked, so there is nowhere to go back TO even if the param cleared.
   *
   * The fix commit will clear ?preboarding=1 on this action, and THIS ASSERTION
   * WILL BE UPDATED to expect a return to agent selection. That update is the
   * visible proof the fix worked. Do not "fix" the test to match a fix that has
   * not landed.
   */
  it("currently DEAD-ENDS — clicking Back leaves the user in pre-boarding", async () => {
    await mountAtGate();
    expect(codeInput()).toBeInTheDocument();

    fireEvent.click(buttonsWithText(/Back to agent selection/i)[0]);
    await settle(0);

    // The param survives the click, so the routing block re-traps us.
    expect(
      new URLSearchParams(window.location.search).get("preboarding")
    ).toBe("1");
    // Still on the gate — NOT on agent selection.
    expect(screen.getByPlaceholderText(/Enter access code/i)).toBeInTheDocument();
    expect(bodyText()).not.toMatch(/Select the agent you would like to work with/i);
  });
});

/* ═══════════════════════════════════════════
   3. The dossier view — reached with NO stub
   ═══════════════════════════════════════════ */
describe("dossier view", () => {
  it("opens after research even though the offline save fails", async () => {
    await driveToDossier();
    // setShowDossierView(true) sits outside saveDossier's try/catch.
    expect(bodyText()).toMatch(/Intelligence Dossier/i);
  });

  it("headers the dossier with the researched company", async () => {
    await driveToDossier();
    expect(bodyText()).toContain("Britannia Group Limited");
  });

  it("renders the coverage tiles derived from the research", async () => {
    await driveToDossier();
    const text = bodyText();
    expect(text).toMatch(/Verified/);
    expect(text).toMatch(/To Request/);
  });

  it("renders the verified findings section", async () => {
    await driveToDossier();
    expect(bodyText()).toMatch(/fields from official sources/i);
  });

  it("renders the Customer Request section", async () => {
    await driveToDossier();
    expect(bodyText()).toMatch(/📋 Customer Request/);
  });

  /**
   * COVERAGE GAP, recorded rather than papered over. renderDossierDocuments()
   * returns null when there are no documents, and the pre-boarding drive never
   * populates docSearchResults / selfSourceResults — those are filled by the
   * ai_documents journey's Documents step, which pre-boarding skips entirely
   * (its doc-search effect is gated on isAiDocs && step === STEPS.documents).
   * There is no fetch to stub that would reach it on this path.
   *
   * So this pins the REAL current behaviour — the section is absent — which
   * still catches a move that made it render unconditionally. The populated
   * documents list needs a fixture variant and is NOT covered here.
   */
  it("omits the Documents Sourced section when no documents were sourced", async () => {
    await driveToDossier();
    expect(bodyText()).toMatch(/Intelligence Dossier/i); // we are on the dossier
    expect(bodyText()).not.toMatch(/📄 Documents Sourced/);
  });

  it("renders the stakeholder rows from research.found", async () => {
    await driveToDossier();
    // Dummy research ships directors/UBOs; the dossier lists them by name.
    expect(bodyText()).toMatch(/Director|UBO|Beneficial/i);
  });

  it("offers the invite and fresh-dossier actions", async () => {
    await driveToDossier();
    expect(buttonsWithText(/Invite Customer to Onboard/i).length).toBe(1);
  });
});

/* ═══════════════════════════════════════════
   4. The ask-more panel (analyst questions)
   ═══════════════════════════════════════════ */
describe("ask for more information", () => {
  it("offers the ask-more button inside the Customer Request section", async () => {
    await driveToDossier();
    expect(buttonsWithText(/Ask for more information/i).length).toBeGreaterThan(0);
  });

  it("opening the panel reveals the question builder and flips the button to Cancel", async () => {
    await driveToDossier();
    fireEvent.click(buttonsWithText(/Ask for more information/i)[0]);
    await settle(0);

    expect(
      screen.getByPlaceholderText(/Please provide your primary banking relationship/i)
    ).toBeInTheDocument();
    const text = bodyText();
    expect(text).toMatch(/Answer type/i);
    expect(text).toMatch(/Text \(free form\)/i);
    expect(buttonsWithText(/Cancel/i).length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════
   5. The invite screen — BOTH branches
   ═══════════════════════════════════════════ */
describe("invite screen", () => {
  const inviteForm = () => ({
    name: screen.getByPlaceholderText(/Sarah Chen/i),
    email: screen.getByPlaceholderText(/sarah@company.com/i),
  });

  async function sendInvite() {
    const { name, email } = inviteForm();
    fireEvent.change(name, { target: { value: "Sarah Chen" } });
    fireEvent.change(email, { target: { value: "sarah@company.com" } });
    await settle(0);
    fireEvent.click(buttonsWithText(/Send invite/i)[0]);
    await settle(0);
  }

  it("the dossier's invite control opens the invite screen", async () => {
    await driveToInvite();
    expect(inviteForm().name).toBeInTheDocument();
    expect(inviteForm().email).toBeInTheDocument();
    // The dossier is no longer showing — invite takes priority.
    expect(bodyText()).not.toMatch(/📄 Documents Sourced/);
  });

  // ── FALLBACK branch: no stub, save fails, dossierId stays null ──
  it("FALLBACK — with no saved dossier the link falls back to a ?ref= token", async () => {
    await driveToInvite();
    await sendInvite();

    const text = bodyText();
    expect(text).toMatch(/Onboarding link/i);
    expect(text).toContain("?ref=");
    expect(text).not.toContain("dossierId=");
  });

  // ── POPULATED branch: /api/save-dossier stubbed so dossierId is real ──
  it("POPULATED — a saved dossier produces a dossier-backed customer link", async () => {
    fetchRoutes["/api/save-dossier"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ dossierId: "dossier_abc123" }),
      });

    await driveToInvite();
    await sendInvite();

    const text = bodyText();
    expect(text).toMatch(/Onboarding link/i);
    expect(text).toContain("dossierId=dossier_abc123");
    expect(text).toContain("journey=customer");
    // The legacy fallback must NOT be used when a dossier exists.
    expect(text).not.toContain("?ref=");
  });

  it("POPULATED — offers a copy control alongside the link", async () => {
    fetchRoutes["/api/save-dossier"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ dossierId: "dossier_abc123" }),
      });

    await driveToInvite();
    await sendInvite();
    expect(buttonsWithText(/Copy link/i).length).toBe(1);
  });
});
