import React, { useState } from "react";

// Minimal read-only reviewer view (Phase E4). Shows a case's status, band
// decisions, immutable identity events, and identity fields MASKED by default;
// each field has an audited "Reveal" that fetches the full value on demand. The
// full review-queue UI is a later phase. Presentational — the parent supplies the
// case data and an onReveal(concept) that performs the authorized server call.
const CONCEPT_LABELS = {
  first_name: "First name", last_name: "Last name", date_of_birth: "Date of birth",
  nationality: "Nationality", document_number: "Document number", document_type: "Document type",
  expiry_date: "Expiry date", issuing_country: "Issuing country", gender: "Gender",
  place_of_birth: "Place of birth", address: "Address",
};

export default function ReviewerCase({ caseData, onReveal }) {
  const [revealed, setRevealed] = useState({});
  if (!caseData || caseData.enabled === false) return null;
  if (caseData.error) return <p role="alert">Case unavailable: {caseData.error}</p>;

  const reveal = async (concept) => {
    if (!onReveal) return;
    const r = await onReveal(concept);
    setRevealed((prev) => ({ ...prev, [concept]: r && r.value != null ? r.value : "(unavailable)" }));
  };

  const masked = caseData.maskedFields || {};
  const decisions = caseData.decisions || [];
  const events = caseData.events || [];

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Verification case</h3>
      <p>Status: <strong>{caseData.status}</strong></p>

      <h4>Band decisions</h4>
      {decisions.length === 0 ? <p>None recorded.</p> : (
        <ul>{decisions.map((d, i) => <li key={i}>Band {d.band} - {d.outcome_type} ({d.resolved_by})</li>)}</ul>
      )}

      <h4>Identity fields</h4>
      <div>
        {Object.keys(masked).length === 0 ? <p>No vaulted identity for this case.</p> : Object.keys(masked).map((concept) => (
          <div key={concept} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
            <span style={{ width: 150, fontSize: 12, color: "#1a3a4a80" }}>{CONCEPT_LABELS[concept] || concept}</span>
            <strong style={{ flex: 1 }}>{concept in revealed ? revealed[concept] : masked[concept]}</strong>
            {!(concept in revealed) && (
              <button type="button" onClick={() => reveal(concept)} style={{ fontSize: 12, background: "transparent", border: "none", color: "#0B3D91", cursor: "pointer" }}>
                Reveal (audited)
              </button>
            )}
          </div>
        ))}
      </div>

      <h4>Identity events</h4>
      {events.length === 0 ? <p>None.</p> : (
        <ul>{events.map((e, i) => <li key={i}>{e.event_type}{e.attribute_concept ? ` - ${e.attribute_concept}` : ""} ({e.actor})</li>)}</ul>
      )}
    </div>
  );
}
