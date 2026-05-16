import React, { useState } from "react";
import { adminColors, adminStyles } from "../adminDesign";

const ALL_TYPES = ["pdf", "doc", "docx", "xls", "xlsx", "image", "any"];

// One document card in the Step 5 grid. Checkbox toggles whether this doc is
// included for the active entity type; clicking the body expands an inline
// edit form for the doc itself (which lives in the global documentLibrary).
export default function DocumentCard({
  doc,
  checked,
  onToggleChecked,
  onPatchDoc,
  onRemoveFromLibrary,
}) {
  const [open, setOpen] = useState(false);

  function update(p) {
    onPatchDoc(p);
  }

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${checked ? adminColors.niumBlue : adminColors.border}`,
        borderLeft: checked ? `3px solid ${adminColors.niumBlue}` : `1px solid ${adminColors.border}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", gap: 12, padding: 14 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggleChecked(e.target.checked)}
          style={{ marginTop: 4, width: 16, height: 16, flexShrink: 0 }}
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "inherit",
            textAlign: "left",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>{doc.icon || "📄"}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: adminColors.text }}>{doc.name}</span>
          </div>
          {doc.helperText && (
            <div style={{ fontSize: 12, color: adminColors.textMuted, marginTop: 6, lineHeight: 1.45 }}>
              {doc.helperText}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 10, fontSize: 11, color: adminColors.textMuted, flexWrap: "wrap" }}>
            <span>📎 {acceptLabel(doc.acceptedTypes)}</span>
            <span>🤖 AI Extraction: {doc.aiExtraction === false ? "Off" : "On"}</span>
            <span>{doc.required ? "● Required" : "○ Optional"}</span>
            {doc.isWolfsberg && <span style={{ color: adminColors.niumBlue }}>★ Wolfsberg</span>}
          </div>
        </button>
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${adminColors.border}`, padding: 14, background: adminColors.wizardBg }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Document name">
              <input
                type="text"
                value={doc.name || ""}
                onChange={(e) => update({ name: e.target.value })}
                style={adminStyles.input}
              />
            </Field>
            <Field label="Icon">
              <input
                type="text"
                value={doc.icon || ""}
                maxLength={4}
                onChange={(e) => update({ icon: e.target.value })}
                style={adminStyles.input}
              />
            </Field>
            <Field label="Helper text" full>
              <textarea
                value={doc.helperText || ""}
                onChange={(e) => update({ helperText: e.target.value })}
                style={{ ...adminStyles.input, minHeight: 60 }}
              />
            </Field>
            <Field label="Accepted types" full>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {ALL_TYPES.map((t) => {
                  const on = (doc.acceptedTypes || []).includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        const cur = new Set(doc.acceptedTypes || []);
                        if (cur.has(t)) cur.delete(t);
                        else cur.add(t);
                        update({ acceptedTypes: Array.from(cur) });
                      }}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 99,
                        fontSize: 11,
                        fontWeight: 600,
                        border: `1px solid ${on ? adminColors.niumBlue : adminColors.border}`,
                        background: on ? adminColors.niumBlue : "#fff",
                        color: on ? "#fff" : adminColors.text,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {t.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label={null} full>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: adminColors.text }}>
                <input
                  type="checkbox"
                  checked={!!doc.required}
                  onChange={(e) => update({ required: e.target.checked })}
                />
                Required (customer must provide)
              </label>
            </Field>
            <Field label={null} full>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: adminColors.text }}>
                <input
                  type="checkbox"
                  checked={doc.aiExtraction !== false}
                  onChange={(e) => update({ aiExtraction: e.target.checked })}
                />
                AI extracts fields from this document
              </label>
            </Field>
            {doc.aiExtraction !== false && (
              <Field label="Extraction prompt (optional)" full>
                <textarea
                  value={doc.extractionPrompt || ""}
                  placeholder="Extract the following fields from this document: ..."
                  onChange={(e) => update({ extractionPrompt: e.target.value })}
                  style={{ ...adminStyles.input, minHeight: 70, fontSize: 12 }}
                />
              </Field>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
            <button
              type="button"
              onClick={onRemoveFromLibrary}
              style={{
                background: "transparent",
                border: "none",
                color: adminColors.danger,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                padding: 0,
              }}
            >
              Remove from library
            </button>
            <button type="button" onClick={() => setOpen(false)} style={adminStyles.btnSecondary}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, helper, full, children }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : "auto" }}>
      {label && <label style={adminStyles.label}>{label}</label>}
      {children}
      {helper && <div style={adminStyles.helper}>{helper}</div>}
    </div>
  );
}

function acceptLabel(types) {
  if (!types || !types.length) return "Any file";
  return types.map((t) => t.toUpperCase()).join(", ");
}
