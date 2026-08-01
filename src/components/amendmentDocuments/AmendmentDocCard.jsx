/**
 * AmendmentDocCard.jsx — the ONE upload card for an amendment document.
 *
 * Rendered in two places from a single implementation: inline on the Confirm
 * row where the correction happened, and in the Fill Gaps "Amendment
 * Documentation" panel. Both are fed the same `{ fieldId, docType }` entry and
 * both read/write the same App-level `amendmentUploads` store (keyed
 * `fieldId::docType`), so an upload started in either place is immediately
 * satisfied in the other — one document, one upload, one source of truth.
 *
 * CONTROLLED: it owns no upload state. The parent passes the current upload
 * record and receives the file; storing it (and lifting it into the dossier
 * payload, PR-071) stays the parent's job.
 *
 * The customer sees the document NAME only — the internal rule code carried on
 * `reason` (e.g. "Required by rule ADDR-NOTREFLECTED") is never shown.
 */

import React, { useRef } from "react";

const BTN = {
  fontSize: 12,
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #CBD5E1",
  background: "#fff",
  color: "#1a3a4a",
  cursor: "pointer",
  fontWeight: 600,
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};
const UPLOADED = { fontSize: 12, color: "#1a7a4a", fontWeight: 600 };
const WARN = { fontSize: 12, color: "#b45309", fontWeight: 600 };
const REMOVE = { fontSize: 12, color: "#b91c1c", cursor: "pointer", fontWeight: 600 };

export function AmendmentDocCard({
  doc,
  upload,
  onUpload,
  onRemove,
  busy = false,
  variant = "panel",
  hint = null,
}) {
  const inputRef = useRef(null);
  const inline = variant === "inline";
  // "summary-action" renders the control only — the summary panel already shows
  // the document name and status, so repeating them would just be noise.
  const actionOnly = variant === "summary-action";

  const handleChange = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // reset first so the same file can be re-selected
    if (file && typeof onUpload === "function") onUpload(file, doc);
  };

  return (
    <div
      data-testid="amendment-doc-card"
      style={
        actionOnly
          ? { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }
          : inline
          ? {
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              marginTop: 8, padding: "10px 12px",
              background: "#FEF9EF", border: "1px solid #FCD9A8", borderRadius: 8,
            }
          : {
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              padding: "10px 0", borderTop: "1px solid #FCD9A8",
            }
      }
    >
      {!actionOnly && (
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: inline ? 13 : 14, fontWeight: 700, color: "#1a3a4a" }}>
            {inline && <span style={{ marginRight: 6 }}>📄</span>}
            {doc.docType}
          </div>
          {hint && (
            <div style={{ fontSize: 11, color: "#7a4f00cc", marginTop: 2 }}>{hint}</div>
          )}
        </div>
      )}

      {busy ? (
        <span style={{ fontSize: 12, color: "#7a4f00", fontWeight: 600 }}>Uploading…</span>
      ) : upload ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {upload.uploadFailed ? (
            <span style={WARN}>⚠ {upload.name} — not stored, please re-upload</span>
          ) : (
            <span style={UPLOADED}>✓ {upload.name}</span>
          )}
          <span
            role="button"
            tabIndex={0}
            style={REMOVE}
            onClick={() => onRemove && onRemove(doc)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onRemove && onRemove(doc);
            }}
          >
            Remove
          </span>
        </div>
      ) : (
        <>
          <input
            type="file"
            ref={inputRef}
            accept=".pdf,.png,.jpg,.jpeg"
            style={{ display: "none" }}
            onChange={handleChange}
          />
          <button
            type="button"
            style={BTN}
            onClick={() => inputRef.current && inputRef.current.click()}
          >
            ↑ Upload document
          </button>
        </>
      )}
    </div>
  );
}

export default AmendmentDocCard;
