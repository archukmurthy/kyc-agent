import React from "react";
import { adminColors } from "../adminDesign";

const TYPE_COLOR = {
  text:     { bg: "#E5E7EB", fg: "#374151" },
  textarea: { bg: "#DBEAFE", fg: "#1E40AF" },
  select:   { bg: "#EDE9FE", fg: "#6D28D9" },
  date:     { bg: "#FFEDD5", fg: "#9A3412" },
  number:   { bg: "#CFFAFE", fg: "#155E75" },
  file:     { bg: "#DCFCE7", fg: "#166534" },
};

export default function SchemaFieldRow({
  field,
  tab,
  onEdit,
  onDelete,
  onMove,
  onToggleAi,
  onMoveTab,
}) {
  const t = field.inputType || "text";
  const colors = TYPE_COLOR[t] || TYPE_COLOR.text;

  return (
    <tr style={{ borderBottom: `1px solid ${adminColors.border}` }}>
      <td style={td}>
        <span title={field.label} style={{ fontWeight: 600 }}>
          {truncate(field.label, 30)}
        </span>
        <div style={{ fontSize: 10, color: adminColors.textMuted, fontFamily: "monospace" }}>
          {field.field}
        </div>
      </td>
      <td style={td}>
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 99,
            fontSize: 10,
            fontWeight: 700,
            background: colors.bg,
            color: colors.fg,
            textTransform: "uppercase",
          }}
        >
          {t}
        </span>
      </td>
      <td style={{ ...td, textAlign: "center" }}>
        <span
          title={field.required ? "Required" : "Optional"}
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: 99,
            background: field.required ? adminColors.danger : adminColors.border,
          }}
        />
      </td>
      {tab === "research" && (
        <td style={{ ...td, textAlign: "center" }}>
          <button
            type="button"
            onClick={onToggleAi}
            title={field.aiSearch !== false ? "AI is searching for this field" : "AI is skipping this field"}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 14,
              color: field.aiSearch !== false ? adminColors.statusComplete : adminColors.textMuted,
            }}
          >
            {field.aiSearch !== false ? "🟢" : "⚪"}
          </button>
        </td>
      )}
      {tab === "research" && (
        <td style={{ ...td, fontSize: 11, color: adminColors.textMuted, maxWidth: 200 }}>
          <span title={field.searchHint || ""}>{truncate(field.searchHint || "—", 40)}</span>
        </td>
      )}
      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
        <button type="button" onClick={onEdit} style={miniBtn} title="Edit">✎</button>
        <button type="button" onClick={() => onMove(-1)} style={miniBtn} title="Move up">↑</button>
        <button type="button" onClick={() => onMove(1)} style={miniBtn} title="Move down">↓</button>
        <button type="button" onClick={onMoveTab} style={miniBtn} title={tab === "research" ? "Move to Gap" : "Move to Research"}>
          ⇄
        </button>
        <button
          type="button"
          onClick={onDelete}
          style={{ ...miniBtn, color: adminColors.danger }}
          title="Delete"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

const td = { padding: "8px 10px", fontSize: 13, color: adminColors.text, verticalAlign: "middle" };

const miniBtn = {
  background: "transparent",
  border: "1px solid transparent",
  padding: "2px 6px",
  borderRadius: 6,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
  color: adminColors.text,
};

function truncate(s, n) {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
