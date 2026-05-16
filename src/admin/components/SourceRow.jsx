import React from "react";
import { adminColors } from "../adminDesign";
import { flagFor } from "../countries";

// One row in the primary/secondary source lists in Step 6. Shows the source's
// pattern and an active toggle; clicking × calls onDelete.
export default function SourceRow({ source, showFlag, onToggleActive, onDelete }) {
  const active = source.active !== false;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 8,
        background: "#fff",
        border: `1px solid ${adminColors.border}`,
        opacity: active ? 1 : 0.55,
      }}
    >
      {showFlag && (
        <span style={{ fontSize: 14 }}>
          {source.jurisdiction ? flagFor(source.jurisdiction) : "🌐"}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: adminColors.text }}>{source.name}</div>
        <div style={{ fontSize: 11, color: adminColors.textMuted, fontFamily: "monospace" }}>
          {source.pattern || "—"}
        </div>
      </div>
      <label
        title={active ? "Active" : "Inactive"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
          color: adminColors.textMuted,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => onToggleActive(e.target.checked)}
        />
        active
      </label>
      <button
        type="button"
        onClick={onDelete}
        title="Delete source"
        style={{
          background: "transparent",
          border: "none",
          padding: "2px 6px",
          color: adminColors.danger,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 14,
        }}
      >
        ×
      </button>
    </div>
  );
}
