/**
 * FoundationalFactsGate.jsx — the five foundational facts used to research the
 * company, shown at the TOP of the Applicant page (NOT a new step), each with a
 * confirm checkbox (checked by default). The applicant section below is
 * revealed by the parent only once all five are confirmed.
 *
 * PRESENTATIONAL and CONTROLLED for everything the parent owns (check state,
 * the ownership / registration-number "genuinely changed" forks, the outcome
 * of a correction). The only local state is the text the customer is typing
 * into a correction input before they press "Update my details".
 *
 * Outcomes:
 *   - company name / country / entity type unticked → an inline input
 *     pre-filled with the current value appears under the fact.
 *   - ownership type / registration number unticked → a fork:
 *       "You got it wrong - correct it" → the same inline correction input
 *       "It genuinely changed"          → the existing document-request path
 *   - "Update my details" → onApplyCorrections({ <changed keys only> }). The
 *     parent decides re-derive vs re-search (src/reresearch/correctionPlan.js).
 *     Nothing here resets the application.
 *
 * The registration number is display-only/pre-confirmed when the customer
 * provided it themselves; it is only checkbox-verifiable when research
 * retrieved it (provenance decided by the parent via `disputable`).
 */

import React, { useEffect, useState } from "react";

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
  background: tone === "warn" ? "#FEF9EF" : "#EEF6F4",
  border: `1px solid ${tone === "warn" ? "#FCD9A8" : "#BFE0D8"}`,
});
const PANEL_TITLE = (tone) => ({
  fontSize: 13, fontWeight: 700, margin: "0 0 4px",
  color: tone === "warn" ? "#7a4f00" : "#1a3a4a",
});
const PANEL_BODY = (tone) => ({
  fontSize: 12.5, lineHeight: 1.5, margin: "0 0 12px",
  color: tone === "warn" ? "#7a4f00cc" : "#1a3a4acc",
});
const ROW_BTNS = { display: "flex", gap: 8, flexWrap: "wrap" };
const BTN = {
  cursor: "pointer", padding: "8px 14px", fontSize: 13, fontWeight: 600,
  color: "#1a3a4a", background: "#fff", border: "1px solid #CBD5E1",
  borderRadius: 6, fontFamily: "inherit",
};
const BTN_PRIMARY = { ...BTN, background: "#4a9e8e", color: "#fff", border: "1px solid #4a9e8e" };
const BTN_WARN = { ...BTN, background: "#7a4f00", color: "#fff", border: "1px solid #7a4f00" };
const DISABLED = { opacity: 0.5, cursor: "not-allowed" };
const FIELD = {
  width: "100%", padding: "9px 12px", margin: "6px 0 4px",
  border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13,
  fontFamily: "inherit", background: "#fff", color: "#1a3a4a", boxSizing: "border-box",
};
const ERROR = { fontSize: 12.5, color: "#b91c1c", margin: "0 0 10px" };

// Gate fact key → correction key sent to the parent.
const CORRECTION_KEY = {
  companyName: "companyName",
  registrationNumber: "registrationNumber",
  country: "countryCode",
  entityType: "entityType",
  ownershipType: "ownershipType",
};
const DIRECT_KEYS = ["companyName", "country", "entityType"];

export function FoundationalFactsGate({
  facts = [],
  isConfirmed,
  onToggle,
  ownershipFork = null,
  ownershipChangeFrom = "",
  onOwnershipChanged,
  onCancel,
  ownershipTypeOptions = [],
  onOwnershipChangeResolved,
  regNumberFork = null,
  regNumberChangeFrom = "",
  onRegNumberChanged,
  onRegNumberChangeResolved,
  countryOptions = [],
  entityTypeOptions = [],
  onApplyCorrections,
  correctionBusy = false,
  correctionError = "",
}) {
  const ownershipDisputed = !isConfirmed("ownershipType");
  const regNumberDisputed = !isConfirmed("registrationNumber");

  // Typed-but-not-yet-submitted correction values, keyed by fact key.
  const [drafts, setDrafts] = useState({});
  // "You got it wrong" chosen on the ownership / registration-number forks.
  const [correctingOwnership, setCorrectingOwnership] = useState(false);
  const [correctingRegNumber, setCorrectingRegNumber] = useState(false);
  // Transient values for the "genuinely changed" controls (unchanged flow).
  const [newOwnershipType, setNewOwnershipType] = useState("");
  const [newRegNumber, setNewRegNumber] = useState("");

  // A fact that is re-confirmed (by re-ticking, or by the parent after a
  // correction / cancel) drops its local correction state.
  useEffect(() => { if (!ownershipDisputed) setCorrectingOwnership(false); }, [ownershipDisputed]);
  useEffect(() => { if (!regNumberDisputed) setCorrectingRegNumber(false); }, [regNumberDisputed]);

  const isCorrecting = (fact) => {
    if (!fact.disputable || isConfirmed(fact.key)) return false;
    if (DIRECT_KEYS.includes(fact.key)) return true;
    if (fact.key === "ownershipType") return correctingOwnership;
    if (fact.key === "registrationNumber") return correctingRegNumber;
    return false;
  };
  const draftFor = (fact) =>
    Object.prototype.hasOwnProperty.call(drafts, fact.key) ? drafts[fact.key] : (fact.editValue ?? "");
  const setDraft = (key, value) => setDrafts((prev) => ({ ...prev, [key]: value }));

  const correcting = facts.filter(isCorrecting);
  const allFilled = correcting.every((f) => String(draftFor(f)).trim() !== "");
  const changedFacts = correcting.filter((f) => String(draftFor(f)).trim() !== String(f.editValue ?? "").trim());
  const canApply = correcting.length > 0 && allFilled && changedFacts.length > 0 && !correctionBusy;

  const handleToggle = (key) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    onToggle(key);
  };
  const handleCancel = () => {
    setDrafts({});
    setCorrectingOwnership(false);
    setCorrectingRegNumber(false);
    onCancel();
  };
  const handleApply = () => {
    if (!canApply) return;
    const corrections = {};
    changedFacts.forEach((f) => { corrections[CORRECTION_KEY[f.key]] = String(draftFor(f)).trim(); });
    onApplyCorrections(corrections);
  };

  const renderCorrectionInput = (fact) => {
    const common = {
      value: draftFor(fact),
      onChange: (e) => setDraft(fact.key, e.target.value),
      "data-testid": `correct-${fact.key}`,
      "aria-label": `Correct ${fact.label}`,
      style: FIELD,
      disabled: correctionBusy,
    };
    const options =
      fact.key === "country" ? countryOptions
        : fact.key === "entityType" ? entityTypeOptions
        : fact.key === "ownershipType" ? ownershipTypeOptions
        : null;
    if (options) {
      return (
        <select {...common}>
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        {...common}
        type="text"
        placeholder={fact.key === "companyName" ? "Registered company name" : "Registration / company number"}
      />
    );
  };

  return (
    <div style={CARD} data-testid="foundational-facts-gate">
      <h3 style={TITLE}>Before you continue - confirm the company we researched</h3>
      <p style={SUMMARY}>
        These are the five facts we used to research your company. Leave a box ticked to confirm it,
        or untick anything that's wrong and tell us the right value. We'll only show the rest of this
        page once all five are confirmed.
      </p>

      {facts.map((f) => {
        const confirmed = isConfirmed(f.key);
        const showDisputed = f.disputable && !confirmed;
        return (
          <React.Fragment key={f.key}>
            <label
              style={{ ...ROW, cursor: f.disputable ? "pointer" : "default" }}
              data-testid={`fact-${f.key}`}
            >
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!f.disputable || correctionBusy}
                onChange={() => f.disputable && handleToggle(f.key)}
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
            {isCorrecting(f) && renderCorrectionInput(f)}
          </React.Fragment>
        );
      })}

      {correcting.length > 0 && (
        <div style={PANEL("info")} data-testid="facts-corrections-panel">
          <p style={PANEL_TITLE("info")}>Update your company details</p>
          <p style={PANEL_BODY("info")}>
            We'll use your corrections to update what we found. You won't lose anything you've already
            entered on this page.
          </p>
          {correctionError && (
            <p style={ERROR} data-testid="facts-corrections-error" role="alert">{correctionError}</p>
          )}
          <div style={ROW_BTNS}>
            <button
              type="button"
              style={canApply ? BTN_PRIMARY : { ...BTN_PRIMARY, ...DISABLED }}
              disabled={!canApply}
              onClick={handleApply}
              data-testid="facts-apply-corrections"
            >
              {correctionBusy ? "Updating your details…" : "Update my details"}
            </button>
            <button
              type="button"
              style={correctionBusy ? { ...BTN, ...DISABLED } : BTN}
              disabled={correctionBusy}
              onClick={handleCancel}
              data-testid="facts-corrections-cancel"
            >
              Cancel - keep my answers
            </button>
          </div>
        </div>
      )}

      {ownershipDisputed && !correctingOwnership && (
        ownershipFork === "changed" ? (
          <div style={PANEL("warn")} data-testid="ownership-changed-panel">
            <p style={PANEL_TITLE("warn")}>What did the ownership type change to?</p>
            <p style={PANEL_BODY("warn")}>
              We've recorded that your ownership type genuinely changed
              {ownershipChangeFrom ? ` from "${ownershipChangeFrom}"` : ""}. Tell us what it changed
              TO - we'll add the supporting documents to your checklist, then you can continue.
            </p>
            <select
              value={newOwnershipType}
              onChange={(e) => setNewOwnershipType(e.target.value)}
              data-testid="ownership-new-type"
              style={{ ...FIELD, border: "1px solid #FCD9A8", margin: "0 0 12px" }}
            >
              <option value="">Select the new ownership type…</option>
              {ownershipTypeOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div style={ROW_BTNS}>
              <button
                type="button"
                style={newOwnershipType ? BTN_WARN : { ...BTN_WARN, ...DISABLED }}
                disabled={!newOwnershipType}
                onClick={() => newOwnershipType && onOwnershipChangeResolved(newOwnershipType)}
                data-testid="ownership-changed-confirm"
              >
                Confirm change
              </button>
              <button type="button" style={BTN} onClick={handleCancel} data-testid="ownership-changed-cancel">
                Cancel - keep my answers
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
              <button type="button" style={BTN_PRIMARY} onClick={() => setCorrectingOwnership(true)} data-testid="ownership-misclassified">
                You got it wrong - correct it
              </button>
              <button type="button" style={BTN_WARN} onClick={onOwnershipChanged} data-testid="ownership-genuinely-changed">
                It genuinely changed
              </button>
              <button type="button" style={BTN} onClick={handleCancel} data-testid="ownership-fork-cancel">
                Cancel
              </button>
            </div>
          </div>
        )
      )}

      {regNumberDisputed && !correctingRegNumber && (
        regNumberFork === "changed" ? (
          <div style={PANEL("warn")} data-testid="regnumber-changed-panel">
            <p style={PANEL_TITLE("warn")}>What's the new registration / company number?</p>
            <p style={PANEL_BODY("warn")}>
              We've recorded that your registration / company number genuinely changed
              {regNumberChangeFrom ? ` from "${regNumberChangeFrom}"` : ""}. Enter the new number - we'll
              add the supporting document to your checklist, then you can continue.
            </p>
            <input
              type="text"
              value={newRegNumber}
              onChange={(e) => setNewRegNumber(e.target.value)}
              data-testid="regnumber-new-value"
              placeholder="New registration / company number"
              style={{ ...FIELD, border: "1px solid #FCD9A8", margin: "0 0 12px" }}
            />
            <div style={ROW_BTNS}>
              <button
                type="button"
                style={newRegNumber.trim() ? BTN_WARN : { ...BTN_WARN, ...DISABLED }}
                disabled={!newRegNumber.trim()}
                onClick={() => newRegNumber.trim() && onRegNumberChangeResolved(newRegNumber)}
                data-testid="regnumber-changed-confirm"
              >
                Confirm change
              </button>
              <button type="button" style={BTN} onClick={handleCancel} data-testid="regnumber-changed-cancel">
                Cancel - keep my answers
              </button>
            </div>
          </div>
        ) : (
          <div style={PANEL("warn")} data-testid="regnumber-fork-panel">
            <p style={PANEL_TITLE("warn")}>What changed about the registration number?</p>
            <p style={PANEL_BODY("warn")}>
              Did we get the registration / company number wrong, or did it genuinely change (for example a
              re-registration or conversion that issued a new number)?
            </p>
            <div style={ROW_BTNS}>
              <button type="button" style={BTN_PRIMARY} onClick={() => setCorrectingRegNumber(true)} data-testid="regnumber-misclassified">
                You got it wrong - correct it
              </button>
              <button type="button" style={BTN_WARN} onClick={onRegNumberChanged} data-testid="regnumber-genuinely-changed">
                It genuinely changed
              </button>
              <button type="button" style={BTN} onClick={handleCancel} data-testid="regnumber-fork-cancel">
                Cancel
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

export default FoundationalFactsGate;
