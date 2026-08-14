/**
 * PreboardingGate.jsx — the analyst password gate, screen 1 of pre-boarding.
 *
 * EXTRACTED FROM App.js as a PURE MOVE, zero behaviour change. Reached from the
 * ?preboarding=1 early-return block, which STAYS in App.js as control flow; this
 * component is mounted from inside that block exactly where renderPreboardingGate()
 * was called.
 *
 * CONTAINS A KNOWN BUG, MOVED VERBATIM. "← Back to agent selection" calls
 * setAgentType(null), but the routing block re-derives agentType from the URL and
 * ?preboarding=1 is still set, so it flips straight back to "preboarding" and the
 * gate re-traps the user. The button does nothing observable. Preboarding.render
 * .test.jsx PINS that dead end deliberately; a separate later commit clears the
 * param and updates the assertion. Do NOT fix it here — doing so turns the oracle
 * red, correctly.
 *
 * THIS COMPONENT OWNS NO STATE. Everything is drilled.
 */

import React from "react";
import { C } from "../../constants/theme";

export function PreboardingGate({
  PREBOARDING_PASSWORD,
  preboardingPassword,
  setPreboardingPassword,
  preboardingPasswordError,
  setPreboardingPasswordError,
  setPreboardingUnlocked,
  setStep,
  setError,
  agentType,
  setAgentType,
  trackEvent,
}) {
    const handlePasswordSubmit = () => {
      if (preboardingPassword === PREBOARDING_PASSWORD) {
        trackEvent("preboarding_password_correct", {
          unlockedAt: new Date().toISOString(),
        });
        setPreboardingUnlocked(true);
        setPreboardingPasswordError(false);
        setStep(0); // start the pre-boarding flow at the company-input step
        setError("");
      } else {
        trackEvent("preboarding_password_failed", {
          attemptedAt: new Date().toISOString(),
          // Never log the actual password attempt.
        });
        setPreboardingPasswordError(true);
        setPreboardingPassword("");
      }
    };

    return (
      <div style={{
        minHeight: "100vh",
        background: C.background,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
        color: C.text,
      }}>
        <div style={{
          width: "100%", maxWidth: 400, background: C.surface, borderRadius: 16,
          padding: "40px 36px", border: `1px solid ${C.border}`,
          boxShadow: "0 8px 32px rgba(0,0,0,0.06)", textAlign: "center",
        }}>
          <div style={{ fontSize: 40, marginBottom: 20 }}>🔒</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: "0 0 8px 0" }}>
            Pre-boarding Agent
          </h2>
          <p style={{ fontSize: 14, color: C.textSec, marginBottom: 28, lineHeight: 1.5 }}>
            This feature is currently under development and restricted to authorised access only.
          </p>

          <div style={{ marginBottom: 16 }}>
            <input
              type="password"
              value={preboardingPassword}
              onChange={e => {
                setPreboardingPassword(e.target.value);
                setPreboardingPasswordError(false);
              }}
              onKeyDown={e => { if (e.key === "Enter") handlePasswordSubmit(); }}
              placeholder="Enter access code"
              autoFocus
              style={{
                width: "100%", padding: "12px 16px", fontSize: 15,
                border: `1.5px solid ${preboardingPasswordError ? C.error : C.border}`,
                borderRadius: 8, outline: "none", fontFamily: "inherit",
                background: C.surface, color: C.text, boxSizing: "border-box",
                textAlign: "center", letterSpacing: "0.2em",
              }}
            />
            {preboardingPasswordError && (
              <p style={{ fontSize: 12, color: C.error, marginTop: 6, textAlign: "center" }}>
                Incorrect access code. Please try again.
              </p>
            )}
          </div>

          <button
            onClick={handlePasswordSubmit}
            style={{
              width: "100%", padding: "12px 0", background: "#7C3AED", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700,
              fontFamily: "inherit", cursor: "pointer", marginBottom: 16,
            }}
          >
            Access Pre-boarding Agent
          </button>

          {/* PARKED — "← Back to agent selection" button. Its destination is the
              agent-selection screen (renderLandingPage in App.js), which is itself
              currently parked. A button pointing at a parked destination dead-ends:
              clearing agentType re-traps the user, because the routing block
              re-derives it from the ?preboarding=1 param, which is still set. So the
              button is parked to match its destination rather than fixed.

              RE-ENABLE this together with renderLandingPage when the agent-selection
              screen is restored. NOT deleted — restore by uncommenting. The handler
              below is unchanged and still correct for the un-parked world; the
              dead-end is a property of the parked destination, not of this code.
          <button
            onClick={() => {
              trackEvent("returned_to_landing", {
                fromAgent: agentType,
                returnedAt: new Date().toISOString(),
              });
              setAgentType(null);
              setPreboardingPassword("");
              setPreboardingPasswordError(false);
            }}
            style={{
              background: "none", border: "none", fontSize: 13,
              color: C.textMuted, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            ← Back to agent selection
          </button>
          */}
        </div>
      </div>
    );
}
