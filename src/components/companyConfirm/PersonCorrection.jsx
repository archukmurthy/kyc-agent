/**
 * PersonCorrection.jsx — the per-person correction flow on Confirm (CD-03).
 *
 * CONTROLLED + PRESENTATIONAL: it asks the questions and collects the value,
 * then hands the caller a resolved correction. It classifies nothing, writes no
 * events and knows no document rules — App.js runs those through the engine.
 *
 * THE NAME THREE-WAY (CD-03's answer to name ambiguity): editing a name never
 * opens a text box directly. We first ask WHICH situation this is, because the
 * three cases have completely different compliance meanings:
 *   typo         — we misread it; same person, no document.
 *   legal_change — same person, new legal name; POI shows the CURRENT name
 *                  (we never ask for a name-change certificate, and the former
 *                  name is not of interest) plus the list document.
 *   wrong_person — not this person at all; that is a REMOVAL, not an edit.
 *
 * The question deliberately offers ONLY these three "about this person"
 * branches. Adding a different person is a separate action (commit 7) — editing
 * a person is always about that person.
 */

import React, { useState } from "react";
import { C } from "../../constants/theme";
import { PERSON_ATTRIBUTE } from "./personType";

const PANEL = {
  marginTop: 8,
  padding: "10px 12px",
  background: "#F8FAFC",
  border: "1px solid #E2E8F0",
  borderRadius: 8,
  fontSize: 12.5,
  color: C.text,
  lineHeight: 1.5,
};
const PROMPT = { fontWeight: 700, marginBottom: 8, fontSize: 12.5 };
const OPTION = {
  display: "block", width: "100%", textAlign: "left",
  cursor: "pointer", padding: "8px 10px", marginBottom: 6,
  fontSize: 12.5, color: C.text, background: "#fff",
  border: "1px solid #CBD5E1", borderRadius: 6, fontFamily: "inherit",
};
const OPTION_SUB = { display: "block", fontSize: 11, color: C.textMuted, marginTop: 2, fontWeight: 400 };
const INPUT = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px",
  fontSize: 13, fontFamily: "inherit", color: C.text,
  background: "#fff", border: `1px solid ${C.infoBorder}`, borderRadius: 6,
};
const BTN = {
  cursor: "pointer", padding: "6px 16px", fontSize: 12.5, fontWeight: 700,
  color: "#fff", background: C.info, border: "none", borderRadius: 6, fontFamily: "inherit",
};
const LINK = {
  cursor: "pointer", padding: "6px 12px", fontSize: 12.5, fontWeight: 600,
  color: C.text, background: "#fff", border: `1px solid ${C.border}`,
  borderRadius: 6, fontFamily: "inherit",
};

const NAME_OPTIONS = [
  { value: "typo", label: "You spelled this person's name wrong", hint: "Same person — we just read it incorrectly." },
  { value: "legal_change", label: "This person's name has legally changed", hint: "Same person, new legal name (marriage, deed poll)." },
  { value: "wrong_person", label: "This isn't the right person — they've been replaced", hint: "We'll remove them from the list." },
];

export function PersonCorrection({
  attribute,
  personName,
  originalValue = "",
  inputType = "text",
  options = null,
  onResolve,
  onCancel,
}) {
  const isName = attribute === PERSON_ATTRIBUTE.NAME;
  const [nameCase, setNameCase] = useState(null);
  const [draft, setDraft] = useState(isName ? "" : String(originalValue ?? ""));

  // ── Name: ask which of the three situations this is, before any text box. ──
  if (isName && !nameCase) {
    return (
      <div style={PANEL} data-testid="person-name-question">
        <div style={PROMPT}>What's changed about {personName || "this person"}'s name?</div>
        {NAME_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            style={OPTION}
            onClick={() => {
              // "Wrong person" is a removal, not an edit — resolve immediately.
              if (o.value === "wrong_person") {
                onResolve({ attribute: PERSON_ATTRIBUTE.REMOVAL, nameCase: o.value, value: null, reason: "replaced_by_someone_else" });
                return;
              }
              setNameCase(o.value);
            }}
          >
            <strong>{o.label}</strong>
            <span style={OPTION_SUB}>{o.hint}</span>
          </button>
        ))}
        {onCancel && (
          <button type="button" style={{ ...LINK, marginTop: 2 }} onClick={onCancel}>Cancel</button>
        )}
      </div>
    );
  }

  const canSave = String(draft).trim() !== "";
  const isSelect = inputType === "select" && Array.isArray(options) && options.length > 0;

  return (
    <div style={PANEL} data-testid="person-correction-editor">
      <div style={PROMPT}>
        {isName && nameCase === "legal_change"
          ? "What is their current legal name?"
          : "Enter the correct value"}
      </div>
      {isSelect ? (
        <select value={draft} onChange={(e) => setDraft(e.target.value)} style={INPUT} aria-label="Corrected value">
          <option value="">Select...</option>
          {options.map((o) => {
            const v = o && typeof o === "object" ? (o.value ?? o.label) : o;
            const l = o && typeof o === "object" ? (o.label ?? o.value) : o;
            return <option key={String(v)} value={v}>{l}</option>;
          })}
        </select>
      ) : (
        <input
          type={inputType === "date" ? "date" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Enter the correct value"
          style={INPUT}
          aria-label="Corrected value"
        />
      )}
      {originalValue !== "" && originalValue != null && (
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>Original: {String(originalValue)}</div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          disabled={!canSave}
          style={{ ...BTN, opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }}
          onClick={() => canSave && onResolve({ attribute, nameCase, value: String(draft).trim() })}
        >
          Save
        </button>
        {onCancel && <button type="button" style={LINK} onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

const REMOVAL_REASONS = [
  { value: "no_longer_director", label: "No longer a director" },
  { value: "no_longer_owner", label: "No longer holds a qualifying shareholding" },
  { value: "never_involved", label: "Never held this role — you have the wrong person" },
];

/**
 * Removal confirm-why. The list document that follows IS the analyst trigger —
 * requesting it means an analyst reviews the removal, so there is no separate
 * analyst flag to raise here.
 */
export function PersonRemovalPrompt({ personName, onConfirm, onCancel }) {
  return (
    <div style={PANEL} data-testid="person-removal-prompt">
      <div style={PROMPT}>Why should {personName || "this person"} be removed?</div>
      {REMOVAL_REASONS.map((r) => (
        <button key={r.value} type="button" style={OPTION} onClick={() => onConfirm(r.value)}>
          {r.label}
        </button>
      ))}
      {onCancel && <button type="button" style={{ ...LINK, marginTop: 2 }} onClick={onCancel}>Cancel</button>}
    </div>
  );
}

export default PersonCorrection;
