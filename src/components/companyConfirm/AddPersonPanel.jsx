/**
 * AddPersonPanel.jsx — "add a person the research missed" (commit 7, CD-03).
 *
 * Adding is its own action, deliberately NOT folded into a name edit: editing a
 * person is always about that person, and the name three-way's "this isn't the
 * right person" branch removes them rather than swapping in someone new.
 *
 * THE TYPE QUESTION IS THE POINT. Everything downstream is keyed off person
 * type — which list document proves the addition, and whether the person needs
 * POI/POA at all — so we ask it outright. This is the one place person type is
 * STATED by the customer rather than inferred by the stub in personType.js.
 *
 * CONTROLLED + PRESENTATIONAL: collects the answers and hands them up. It
 * classifies nothing, writes no events, and knows no document rules.
 */

import React, { useState } from "react";
import { C } from "../../constants/theme";

const PANEL = {
  marginTop: 12,
  padding: "14px 16px",
  background: "#F8FAFC",
  border: "1px solid #E2E8F0",
  borderRadius: 10,
};
const H = { fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 8px" };
const LABEL = { display: "block", fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 4 };
const INPUT = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px",
  fontSize: 13, fontFamily: "inherit", color: C.text,
  background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6,
};
const FIELD = { marginBottom: 10 };
const TYPE_BTN = (active) => ({
  flex: "1 1 0", minWidth: 120, cursor: "pointer",
  padding: "10px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit",
  color: active ? "#fff" : C.text,
  background: active ? "#4a9e8e" : "#fff",
  border: active ? "1.5px solid #4a9e8e" : `1.5px solid ${C.border}`,
  borderRadius: 8,
});
const PRIMARY = {
  cursor: "pointer", padding: "9px 20px", fontSize: 13, fontWeight: 700,
  color: "#fff", background: "#4a9e8e", border: "none", borderRadius: 8, fontFamily: "inherit",
};
const LINK = {
  cursor: "pointer", padding: "9px 16px", fontSize: 13, fontWeight: 600,
  color: C.text, background: "#fff", border: `1px solid ${C.border}`,
  borderRadius: 8, fontFamily: "inherit",
};

const TYPES = [
  { value: "director", label: "A director", hint: "Appears on the register of directors" },
  { value: "ubo", label: "A beneficial owner", hint: "Holds a qualifying shareholding or control" },
  { value: "both", label: "Both", hint: "A director who is also a beneficial owner" },
];

export function AddPersonPanel({ onAdd, onCancel }) {
  const [type, setType] = useState(null);
  const [form, setForm] = useState({
    full_name: "", date_of_birth: "", nationality: "", residential_country: "", is_pep: null,
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const canSave = form.full_name.trim() !== "" && type !== null && form.is_pep !== null;

  return (
    <div style={PANEL} data-testid="add-person-panel">
      <p style={H}>Who are we adding?</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {TYPES.map((t) => (
          <button key={t.value} type="button" style={TYPE_BTN(type === t.value)} onClick={() => setType(t.value)}>
            {t.label}
            <span style={{ display: "block", fontSize: 10.5, fontWeight: 500, marginTop: 2, opacity: 0.8 }}>
              {t.hint}
            </span>
          </button>
        ))}
      </div>

      {type && (
        <>
          <div style={FIELD}>
            <label style={LABEL}>Full legal name *</label>
            <input style={INPUT} value={form.full_name} onChange={(e) => set("full_name", e.target.value)}
              placeholder="As it appears on their identity document" aria-label="Full legal name" />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ ...FIELD, flex: "1 1 140px" }}>
              <label style={LABEL}>Date of birth</label>
              <input type="date" style={INPUT} value={form.date_of_birth}
                onChange={(e) => set("date_of_birth", e.target.value)} aria-label="Date of birth" />
            </div>
            <div style={{ ...FIELD, flex: "1 1 140px" }}>
              <label style={LABEL}>Nationality</label>
              <input style={INPUT} value={form.nationality} onChange={(e) => set("nationality", e.target.value)}
                placeholder="e.g. British" aria-label="Nationality" />
            </div>
            <div style={{ ...FIELD, flex: "1 1 140px" }}>
              <label style={LABEL}>Country of residence</label>
              <input style={INPUT} value={form.residential_country}
                onChange={(e) => set("residential_country", e.target.value)}
                placeholder="e.g. United Kingdom" aria-label="Country of residence" />
            </div>
          </div>

          <div style={FIELD}>
            <label style={LABEL}>Is this person a politically exposed person (PEP)? *</label>
            <div style={{ display: "flex", gap: 8 }}>
              {[["No", false], ["Yes", true]].map(([lbl, val]) => (
                <button key={lbl} type="button"
                  style={{ ...TYPE_BTN(form.is_pep === val), minWidth: 80, flex: "0 0 auto" }}
                  onClick={() => set("is_pep", val)}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              type="button"
              disabled={!canSave}
              style={{ ...PRIMARY, opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }}
              onClick={() => canSave && onAdd({ type, ...form, full_name: form.full_name.trim() })}
            >
              Add person
            </button>
            {onCancel && <button type="button" style={LINK} onClick={onCancel}>Cancel</button>}
          </div>
        </>
      )}

      {!type && onCancel && (
        <button type="button" style={LINK} onClick={onCancel}>Cancel</button>
      )}
    </div>
  );
}

export default AddPersonPanel;
