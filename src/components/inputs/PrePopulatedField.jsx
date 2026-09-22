import { useState } from "react";
import { C } from "../../constants/theme";
import { StableInput } from "./StableInput";

// A field that was pre-populated from the AI research (e.g. nationality / date
// of birth a director's registry record carried). Shown as a locked value with
// a source badge — but, unlike the fully-locked name, the customer can click
// "Edit" to override it. When the value is empty it falls straight through to
// the editable input so nothing is pre-filled. Module-scoped so its `editing`
// state survives parent re-renders (same reason StableInput lives out here).
export function PrePopulatedField({ id, label, value, displayValue, type, onUpdate, sourceLabel, required, placeholder, options, startEditing }) {
  const [editing, setEditing] = useState(!!startEditing);
  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 5 };

  if (editing || !value) {
    return (
      <div style={{ marginBottom: 14 }}>
        <StableInput
          id={id}
          label={label}
          type={type || "text"}
          value={value || ""}
          onUpdate={onUpdate}
          required={required}
          placeholder={placeholder}
          options={options}
        />
        {value && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            style={{ fontSize: 11, color: C.textMuted, background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontFamily: "inherit" }}
          >
            Cancel edit
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label} {required && <span style={{ color: "#d44" }}>*</span>}</label>
      <div style={{
        padding: "10px 14px", background: C.infoBg, borderRadius: 8,
        border: `1px solid ${C.infoBorder}`, fontSize: 14, color: C.text,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      }}>
        <span>{displayValue || value}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.info, fontWeight: 600 }}>~ {sourceLabel || "Found"}</span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{ fontSize: 11, color: C.brandBlue, background: "none", border: `1px solid ${C.brandBlue}`, borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit" }}
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}
