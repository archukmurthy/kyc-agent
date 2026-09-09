import React, { useState } from "react";

// Post-verification confirm/edit panel (Section B, O2-4). Shows the applicant
// their OWN verified fields (from resolve.verifiedFields) as confirmable rows —
// each shown as a value with a tick, editable if wrong — then a single
// "Confirm & continue". This is the applicant reviewing their own document data,
// never a pick-one between two versions.
const LABELS = {
  firstName: "First name", lastName: "Last name", dateOfBirth: "Date of birth",
  nationality: "Nationality", documentType: "Document type", documentNumber: "Document number",
  expiryDate: "Expiry date", issuingCountry: "Issuing country", gender: "Gender",
  placeOfBirth: "Place of birth", address: "Address",
};
const ORDER = ["firstName", "lastName", "dateOfBirth", "nationality", "documentType", "documentNumber", "expiryDate", "issuingCountry", "gender", "placeOfBirth", "address"];

export default function VerifiedFieldsConfirm({ fields, onConfirm, Btn }) {
  const [values, setValues] = useState({ ...(fields || {}) });
  const [editing, setEditing] = useState({});
  const Button = Btn || ((props) => <button {...props} />);
  const keys = ORDER.filter((k) => k in (fields || {}));

  const setValue = (k, v) => setValues((prev) => ({ ...prev, [k]: v }));

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Confirm your verified details</h3>
      <p style={{ fontSize: 13, color: "#1a3a4a" }}>These were read from your document. Edit anything that's wrong, then confirm.</p>
      <div>
        {keys.map((k) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #eee" }}>
            <span aria-hidden="true" style={{ color: "#137333" }}>✓</span>
            <label style={{ width: 140, fontSize: 12, color: "#1a3a4a80" }} htmlFor={`vf-${k}`}>{LABELS[k] || k}</label>
            {editing[k] ? (
              <input
                id={`vf-${k}`}
                value={values[k] || ""}
                onChange={(e) => setValue(k, e.target.value)}
                style={{ flex: 1, border: "1.5px solid rgba(26,58,74,0.14)", borderRadius: 6, padding: "6px 10px", fontSize: 14, fontFamily: "inherit" }}
              />
            ) : (
              <strong style={{ flex: 1 }}>{values[k]}</strong>
            )}
            <button type="button" onClick={() => setEditing((p) => ({ ...p, [k]: !p[k] }))} style={{ fontSize: 12, background: "transparent", border: "none", color: "#0B3D91", cursor: "pointer" }}>
              {editing[k] ? "Done" : "Edit"}
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        <Button type="button" onClick={() => onConfirm && onConfirm(values)}>Confirm &amp; continue →</Button>
      </div>
    </div>
  );
}
