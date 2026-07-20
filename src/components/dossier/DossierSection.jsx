import { useState } from "react";
import { isStakeholderField } from "../../pipeline";
import { formatFetchedAt } from "../../utils/files";

// Collapsible dossier field list (pre-boarding Dossier View). A real component
// (not a render-helper) so its collapse useState is hook-safe even when some
// tiers are conditionally rendered. Stakeholder fields are skipped (they have
// their own section). `getLabel` resolves a field id → human label.
export function DossierSection({ title, subtitle, items, bg, borderColor, color, startCollapsed = false, getLabel, fallbackTs }) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  if (!items || items.length === 0) return null;
  const rows = items.filter((it) => !isStakeholderField(it.field || it.fieldId));
  return (
    <div style={{ marginBottom: 16, borderRadius: 10, border: `1px solid ${borderColor}`, overflow: "hidden" }}>
      <div
        onClick={() => setCollapsed((p) => !p)}
        style={{ padding: "12px 16px", background: bg, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none" }}
      >
        <div>
          <span style={{ fontSize: 14, fontWeight: 700, color }}>{title}</span>
          <span style={{ fontSize: 12, color, opacity: 0.7, marginLeft: 8 }}>{subtitle}</span>
        </div>
        <span style={{ fontSize: 14, color, transform: collapsed ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s", display: "inline-block" }}>▾</span>
      </div>
      {!collapsed && (
        <div style={{ padding: "12px 16px" }}>
          {rows.map((item, i) => {
            const fieldId = item.field || item.fieldId;
            const label = item.label || (getLabel ? getLabel(fieldId) : fieldId) || fieldId;
            const displayValue = typeof item.value === "object" ? JSON.stringify(item.value) : String(item.value || "—");
            return (
              <div key={fieldId || i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "8px 0", borderBottom: i < rows.length - 1 ? `1px solid ${borderColor}` : "none" }}>
                <div style={{ width: 200, flexShrink: 0, fontSize: 12, fontWeight: 600, color, opacity: 0.8, lineHeight: 1.4, paddingTop: 1 }}>{label}</div>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "#1a3a4a", lineHeight: 1.5, wordWrap: "break-word", overflowWrap: "break-word" }}>
                  {displayValue.length > 200 ? (
                    <div style={{ fontSize: 12, background: "#fafcfb", borderRadius: 6, padding: "6px 10px", whiteSpace: "pre-wrap", wordWrap: "break-word" }}>{displayValue}</div>
                  ) : displayValue}
                </div>
                {(item.source || item.sourceUrl) && (
                  <div style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, color, opacity: 0.7, maxWidth: 140, textAlign: "right", lineHeight: 1.3 }}>
                    {item.sourceUrl ? (
                      <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color, textDecoration: "none", borderBottom: `1px dotted ${color}` }}>{item.source || "Source"}</a>
                    ) : item.source}
                    {formatFetchedAt(item.fetchedAt || fallbackTs) && (
                      <div style={{ fontSize: 9, fontWeight: 500, opacity: 0.85, marginTop: 2 }} title="When this value was retrieved">🕒 {formatFetchedAt(item.fetchedAt || fallbackTs)}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
