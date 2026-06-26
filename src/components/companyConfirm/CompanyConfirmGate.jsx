/**
 * CompanyConfirmGate.jsx — the front-door "did we research the right company?"
 * check, shown at the start of the customer journey before Confirm/Fill Gaps.
 *
 * Job: capture ONE signal and hand it back. It asks whether the researched
 * entity is right; if not, the single distinguishing question
 *   "a different company, or the same company with details we got wrong?"
 * splits the two cases that cost very differently:
 *   different_company → identity-invalidating → full re-research (discard)
 *   wrong_details     → interpretation        → re-derive only (keep research)
 *
 * STRICT boundary (keep it this way): this component only READS the classifiers
 * passed in and CALLS BACK. It runs no state machine, writes no events, triggers
 * no search, imports nothing from the journey/engine. App.js owns the wiring:
 * onConfirm() → proceed; onDispute(answer) → run the reseed. The customer never
 * sees the words "dossier", "re-research", or "state".
 *
 * It renders nothing once a choice is made (the parent advances the flow).
 */

import React, { useState } from "react";

const CARD = {
  background: "#F8FAFC",
  border: "1px solid #E2E8F0",
  borderRadius: 10,
  padding: "16px 18px",
  marginBottom: 16,
};
const TITLE = { fontSize: 15, fontWeight: 700, color: "#1a3a4a", margin: "0 0 4px" };
const SUMMARY = { fontSize: 13, color: "#1a3a4a99", margin: "0 0 12px", lineHeight: 1.5 };
const PROMPT = { fontSize: 13, fontWeight: 600, color: "#1a3a4a", margin: "4px 0 8px" };
const ROW = { display: "flex", gap: 8, flexWrap: "wrap" };
const BTN = {
  cursor: "pointer",
  padding: "7px 14px",
  fontSize: 13,
  fontWeight: 600,
  color: "#1a3a4a",
  background: "#fff",
  border: "1px solid #CBD5E1",
  borderRadius: 6,
  fontFamily: "inherit",
};
const BTN_PRIMARY = { ...BTN, background: "#1a3a4a", color: "#fff", border: "1px solid #1a3a4a" };

export function CompanyConfirmGate({
  company = "",
  entityTypeLabel = "",
  countryLabel = "",
  onConfirm,
  onDispute,
}) {
  const [showDispute, setShowDispute] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return null; // parent advances the flow once a choice is made

  const summaryBits = [entityTypeLabel, countryLabel].filter(Boolean).join(" · ");

  function confirm() {
    setDone(true);
    if (typeof onConfirm === "function") onConfirm();
  }
  function dispute(answer) {
    setDone(true);
    if (typeof onDispute === "function") onDispute(answer);
  }

  return (
    <div style={CARD} data-testid="company-confirm-gate">
      <h3 style={TITLE}>Before you continue — is this the right company?</h3>
      <p style={SUMMARY}>
        We researched <strong>{company || "this company"}</strong>
        {summaryBits ? ` (${summaryBits})` : ""}. Please confirm this is the entity you're
        onboarding so the details on the next pages are about the right company.
      </p>

      {!showDispute ? (
        <div style={ROW}>
          <button type="button" style={BTN_PRIMARY} onClick={confirm} data-testid="confirm-company-yes">
            Yes, that's correct
          </button>
          <button
            type="button"
            style={BTN}
            onClick={() => setShowDispute(true)}
            data-testid="confirm-company-no"
          >
            No, something's wrong
          </button>
        </div>
      ) : (
        <>
          <p style={PROMPT}>Is this a different company, or the same company with details we got wrong?</p>
          <div style={ROW}>
            <button
              type="button"
              style={BTN}
              onClick={() => dispute("different_company")}
              data-testid="dispute-different-company"
            >
              A different company
            </button>
            <button
              type="button"
              style={BTN}
              onClick={() => dispute("wrong_details")}
              data-testid="dispute-wrong-details"
            >
              Same company, wrong details
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default CompanyConfirmGate;
