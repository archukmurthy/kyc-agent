/**
 * JourneyPicker.jsx — the journey-selection screen of the onboarding wizard
 * ("How would you like to complete your application?").
 *
 * EXTRACTED FROM App.js as a PURE MOVE, zero behaviour change. The page's JSX
 * moved here VERBATIM — the body below is the same text that ran in App.js at
 * {step === STEPS.input && journeyOpen}. What changed is only how it gets its
 * data: it used to close over App's scope, and now arrives through the prop
 * interface declared on the component.
 *
 * PROP NAMES DELIBERATELY MATCH THE OLD APP IDENTIFIERS, destructured back into
 * locals of the same name, so the moved body stays byte-identical. `card` is the
 * one rename (cardStyle → card), the same aliasing ConfirmStep and ApplicantPage
 * use, and it is re-bound below before the body runs.
 *
 * THIS COMPONENT OWNS NO STATE. Every one of the picker's useStates has a
 * consumer outside this screen, so all of them stayed in App.js and are drilled:
 *
 *   - journeyOpen stays because THREE other places write or read it: resetAll,
 *     doResearch's customer-failure fallback, ConfirmStep, and the AI-Documents
 *     step's "← Back" control. It is not this component's to own; the guard that
 *     mounts this component still lives in App's return.
 *   - journeyType stays because stepsFor/isAiDocs/STEPS derive the whole step
 *     machine from it.
 *   - selectedJourneyCard / manualOpened stay because proceedFromJourney and
 *     resetAll drive them, and ConfirmStep resets them on a re-search.
 *   - searchAttempts stays (read-only here); the server counter is authoritative
 *     and buildDossierPayload carries it.
 *   - companyName / countryCode are READ-ONLY here — three references, all in
 *     the Nium fixture check and the resolver button. They belong to the Company
 *     Lookup screen, which is still inline in App.js (its own later slice).
 *
 * The research kickoffs (proceedFromJourney, startNiumApiLookup,
 * findNiumRegNumber) stay in App.js and are drilled. Their call sites moved; the
 * functions did not — proceedFromJourney in particular writes searchAttempts,
 * posts to /api/search-attempt and routes into the AI-Documents step, none of
 * which is this component's business.
 *
 * The oracle is JourneyPicker.render.test.jsx (37 tests), written against the
 * INLINE picker before this move and which must stay green UNCHANGED.
 *
 * NOTE ON THE LOCKED SEARCH-CAP BRANCH: the evaluateSearchCap lock (banner,
 * opacity-0.45 cards, not-allowed cursor, CONTACT_ADMIN_MSG) moved byte-identical
 * even though no test reaches it. It is currently unreachable in the running app
 * — `const [seededBy] = useState("analyst")` has no setter, so the increment in
 * proceedFromJourney never fires and searchAttempts is pinned at 0. That is a
 * pre-existing, separately-logged gap. It is NOT this move's business to fix,
 * and the wiring it uses is the same drilled searchAttempts the covered unlocked
 * state uses.
 */

import React from "react";
import {
  SHOW_TEST_TOOLS,
  TEST_FLAG,
} from "../../constants/appConstants";
import {
  evaluateSearchCap,
  LEGAL_NAME_ALERT,
  CONTACT_ADMIN_MSG,
} from "../../reresearch/searchPolicy";
import { DemoToggle } from "../banners/DemoToggle";

export function JourneyPicker({
  // ── chrome ──
  cardStyle,
  Btn,
  // ── demo mode ──
  demoMode,
  setDemoMode,
  demoToggleVisible,
  // ── the two-retry search cap (read-only; App owns the counter) ──
  searchAttempts,
  // ── journey selection ──
  selectedJourneyCard,
  setSelectedJourneyCard,
  setJourneyOpen,
  manualOpened,
  setManualOpened,
  proceedFromJourney,
  // ── shared error channel ──
  error,
  setError,
}) {
  const card = cardStyle;

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>How would you like to complete your application?</h2>
          <p style={{ fontSize: 13, color: "#1a3a4a80", margin: "0 0 18px" }}>Choose the option that works best for you. You can always go back and change this.</p>
        </div>
        {SHOW_TEST_TOOLS && (demoToggleVisible || TEST_FLAG) && (
          <div style={{ flexShrink: 0 }}>
            <DemoToggle on={demoMode} onChange={setDemoMode} />
          </div>
        )}
      </div>

      {/* Two-retry cap notices: legal-name tip on the second attempt, and
          the lockout-to-manual message once searches are used up. */}
      {(() => {
        const cap = evaluateSearchCap(searchAttempts);
        if (cap.locked) {
          return (
            <div data-testid="search-locked-banner" style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#b91c1c", marginBottom: 14 }}>
              {CONTACT_ADMIN_MSG}
            </div>
          );
        }
        if (cap.isSecondAttempt) {
          return (
            <div data-testid="legal-name-alert" style={{ background: "#fff8ed", border: "1px solid #fcd9a8", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#9d6500", marginBottom: 14 }}>
              <strong>Tip:</strong> {LEGAL_NAME_ALERT}
            </div>
          );
        }
        return null;
      })()}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 14 }}>
        {/* Card A */}
        {(() => {
          const sel = selectedJourneyCard === "A";
          const locked = evaluateSearchCap(searchAttempts).locked;
          return (
            <div
              onClick={() => { if (locked) { setError(CONTACT_ADMIN_MSG); return; } setSelectedJourneyCard("A"); setError(""); }}
              style={{
                position: "relative", padding: "18px 16px", borderRadius: 12, cursor: locked ? "not-allowed" : "pointer",
                background: sel ? "#f0f9f6" : "#fafcfb",
                border: `2px solid ${sel ? "#1a3a4a" : "rgba(26,58,74,0.18)"}`,
                boxShadow: sel ? "0 6px 18px rgba(26,58,74,0.12)" : "none",
                opacity: locked ? 0.45 : 1,
              }}
            >
              <span style={{ position: "absolute", top: 10, right: 10, background: "#4a9e8e", color: "#fff", fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 999, textTransform: "uppercase" }}>Recommended</span>
              <div style={{ fontSize: 24, marginBottom: 6 }}>🔍📄</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Upload documents &amp; let AI fill the rest</div>
              <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>Upload any documents you have — we extract data from them instantly. For anything we can't find in your documents, our AI searches public registries and web sources.</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#4a9e8e" }}>Fastest · Most accurate · Lowest effort</div>
            </div>
          );
        })()}

        {/* Card B */}
        {(() => {
          const sel = selectedJourneyCard === "B";
          const locked = evaluateSearchCap(searchAttempts).locked;
          return (
            <div
              onClick={() => { if (locked) { setError(CONTACT_ADMIN_MSG); return; } setSelectedJourneyCard("B"); setError(""); }}
              style={{
                padding: "18px 16px", borderRadius: 12, cursor: locked ? "not-allowed" : "pointer",
                background: sel ? "#f0f3f8" : "#fafcfb",
                border: `2px solid ${sel ? "#1a3a4a" : "rgba(26,58,74,0.12)"}`,
                opacity: locked ? 0.45 : 1,
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 6 }}>🔍</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Let AI research your company</div>
              <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>No documents needed. Our AI searches Companies House, regulatory registers, annual reports and other public sources to pre-fill your application.</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#4a9e8e" }}>~30 seconds · No uploads needed</div>
            </div>
          );
        })()}

        {/* Card C */}
        {(() => {
          const sel = selectedJourneyCard === "C";
          return (
            <div
              onClick={() => { setSelectedJourneyCard("C"); setError(""); }}
              style={{
                padding: "18px 16px", borderRadius: 12, cursor: "pointer",
                background: sel ? "#f5f5f5" : "#f8f8f8",
                border: `2px solid ${sel ? "#1a3a4a" : "rgba(26,58,74,0.1)"}`,
                opacity: 0.92,
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 6 }}>✏️</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>I'll complete the form myself</div>
              <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>Skip the AI research and fill everything manually using your own records. You'll be redirected to our standard application form.</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#1a3a4a90" }}>Full control · No AI · ~15 minutes</div>
            </div>
          );
        })()}

        {/* Card E — Max Prefill. Runs every available source at once for
            the highest possible pre-fill. The dedicated pipeline is TBD
            (wired next); for now selecting it routes through standard AI
            research so both the onboarding and pre-boarding flows demo end
            to end. Always visible (prod + test versions of this page). */}
        {(() => {
          const sel = selectedJourneyCard === "E";
          return (
            <div
              onClick={() => { setSelectedJourneyCard("E"); setError(""); }}
              style={{
                position: "relative", padding: "18px 16px", borderRadius: 12, cursor: "pointer",
                background: sel ? "#F5F3FF" : "#fbfaff",
                border: `2px solid ${sel ? "#7C3AED" : "rgba(124,58,237,0.22)"}`,
                boxShadow: sel ? "0 6px 18px rgba(124,58,237,0.12)" : "none",
              }}
            >
              <span style={{ position: "absolute", top: 10, right: 10, background: "#7C3AED", color: "#fff", fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 999, textTransform: "uppercase" }}>New</span>
              <div style={{ fontSize: 24, marginBottom: 6 }}>🚀</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Run for max prefill</div>
              <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>Pull from every available source at once — uploaded documents, public registries, web research and Nium's KYB data — to pre-fill as much of your application as possible.</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#7C3AED" }}>Most comprehensive · Highest coverage</div>
            </div>
          );
        })()}
      </div>

      {manualOpened && (
        <div style={{ marginTop: 4, marginBottom: 12, padding: "10px 14px", background: "#f0f3f8", borderRadius: 8, fontSize: 12, color: "#1a3a4a", borderLeft: "3px solid #1a3a4a" }}>
          Opening the manual form in a new tab… You can also continue with AI assistance above.
        </div>
      )}

      {demoMode && (
        <div style={{ marginBottom: 12, padding: "10px 14px", background: "#FEF3C7", borderRadius: 8, fontSize: 12, color: "#92400E", borderLeft: "3px solid #FCD34D" }}>
          Demo mode active — using sample data. Document extraction and web research are simulated.
        </div>
      )}

      {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 14 }}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <Btn variant="secondary" onClick={() => { setJourneyOpen(false); setManualOpened(false); setError(""); }}>← Back</Btn>
        <Btn variant="primary" onClick={proceedFromJourney}>Continue →</Btn>
      </div>
    </div>
  );
}
