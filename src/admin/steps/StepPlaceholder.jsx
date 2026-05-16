import React from "react";
import WizardCard from "../components/WizardCard";
import { adminColors } from "../adminDesign";

// Read-only placeholder for steps 4-7 (Schemas / Sources / Documents / Publish).
// Reports what would be configured here, derived from the live config, so
// admins can see today what they'll edit when Session B ships.
export default function StepPlaceholder({ stepNumber, stepName, config }) {
  const summary = renderSummary(stepNumber, config);

  return (
    <WizardCard title={stepName} subtitle="Coming in Admin Session B">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 0 24px" }}>
        <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 12 }}>{stepIcon(stepNumber)}</div>
        <p style={{ fontSize: 13, color: adminColors.textMuted, margin: 0, textAlign: "center", maxWidth: 480 }}>
          This step will be wired up in Admin Session B. Until then, here&apos;s a read-only
          summary of what would be configured here, pulled from your live config.
        </p>
      </div>

      <div
        style={{
          background: adminColors.wizardBg,
          border: `1px solid ${adminColors.border}`,
          borderRadius: 10,
          padding: 16,
        }}
      >
        {summary}
      </div>
    </WizardCard>
  );
}

function stepIcon(n) {
  return { 4: "📝", 5: "📄", 6: "🔍", 7: "🚀" }[n] || "🧭";
}

function renderSummary(stepNumber, config) {
  if (!config) {
    return <Muted>No config loaded.</Muted>;
  }

  if (stepNumber === 4) {
    // Schema matrix
    const entityTypes = (config.entityTypes || []).filter((e) => e.active);
    const licences = config.licences || [];
    const rows = [];
    entityTypes.forEach((e) => {
      (e.associatedLicenceIds || licences.map((l) => l.id)).forEach((licId) => {
        const lic = licences.find((l) => l.id === licId);
        const key = `${e.id}:${licId}`;
        const cfg = config.schemas?.[key];
        const fields = (cfg?.researchFields?.length || 0) + (cfg?.gapFields?.length || 0);
        rows.push({
          key,
          label: `${e.label} × ${lic?.jurisdictionName || licId}`,
          ok: fields > 0,
          fields,
        });
      });
    });
    return (
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {rows.map((r) => (
          <li key={r.key} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
            <span>
              <span style={{ marginRight: 8 }}>{r.ok ? "✅" : "⚠"}</span>
              {r.label}
            </span>
            <span style={{ color: adminColors.textMuted }}>{r.ok ? `${r.fields} fields` : "no schema"}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (stepNumber === 5) {
    const entityTypes = (config.entityTypes || []).filter((e) => e.active);
    return (
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {entityTypes.map((e) => {
          const docs = config.documents?.[e.id] || [];
          return (
            <li key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
              <span>
                {e.icon} {e.label}
              </span>
              <span style={{ color: adminColors.textMuted }}>
                {docs.filter((d) => d.active !== false).length} document
                {docs.filter((d) => d.active !== false).length === 1 ? "" : "s"}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  if (stepNumber === 6) {
    const p = config.sourceTiers?.primary?.length || 0;
    const s = config.sourceTiers?.secondary?.length || 0;
    return (
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
        <li>Primary sources: <strong>{p}</strong></li>
        <li>Secondary sources: <strong>{s}</strong></li>
        <li>Uploaded documents treated as primary: <strong>{config.sourceTiers?.documentsArePrimary ? "Yes" : "No"}</strong></li>
      </ul>
    );
  }

  if (stepNumber === 7) {
    const v = config._version || 0;
    const publishedAt = config._publishedAt || config._seededAt;
    return (
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
        <li>Current published version: <strong>v{v}</strong></li>
        <li>Last published: <strong>{publishedAt ? new Date(publishedAt).toLocaleString() : "—"}</strong></li>
        <li>Tenant: <strong>{config._tenantId || "—"}</strong></li>
      </ul>
    );
  }

  return <Muted>No summary available.</Muted>;
}

function Muted({ children }) {
  return <div style={{ fontSize: 13, color: adminColors.textMuted }}>{children}</div>;
}
