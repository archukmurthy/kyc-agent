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
 * Send invite is disabled — a saved dossier is required to produce a working,
 * cross-device link (the legacy `?ref=` localStorage-snapshot link is no longer
 * generated or emailed). Same shape as the AI-Documents net's /api/self-source
 * stub.
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
  fetchRoutes["/api/preboarding-auth"] = (url, opts) =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve(
          opts && opts.method === "POST"
            ? { success: true, token: "ARCH", tenantId: "nium", companyName: "Nium" }
            : { available: true, reason: null, companyName: "Nium" }
        ),
    });
  global.fetch = jest.fn((url, opts) => {
    const key = Object.keys(fetchRoutes).find((k) => String(url).includes(k));
    if (key) return fetchRoutes[key](url, opts);
    return Promise.reject(new Error("offline test"));
  });
  jest.useFakeTimers();
  window.history.pushState({}, "", "/preboarding?tenant=nium");
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
    render(<KYCAgent preboarding />);
  });
  await settle(0);
}

/** Step 2 — the password is checked by /api/preboarding-auth, not the bundle. */
async function unlock(code = "ARCH") {
  fireEvent.change(codeInput(), { target: { value: code } });
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
  pickOption("GB - United Kingdom");

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
   1. The gate - entry and unlock
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

  it("REGRESSION (Finding 1): /preview with the legacy pre-boarding param stays on the gate, in preview mode, instead of falling through to the customer flow", async () => {
    // Mirrors how index.js's /preview branch renders KYCAgent now that it
    // passes the legacy-param-derived preboarding flag alongside previewMode.
    // Before that fix the branch rendered `<KYCAgent previewMode />` with no
    // preboarding prop, so `isPreboardingSurface` was false, the redirect
    // effect's early-return guard never tripped, and the component fell
    // through to the ordinary customer flow instead of the gate — discarding
    // preview mode. See task-11-report.md for this test's failing run against
    // the pre-fix call shape.
    //
    // LIMIT OF THIS TEST: it renders `<KYCAgent previewMode preboarding />`
    // directly, proving the COMPONENT's contract for that prop combination.
    // It does not — and under jsdom cannot — execute src/index.js itself, so
    // it cannot catch a regression in index.js's /preview branch (e.g. a
    // revert back to `<KYCAgent previewMode />` with the preboarding prop
    // dropped). That branch has no test of its own; a future reader should
    // not mistake this test for end-to-end coverage of it.
    await act(async () => {
      render(<KYCAgent previewMode preboarding />);
    });
    await settle(0);
    expect(bodyText()).toMatch(/Pre-boarding Agent/i);
    expect(codeInput()).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Company Lookup/i })
    ).not.toBeInTheDocument();
  });

  it("renders the access-code prompt as a password field", async () => {
    await mountAtGate();
    expect(codeInput()).toHaveAttribute("type", "password");
    expect(buttonsWithText(/Access Pre-boarding Agent/i).length).toBe(1);
  });

  it("a wrong code does NOT unlock — the server rejects it", async () => {
    await mountAtGate();
    fetchRoutes["/api/preboarding-auth"] = (url, opts) =>
      Promise.resolve(
        opts && opts.method === "POST"
          ? { ok: false, status: 401, json: () => Promise.resolve({ error: "invalid_password" }) }
          : { ok: true, json: () => Promise.resolve({ available: true, reason: null, companyName: "Nium" }) }
      );
    await unlock("WRONG");
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

  it("a tenant with pre-boarding switched off never shows the password form", async () => {
    fetchRoutes["/api/preboarding-auth"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: false, reason: "preboarding_disabled", companyName: "Acme" }),
      });
    await mountAtGate();
    expect(screen.queryByPlaceholderText(/Enter access code/i)).not.toBeInTheDocument();
    expect(bodyText()).toMatch(/not available/i);
  });

  it("a deactivated tenant is told so, not gated", async () => {
    fetchRoutes["/api/preboarding-auth"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: false, reason: "tenant_inactive", companyName: "Acme" }),
      });
    await mountAtGate();
    expect(screen.queryByPlaceholderText(/Enter access code/i)).not.toBeInTheDocument();
    expect(bodyText()).toMatch(/not active|deactivated/i);
  });

  it("an unknown tenant is told so, not gated", async () => {
    fetchRoutes["/api/preboarding-auth"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: false, reason: "tenant_not_found", companyName: "" }),
      });
    await mountAtGate();
    expect(screen.queryByPlaceholderText(/Enter access code/i)).not.toBeInTheDocument();
    expect(bodyText()).toMatch(/don't recognise|not recognised|doesn't exist/i);
  });

  it("the availability probe rejecting (offline/server error) degrades to the unavailable screen, not a crash or a password box", async () => {
    // PreboardingGate's probe effect has a `catch` fallback for a rejected
    // fetch (network down, server 500 before it can even answer) that no
    // other test exercises — it always resolves. Force that branch: the GET
    // probe rejects outright rather than resolving with an `available` body.
    fetchRoutes["/api/preboarding-auth"] = () => Promise.reject(new Error("network down"));
    await mountAtGate();
    expect(screen.queryByPlaceholderText(/Enter access code/i)).not.toBeInTheDocument();
    expect(bodyText()).toMatch(/don't recognise|not recognised|doesn't exist/i);
  });

  it("/preboarding with no tenant explains what to add instead of gating", async () => {
    window.history.pushState({}, "", "/preboarding");
    await act(async () => { render(<KYCAgent preboarding />); });
    await settle(0);
    expect(screen.queryByPlaceholderText(/Enter access code/i)).not.toBeInTheDocument();
    expect(bodyText()).toMatch(/No tenant selected/i);
    expect(bodyText()).toMatch(/analyst flow/i);
  });
});

/* ═══════════════════════════════════════════
   2. THE BACK-BUTTON DEAD END - pins a BUG
   ═══════════════════════════════════════════ */
describe("back to agent selection", () => {
  /**
   * The button is now PARKED (commented out in PreboardingGate.jsx), so this
   * asserts its ABSENCE. That is a deliberate behaviour change, not a drift.
   *
   * PREVIOUSLY this assertion pinned the button's dead end: clicking it called
   * setAgentType(null), the routing block re-derived agentType from the still-set
   * ?preboarding=1 param, and the gate re-trapped the user — so the control did
   * nothing observable.
   *
   * It was parked rather than fixed because its destination is parked. The button
   * points at the agent-selection screen (renderLandingPage in App.js), which is
   * itself commented out; a control pointing at a parked destination has nowhere
   * to go even if the param were cleared. Removing the affordance is the honest
   * state, not papering over a bug.
   *
   * RE-ENABLE the button together with renderLandingPage, and at that point this
   * assertion should be rewritten again — to expect an actual return to agent
   * selection.
   */
  it("the back-to-agent-selection control is PARKED - no dead-end affordance renders", async () => {
    await mountAtGate();
    expect(codeInput()).toBeInTheDocument();

    // The button is commented out, so it must not render at all.
    expect(buttonsWithText(/Back to agent selection/i).length).toBe(0);
    expect(bodyText()).not.toMatch(/Back to agent selection/i);

    // The gate itself is unaffected — the access control is still the way through.
    expect(buttonsWithText(/Access Pre-boarding Agent/i).length).toBe(1);
  });
});

/* ═══════════════════════════════════════════
   3. The dossier view - reached with NO stub
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

  /* ── save-failure banner (this fix) ── */
  it("shows a save-failure banner with a Retry save button when the offline save fails", async () => {
    // No /api/save-dossier stub is registered, so the fetch mock rejects
    // ("offline test") and saveDossier's catch sets dossierSaveError.
    await driveToDossier();
    expect(bodyText()).toMatch(/hasn't been saved/i);
    expect(buttonsWithText(/Retry save/i).length).toBe(1);
  });

  it("disables Invite Customer to Onboard with a hint while unsaved (dossierId is null)", async () => {
    await driveToDossier();
    const inviteButton = buttonsWithText(/Invite Customer to Onboard/i)[0];
    expect(inviteButton).toBeDisabled();
    expect(bodyText()).toMatch(/Save the dossier before inviting\./i);
  });

  it("Retry save clears the banner and enables Invite once the save succeeds", async () => {
    await driveToDossier();
    expect(buttonsWithText(/Retry save/i).length).toBe(1);

    fetchRoutes["/api/save-dossier"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, dossierId: "dossier_retry123" }),
      });

    fireEvent.click(buttonsWithText(/Retry save/i)[0]);
    await settle(0);

    expect(bodyText()).not.toMatch(/hasn't been saved/i);
    expect(buttonsWithText(/Retry save/i).length).toBe(0);
    expect(buttonsWithText(/Invite Customer to Onboard/i)[0]).not.toBeDisabled();
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
   5. The invite screen - BOTH branches
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
    // Reaching the invite screen now requires a saved dossier (this fix
    // disables the DossierView Invite button until dossierId is set), so
    // stub the save to succeed before driving through it.
    fetchRoutes["/api/save-dossier"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, dossierId: "dossier_abc123" }),
      });

    await driveToInvite();
    expect(inviteForm().name).toBeInTheDocument();
    expect(inviteForm().email).toBeInTheDocument();
    // The dossier is no longer showing — invite takes priority.
    expect(bodyText()).not.toMatch(/📄 Documents Sourced/);
  });

  // ── UNSAVED branch: no stub, save fails, dossierId stays null. This fix
  // moves the gate earlier — the DossierView Invite button is now disabled,
  // so the invite screen is never reached at all (InviteScreen's own
  // dossierId-gated Send button, asserted separately, is defense-in-depth
  // for the unlikely case dossierId is cleared after this screen opens). ──
  it("UNSAVED - with no saved dossier, the invite screen is never reached", async () => {
    await driveToDossier();

    const inviteButton = buttonsWithText(/Invite Customer to Onboard/i)[0];
    expect(inviteButton).toBeDisabled();

    fireEvent.click(inviteButton);
    await settle(0);

    // Still on the dossier — clicking a disabled button does not navigate.
    expect(bodyText()).toMatch(/Intelligence Dossier/i);
    expect(screen.queryByPlaceholderText(/Sarah Chen/i)).not.toBeInTheDocument();
  });

  // ── POPULATED branch: /api/save-dossier stubbed so dossierId is real ──
  it("POPULATED - a saved dossier produces a dossier-backed customer link", async () => {
    fetchRoutes["/api/save-dossier"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ dossierId: "dossier_abc123" }),
      });
    fetchRoutes["/api/invite"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          sent: false,
          simulated: true,
          link: "http://localhost/?tenant=nium&dossierToken=signed.tok&journey=customer",
        }),
      });

    await driveToInvite();
    await sendInvite();

    const text = bodyText();
    expect(text).toMatch(/Onboarding link/i);
    expect(text).toContain("dossierToken=signed.tok");
    expect(text).toContain("journey=customer");
    // No raw dossier id and no legacy link ever reach the screen.
    expect(text).not.toContain("dossierId=");
    expect(text).not.toContain("?ref=");
  });

  it("POPULATED - offers a copy control alongside the link", async () => {
    fetchRoutes["/api/save-dossier"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ dossierId: "dossier_abc123" }),
      });
    fetchRoutes["/api/invite"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          sent: false,
          simulated: true,
          link: "http://localhost/?tenant=nium&dossierToken=signed.tok&journey=customer",
        }),
      });

    await driveToInvite();
    await sendInvite();
    expect(buttonsWithText(/Copy link/i).length).toBe(1);
  });

  it("POPULATED - the invite request carries the analyst credential", async () => {
    fetchRoutes["/api/save-dossier"] = () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, dossierId: "dossier_abc123" }) });
    let inviteHeaders = null;
    fetchRoutes["/api/invite"] = (url, opts) => {
      inviteHeaders = opts && opts.headers;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ link: "http://localhost/?tenant=nium&dossierToken=t&journey=customer" }) });
    };
    await driveToInvite();
    await sendInvite();
    expect(inviteHeaders.Authorization).toBe("Bearer ARCH");
  });

  /* ── Finding 1: a failed /api/invite must show a visible error, not silently no-op ── */

  it("401 unauthorized - shows a session-expired message and no link", async () => {
    fetchRoutes["/api/save-dossier"] = () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, dossierId: "dossier_abc123" }) });
    fetchRoutes["/api/invite"] = () =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "unauthorized" }),
      });

    await driveToInvite();
    await sendInvite();

    expect(bodyText()).toMatch(/pre-boarding session is no longer valid/i);
    expect(bodyText()).not.toMatch(/Invite sent to/i);
    expect(buttonsWithText(/Copy link/i).length).toBe(0);
    // Still on the invite form, not silently stuck - Send invite is available to retry.
    expect(buttonsWithText(/Send invite/i).length).toBe(1);
  });

  it("500 not_configured - shows a generic retry message and no link", async () => {
    fetchRoutes["/api/save-dossier"] = () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, dossierId: "dossier_abc123" }) });
    fetchRoutes["/api/invite"] = () =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "not_configured" }),
      });

    await driveToInvite();
    await sendInvite();

    expect(bodyText()).toMatch(/Couldn't create the invite link\. Try again\./i);
    expect(bodyText()).not.toMatch(/Invite sent to/i);
    expect(buttonsWithText(/Copy link/i).length).toBe(0);
  });

  it("a retried send clears the previous error once it succeeds", async () => {
    fetchRoutes["/api/save-dossier"] = () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, dossierId: "dossier_abc123" }) });
    fetchRoutes["/api/invite"] = () =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "lookup_failed" }) });

    await driveToInvite();
    await sendInvite();
    expect(bodyText()).toMatch(/Couldn't create the invite link\. Try again\./i);

    fetchRoutes["/api/invite"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ link: "http://localhost/?tenant=nium&dossierToken=signed.tok&journey=customer" }),
      });
    fireEvent.click(buttonsWithText(/Send invite/i)[0]);
    await settle(0);

    expect(bodyText()).not.toMatch(/Couldn't create the invite link\. Try again\./i);
    expect(bodyText()).toMatch(/Onboarding link/i);
  });
});
