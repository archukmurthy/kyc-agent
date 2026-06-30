/**
 * FoundationalFactsGate.jsx — slice 2 of 2. The five foundational facts used to
 * research the company, shown at the TOP of the Applicant page (NOT a new step),
 * each with a confirm checkbox (checked by default). The applicant section below
 * is revealed by the parent only once all five are confirmed.
 *
 * STRICT boundary (mirrors the old CompanyConfirmGate): this component is
 * PRESENTATIONAL and CONTROLLED. It owns no state machine — App.js holds the
 * check state, computes "all confirmed", and supplies the outcome handlers. The
 * gate only renders the facts + dispute panels and CALLS BACK. It imports
 * nothing from the journey/engine and triggers no I/O.
 *
 * Dispute outcomes (decided by the parent's handlers):
 *   - name / reg number / country / entity type disputed → onReset() (full clean
 *     reset to the fresh lookup page; nothing pre-filled).
 *   - ownership type disputed → fork:
 *       "misclassified"      → onReset()            (same as the four above)
 *       "genuinely changed"  → onOwnershipChanged() (document-request path; the
 *         specific document is a PENDING mapping owned by ops — this gate only
 *         records the declared change and surfaces a "document required — to be
 *         specified" placeholder. It NEVER guesses a document and does NOT let
 *         the customer continue to the applicant section.)
 *
 * The registration number is display-only/pre-confirmed when the customer
 * provided it themselves (they already asserted it on the lookup page); it is
 * only a checkbox-verifiable fact when research retrieved it (provenance prop).
 */

import React from "react";

const CARD = {
  background: "#F8FAFC",
  border: "1px solid #E2E8F0",
  borderRadius: 10,
  padding: "16px 18px",
  marginBottom: 20,
};
const TITLE = { fontSize: 15, fontWeight: 700, color: "#1a3a4a", margin: "0 0 4px" };
const SUMMARY = { fontSize: 13, color: "#1a3a4a99", margin: "0 0 14px", lineHeight: 1.5 };
const ROW = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 0",
  borderTop: "1px solid #E8EDF2",
  flexWrap: "wrap",
};
const FACT_LABEL = { fontSize: 12, color: "#1a3a4a80", width: 200, flexShrink: 0 };
const FACT_VALUE = { fontSize: 13, fontWeight: 600, color: "#1a3a4a", flex: 1, minWidth: 0 };
const NOTE = { fontSize: 11, color: "#1a3a4a70", fontStyle: "italic" };
const DISPUTED_TAG = {
  fontSize: 10, fontWeight: 700, color: "#b91c1c",
  background: "#fef2f2", border: "1px solid #fecaca",
  borderRadius: 99, padding: "2px 8px", whiteSpace: "nowrap",
};
const PANEL = (tone) => ({
  marginTop: 14,
  padding: "14px 16px",
  borderRadius: 8,
  background: tone === "warn" ? "#FEF9EF" : "#fef2f2",
  border: `1px solid ${tone === "warn" ? "#FCD9A8" : "#fecaca"}`,
});
const PANEL_TITLE = (tone) => ({
  fontSize: 13, fontWeight: 700, margin: "0 0 4px",
  color: tone === "warn" ? "#7a4f00" : "#b91c1c",
});
const PANEL_BODY = (tone) => ({
  fontSize: 12.5, lineHeight: 1.5, margin: "0 0 12px",
  color: tone === "warn" ? "#7a4f00cc" : "#7f1d1dcc",
});
const ROW_BTNS = { display: "flex", gap: 8, flexWrap: "wrap" };
const BTN = {
  cursor: "pointer", padding: "8px 14px", fontSize: 13, fontWeight: 600,
  color: "#1a3a4a", background: "#fff", border: "1px solid #CBD5E1",
  borderRadius: 6, fontFamily: "inherit",
};
const BTN_DANGER = { ...BTN, background: "#b91c1c", color: "#fff", border: "1px solid #b91c1c" };
const BTN_WARN = { ...BTN, background: "#7a4f00", color: "#fff", border: "1px solid #7a4f00" };

export function FoundationalFactsGate({
  facts = [],
  isConfirmed,
  onToggle,
  ownershipFork = null,
  ownershipChangeFrom = "",
  onReset,
  onOwnershipChanged,
  onCancel,
}) {
  // Any of the four reset-facts disputed → full reset (ownership has its own fork).
  const fourDisputed = facts.some(
    (f) => f.key !== "ownershipType" && f.disputable && !isConfirmed(f.key)
  );
  const ownershipDisputed = !isConfirmed("ownershipType");

  return (
    <div style={CARD} data-testid="foundational-facts-gate">
      <h3 style={TITLE}>Before you continue — confirm the company we researched</h3>
      <p style={SUMMARY}>
        These are the five facts we used to research your company. Leave a box ticked to confirm it,
        or untick anything that's wrong. We'll only show the rest of this page once all five are confirmed.
      </p>

      {facts.map((f) => {
        const confirmed = isConfirmed(f.key);
        const showDisputed = f.disputable && !confirmed;
        return (
          <label
            key={f.key}
            style={{
              ...ROW,
              cursor: f.disputable ? "pointer" : "default",
            }}
            data-testid={`fact-${f.key}`}
          >
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!f.disputable}
              onChange={() => f.disputable && onToggle(f.key)}
              style={{
                width: 15, height: 15, flexShrink: 0,
                accentColor: "#4a9e8e",
                cursor: f.disputable ? "pointer" : "not-allowed",
              }}
              aria-label={`Confirm ${f.label}`}
            />
            <span style={FACT_LABEL}>{f.label}</span>
            <span style={FACT_VALUE}>{f.value}</span>
            {f.note && !showDisputed && <span style={NOTE}>{f.note}</span>}
            {showDisputed && <span style={DISPUTED_TAG}>marked incorrect</span>}
          </label>
        );
      })}

      {/* Outcome panels. A disputed reset-fact takes precedence (its outcome is a
          full reset regardless of ownership). Otherwise the ownership fork. */}
      {fourDisputed ? (
        <div style={PANEL("danger")} data-testid="facts-reset-panel">
          <p style={PANEL_TITLE("danger")}>This restarts your application</p>
          <p style={PANEL_BODY("danger")}>
            You've marked one of the core company facts as wrong, so the research was based on the wrong
            premise. We'll take you back to a fresh company lookup to start over — nothing will be pre-filled.
          </p>
          <div style={ROW_BTNS}>
            <button type="button" style={BTN_DANGER} onClick={onReset} data-testid="facts-reset-confirm">
              Start a fresh lookup
            </button>
            <button type="button" style={BTN} onClick={onCancel} data-testid="facts-reset-cancel">
              Cancel — keep my answers
            </button>
          </div>
        </div>
      ) : ownershipDisputed ? (
        ownershipFork === "changed" ? (
          <div style={PANEL("warn")} data-testid="ownership-changed-panel">
            <p style={PANEL_TITLE("warn")}>Document required — to be specified</p>
            <p style={PANEL_BODY("warn")}>
              We've recorded that your ownership type genuinely changed
              {ownershipChangeFrom ? ` from "${ownershipChangeFrom}"` : ""}. A specific supporting document
              will be requested to evidence this change. The exact document for this change is still being
              confirmed by our team, so it isn't listed here yet — you can't continue past this gate until
              that document requirement is in place.
            </p>
            <div style={ROW_BTNS}>
              <button type="button" style={BTN} onClick={onCancel} data-testid="ownership-changed-cancel">
                Cancel — keep my answers
              </button>
            </div>
          </div>
        ) : (
          <div style={PANEL("warn")} data-testid="ownership-fork-panel">
            <p style={PANEL_TITLE("warn")}>What changed about the ownership type?</p>
            <p style={PANEL_BODY("warn")}>
              Did we get the ownership type wrong, or did your company's ownership type genuinely change
              (for example a re-filing from private to public, or a conversion to a partnership/LLP)?
            </p>
            <div style={ROW_BTNS}>
              <button type="button" style={BTN_DANGER} onClick={onReset} data-testid="ownership-misclassified">
                You got it wrong — start over
              </button>
              <button type="button" style={BTN_WARN} onClick={onOwnershipChanged} data-testid="ownership-genuinely-changed">
                It genuinely changed
              </button>
              <button type="button" style={BTN} onClick={onCancel} data-testid="ownership-fork-cancel">
                Cancel
              </button>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

export default FoundationalFactsGate;
