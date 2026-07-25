/**
 * InlineCorrectionEditor.jsx — Option B commit 3: the inline value-capture
 * input that opens beneath a crossed (disputed) Confirm row once its
 * ChangeDialogue has classified the change.
 *
 * CONTROLLED + PRESENTATIONAL: it owns only the transient draft (local state,
 * so typing never re-renders the Confirm table — same rationale as
 * StableInput). The saved value lives in App.js's gapRef under
 * `corrected_<field>` — the exact key Fill Gaps renders — committed via
 * onSave; this component never touches refs and never emits events itself.
 * Save-button semantics (not write-on-keystroke) are what make "one logical
 * edit = one superseding change-event" hold upstream.
 *
 * Field fidelity: inputType/options come from the schema field def
 * (findFieldDef), so a dropdown field edits as a dropdown — mirroring how
 * Fill Gaps renders `corrected_<field>` today.
 */

import React, { useState } from "react";
import { C } from "../../constants/theme";

const normaliseOption = (o) =>
  o && typeof o === "object"
    ? { value: o.value ?? o.label, label: o.label ?? o.value }
    : { value: o, label: o };

export function InlineCorrectionEditor({
  fieldDef = {},
  originalDisplay = "",
  initialValue = "",
  onSave,
  onCancel = null,
}) {
  const isSelect =
    fieldDef.inputType === "select" &&
    Array.isArray(fieldDef.options) &&
    fieldDef.options.length > 0;
  const options = isSelect ? fieldDef.options.map(normaliseOption) : [];
  // A select's draft must be a real option value or "" — a free-text prefill
  // that matches no option would leave the dropdown stuck on nothing.
  const validInitial = (v) =>
    isSelect ? (options.some((o) => String(o.value) === String(v)) ? v : "") : v;

  const [draft, setDraft] = useState(String(validInitial(initialValue) ?? ""));

  const inputStyle = {
    width: "100%", boxSizing: "border-box", padding: "8px 10px",
    fontSize: 13, fontFamily: "inherit", color: C.text,
    background: "#fff", border: `1px solid ${C.infoBorder}`, borderRadius: 6,
  };

  const canSave = Boolean(String(draft).trim());
  return (
    <div
      data-testid="inline-correction-editor"
      style={{ marginTop: 8, padding: "10px 12px", background: "#fff", border: `1px solid ${C.infoBorder}`, borderRadius: 8 }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: C.info, marginBottom: 6 }}>Enter the correct value</div>
      {isSelect ? (
        <select
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={inputStyle}
          aria-label="Corrected value"
        >
          <option value="">Select...</option>
          {options.map((o) => (
            <option key={String(o.value)} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <input
          type={fieldDef.inputType === "date" ? "date" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Enter the correct value"
          style={inputStyle}
          aria-label="Corrected value"
        />
      )}
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6, overflowWrap: "break-word" }}>
        Original: {originalDisplay}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => { if (canSave) onSave(String(draft).trim()); }}
          style={{
            cursor: canSave ? "pointer" : "not-allowed", opacity: canSave ? 1 : 0.5,
            padding: "6px 16px", fontSize: 12.5, fontWeight: 700, color: "#fff",
            background: C.info, border: "none", borderRadius: 6, fontFamily: "inherit",
          }}
        >
          Save
        </button>
        {typeof onCancel === "function" && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              cursor: "pointer", padding: "6px 14px", fontSize: 12.5, fontWeight: 600,
              color: C.text, background: "#fff", border: `1px solid ${C.border}`,
              borderRadius: 6, fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export default InlineCorrectionEditor;
