import React from "react";
import { adminColors } from "../adminDesign";
import { flagFor } from "../countries";

// EntityType × Licence schema-coverage grid. Each cell shows ✅/⚠/— and the
// field counts when configured. onCellClick fires for any clickable cell
// (configured ones jump to editor; gaps open the add-schema mini-wizard).
export default function MatrixOverview({ config, onCellClick }) {
  const entityTypes = (config?.entityTypes || []).filter((e) => e.active);
  const licences = config?.licences || [];
  const schemas = config?.schemas || {};

  if (!entityTypes.length || !licences.length) {
    return (
      <div style={{ padding: 16, border: `1px dashed ${adminColors.border}`, borderRadius: 10, color: adminColors.textMuted, fontSize: 13 }}>
        Add at least one entity type and one licence to see the schema matrix.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          borderCollapse: "separate",
          borderSpacing: 0,
          width: "100%",
          minWidth: 480,
          background: "#fff",
          borderRadius: 10,
          border: `1px solid ${adminColors.border}`,
          overflow: "hidden",
        }}
      >
        <thead>
          <tr>
            <th style={th}></th>
            {licences.map((lic) => (
              <th key={lic.id} style={th}>
                <div style={{ fontSize: 11, fontWeight: 600, color: adminColors.textMuted }}>
                  {flagFor(lic.jurisdictionCode)} {lic.jurisdictionCode}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: adminColors.text, marginTop: 2 }}>
                  {lic.jurisdictionName}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entityTypes.map((e) => (
            <tr key={e.id}>
              <td style={th}>
                <div style={{ fontSize: 16 }}>{e.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2 }}>{e.label}</div>
              </td>
              {licences.map((lic) => {
                const associated = (e.associatedLicenceIds || []).includes(lic.id);
                const key = `${e.id}:${lic.id}`;
                const cfg = schemas[key];
                const r = cfg?.researchFields?.length || 0;
                const g = cfg?.gapFields?.length || 0;

                let bg = "#F9FAFB";
                let color = adminColors.textMuted;
                let content = "—";
                let sub = "Not associated";

                if (associated) {
                  if (r + g > 0) {
                    bg = adminColors.statusCompleteBg;
                    color = adminColors.statusComplete;
                    content = "✅";
                    sub = `${r}R + ${g}G`;
                  } else {
                    bg = adminColors.statusIncompleteBg;
                    color = adminColors.statusIncomplete;
                    content = "⚠";
                    sub = "No schema";
                  }
                }

                return (
                  <td
                    key={lic.id}
                    onClick={() => associated && onCellClick && onCellClick(key, !!cfg)}
                    style={{
                      ...cellStyle,
                      background: bg,
                      color,
                      cursor: associated ? "pointer" : "default",
                    }}
                  >
                    <div style={{ fontSize: 22, lineHeight: 1 }}>{content}</div>
                    <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600 }}>{sub}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th = {
  padding: "10px 12px",
  background: "#FAFAF7",
  borderBottom: `1px solid ${adminColors.border}`,
  textAlign: "left",
  verticalAlign: "top",
  minWidth: 110,
};

const cellStyle = {
  padding: "16px 12px",
  textAlign: "center",
  borderTop: `1px solid ${adminColors.border}`,
  verticalAlign: "middle",
};
