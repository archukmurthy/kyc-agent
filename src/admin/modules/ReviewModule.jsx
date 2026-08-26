import React from "react";
import { card, btnSecondary, sectionTitle, sectionSub, tokens } from "../styles";

function Row({ label, value, onEdit }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "10px 0", borderBottom: "1px solid rgba(26,58,74,0.06)",
    }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: tokens.textMuted, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{value}</div>
      </div>
      {onEdit && <button onClick={onEdit} style={{ background: "transparent", border: "none", color: tokens.brandBlue, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Edit →</button>}
    </div>
  );
}

export default function ReviewModule({ config, goTo, versions }) {
  const lic = config.licences || [];
  const ent = (config.entityTypes || []).filter((e) => e.active);
  const schemaCount = Object.keys(config.schemas || {}).length;
  const primaryCount = (config.sourceTiers?.primary || []).length;
  const secondaryCount = (config.sourceTiers?.secondary || []).length;
  const docsByEntity = config.documents || {};

  return (
    <div>
      <h2 style={sectionTitle}>Review &amp; Publish</h2>
      <p style={sectionSub}>Confirm your configuration, preview the customer flow, then publish.</p>

      <div style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>Summary</h3>
        <Row label="Company" value={`${config.company?.name || "—"} · manual form: ${config.company?.manualFormUrl || "(none)"}`} onEdit={() => goTo("company")} />
        <Row label="Licences" value={`${lic.length} licence${lic.length === 1 ? "" : "s"} · routing: ${config.routingPolicy || "regional"} · primary: ${(lic.find((l) => l.isPrimary) || {}).id || "—"}`} onEdit={() => goTo("licences")} />
        <Row label="Entity types" value={ent.length ? ent.map((e) => `${e.icon || ""} ${e.id}`).join(" · ") : "—"} onEdit={() => goTo("entityTypes")} />
        <Row label="Schemas" value={`${schemaCount} schema combination${schemaCount === 1 ? "" : "s"} configured`} onEdit={() => goTo("schemas")} />
        <Row label="Sources" value={`${primaryCount} primary · ${secondaryCount} secondary · documents-as-primary: ${config.sourceTiers?.documentsArePrimary !== false ? "yes" : "no"}`} onEdit={() => goTo("sources")} />
        <Row
          label="Documents"
          value={Object.entries(docsByEntity).map(([k, v]) => `${k}: ${v.length}`).join(" · ") || "—"}
          onEdit={() => goTo("documents")}
        />
      </div>

      <div style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>Version history</h3>
        <p style={{ fontSize: 11, color: tokens.textMuted, margin: "0 0 12px" }}>Last 5 published versions. Rollback is a future enhancement — currently displays metadata only.</p>
        {versions && versions.length > 0 ? (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 100px", gap: 8, padding: "6px 8px", background: tokens.navy, color: "#fff", borderRadius: "6px 6px 0 0", fontSize: 10, fontWeight: 700 }}>
              <span>VERSION</span>
              <span>PUBLISHED AT</span>
              <span>ACTIONS</span>
            </div>
            {versions.map((v, i) => (
              <div key={v.version} style={{
                display: "grid", gridTemplateColumns: "100px 1fr 100px", gap: 8,
                padding: "8px", alignItems: "center", fontSize: 12,
                background: i % 2 === 0 ? "#fafcfb" : "#fff",
                borderBottom: "1px solid rgba(26,58,74,0.04)",
              }}>
                <span style={{ fontWeight: 700 }}>v{v.version}</span>
                <span style={{ color: "#555" }}>{v.publishedAt || "—"}</span>
                <button
                  style={{ ...btnSecondary, padding: "4px 10px", fontSize: 11, opacity: 0.5, cursor: "not-allowed" }}
                  title="Rollback is a future enhancement — historical versions are archived but the API endpoint to restore them is not yet wired up."
                  disabled
                >Rollback</button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: tokens.textMuted }}>No previous versions yet — this will be the first published version.</div>
        )}
      </div>

      <div style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>Preview before publishing</h3>
        <p style={{ fontSize: 12, color: tokens.textMuted, margin: 0 }}>
          Use the <strong>Preview</strong> button in the top bar to open a new tab with the customer flow loaded against this unpublished configuration. Once you're happy with the preview, click <strong>Publish</strong> to make this version live.
        </p>
      </div>
    </div>
  );
}
