import React, { useMemo, useState } from "react";
import WizardCard from "../components/WizardCard";
import MatrixOverview from "../components/MatrixOverview";
import VersionHistory from "../components/VersionHistory";
import { getTenantId } from "../../utils/tenant";
import { adminColors, adminStyles } from "../adminDesign";
import { flagFor } from "../countries";

// Step 7 — Review & Publish.
// Computes readiness, surfaces gaps, renders the matrix + version history,
// and runs the publish itself (POST /api/config with the admin token).

function computeReadiness(config) {
  const entityTypes = (config?.entityTypes || []).filter((e) => e.active);
  const licences = config?.licences || [];

  const activeCells = [];
  entityTypes.forEach((et) => {
    (et.associatedLicenceIds || []).forEach((lid) => activeCells.push(`${et.id}:${lid}`));
  });
  const configuredCells = activeCells.filter((c) => {
    const s = config?.schemas?.[c];
    return s && ((s.researchFields?.length || 0) + (s.gapFields?.length || 0)) > 0;
  });

  return {
    company: !!config?.company?.name,
    licences: licences.length > 0,
    entityTypes: entityTypes.length > 0,
    schemasComplete: activeCells.length > 0 && configuredCells.length === activeCells.length,
    schemaCells: activeCells,
    configuredCells,
    missingCells: activeCells.filter((c) => !configuredCells.includes(c)),
    hasAtLeastOneSchema: Object.keys(config?.schemas || {}).length > 0,
    documentsConfigured: entityTypes.length > 0 && entityTypes.every((e) => (config?.documents?.[e.id] || []).length > 0),
    sourcesConfigured: (config?.sourceTiers?.primary || []).length > 0,
  };
}

export default function StepPublish({
  config,
  onChange,
  adminToken,
  tenantId,
  onPublishSuccess,
  isStandalone = false,
}) {
  const readiness = useMemo(() => computeReadiness(config), [config]);
  const [publishing, setPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState(null);
  const [publishError, setPublishError] = useState(null);

  const activeTenant = tenantId || getTenantId();
  const canPublish =
    readiness.licences && readiness.entityTypes && readiness.hasAtLeastOneSchema;

  async function handlePublish() {
    if (!canPublish || !adminToken) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const r = await fetch(`/api/config?tenant=${encodeURIComponent(activeTenant)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}`, "X-Tenant-Id": activeTenant },
        body: JSON.stringify(config),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      // Clear staged preview — same config is now live, so an open preview tab
      // refreshing should fetch the published version, not the pre-publish snapshot.
      try {
        sessionStorage.removeItem("preview_config");
        sessionStorage.removeItem("preview_tenant_id");
        sessionStorage.removeItem("preview_timestamp");
      } catch (_) { /* ignore */ }
      setPublishSuccess(true);
      setPublishedVersion(data.version);
      if (onPublishSuccess) onPublishSuccess(data.version);
    } catch (err) {
      setPublishError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  function handlePreview() {
    if (!config) return;
    try {
      sessionStorage.setItem("preview_config", JSON.stringify(config));
      sessionStorage.setItem("preview_tenant_id", activeTenant || "demo");
      sessionStorage.setItem("preview_timestamp", new Date().toISOString());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Could not write preview config:", e);
    }
    const tenantParam = activeTenant && activeTenant !== "demo"
      ? `&tenant=${encodeURIComponent(activeTenant)}`
      : "";
    window.open(`/?preview=true${tenantParam}`, "_blank");
  }

  if (publishSuccess) {
    return (
      <WizardCard>
        <div style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 12 }}>✅</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
            Version {publishedVersion} published successfully
          </h2>
          <p style={{ fontSize: 14, color: adminColors.textMuted, marginTop: 8 }}>
            Your onboarding flow is now live.
          </p>
          <button
            type="button"
            onClick={() => window.open("/", "_blank")}
            style={{ ...adminStyles.btnSecondary, marginTop: 16 }}
          >
            View live flow →
          </button>
        </div>
      </WizardCard>
    );
  }

  return (
    <WizardCard
      title="Review & Publish"
      subtitle="Review your configuration and publish it to make it live."
    >
      <SectionHeading>Readiness</SectionHeading>
      <ReadinessChecklist readiness={readiness} config={config} />

      <SectionHeading style={{ marginTop: 22 }}>Configuration Matrix</SectionHeading>
      <MatrixOverview config={config} onCellClick={() => { /* navigation handled by wizard */ }} />

      <SectionHeading style={{ marginTop: 22 }}>Publish</SectionHeading>
      <div style={{
        padding: 16,
        background: "#F0F9FF",
        borderRadius: 8,
        border: "1px solid #BAE6FD",
        marginBottom: 16,
      }}>
        <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 6px", color: "#0369A1" }}>
          Before you publish
        </p>
        <p style={{ fontSize: 13, color: "#0369A1", margin: "0 0 12px" }}>
          Preview your current configuration in the customer flow before making it live.
          Submissions are disabled in preview mode.
        </p>
        <button
          type="button"
          onClick={handlePreview}
          disabled={!config}
          title="Opens a new tab with your current unsaved changes. Click Refresh in the preview tab to re-stage after further edits."
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "9px 18px",
            background: "#0369A1",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: config ? "pointer" : "not-allowed",
            opacity: config ? 1 : 0.5,
            fontFamily: "inherit",
          }}
        >
          👁 Preview current changes ↗
        </button>
      </div>
      {canPublish ? (
        <div style={{ background: "#fff", border: `1px solid ${adminColors.border}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, marginBottom: 12, color: adminColors.text, lineHeight: 1.55 }}>
            You are about to publish:
            <ul style={{ margin: "6px 0 0 18px" }}>
              <li>
                {(config?.licences || []).length} licence{(config?.licences || []).length === 1 ? "" : "s"} —{" "}
                {(config?.licences || []).map((l) => `${flagFor(l.jurisdictionCode)} ${l.jurisdictionCode}`).join(" · ")}
              </li>
              <li>
                {(config?.entityTypes || []).filter((e) => e.active).length} entity type
                {(config?.entityTypes || []).filter((e) => e.active).length === 1 ? "" : "s"}
              </li>
              <li>{readiness.configuredCells.length} of {readiness.schemaCells.length} schema combinations configured</li>
              <li>
                {Object.values(config?.documents || {}).reduce((sum, arr) => sum + (arr?.length || 0), 0)} document slots across entity types
              </li>
            </ul>
          </div>
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing}
            style={{
              ...adminStyles.btnPrimary,
              width: "100%",
              padding: "14px 18px",
              fontSize: 14,
              opacity: publishing ? 0.6 : 1,
            }}
          >
            {publishing ? "Publishing…" : "Publish Configuration"}
          </button>
          {publishError && (
            <div style={{ marginTop: 10, padding: 10, background: "#fef2f2", color: adminColors.danger, fontSize: 12, borderRadius: 6 }}>
              {publishError}
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: adminColors.statusIncompleteBg, border: `1px solid ${adminColors.amber}`, borderRadius: 10, padding: 16 }}>
          <button
            type="button"
            disabled
            style={{
              ...adminStyles.btnPrimary,
              width: "100%",
              padding: "14px 18px",
              fontSize: 14,
              opacity: 0.4,
              cursor: "not-allowed",
            }}
          >
            Publish Configuration
          </button>
          <div style={{ marginTop: 10, fontSize: 12, color: adminColors.statusIncomplete }}>
            Before you can publish:
            <ul style={{ margin: "4px 0 0 18px" }}>
              {!readiness.licences && <li>Add at least one licence (Step 2)</li>}
              {!readiness.entityTypes && <li>Add at least one active entity type (Step 3)</li>}
              {!readiness.hasAtLeastOneSchema && <li>Configure at least one schema (Step 4)</li>}
            </ul>
          </div>
        </div>
      )}

      <div style={{ marginTop: 22 }}>
        <VersionHistory
          token={adminToken}
          tenantId={activeTenant}
          currentVersion={config?._version}
          onRolledBack={(v) => {
            // Refresh the parent's config so it reflects the rolled-back state.
            // The wizard listens for config changes via onChange; we hint with
            // a no-op patch that bumps a tracker key, so the dashboard re-loads
            // on its next mount.
            if (onChange) onChange({ _rolledBackAt: new Date().toISOString() });
            if (onPublishSuccess) onPublishSuccess(v);
          }}
        />
      </div>
    </WizardCard>
  );
}

function SectionHeading({ children, style }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: adminColors.textMuted, marginBottom: 10, ...style }}>
      {children}
    </div>
  );
}

function ReadinessChecklist({ readiness, config }) {
  const items = [
    readiness.company
      ? { tone: "ok", text: `Company setup — ${config?.company?.name}` }
      : { tone: "warn", text: "Company name not set (optional)" },
    readiness.licences
      ? { tone: "ok", text: `Licences — ${(config?.licences || []).length} configured` }
      : { tone: "warn", text: "No licences configured" },
    readiness.entityTypes
      ? { tone: "ok", text: `Entity types — ${(config?.entityTypes || []).filter((e) => e.active).length} active` }
      : { tone: "warn", text: "No entity types configured" },
    readiness.schemasComplete
      ? { tone: "ok", text: `All schemas configured (${readiness.configuredCells.length} of ${readiness.schemaCells.length} cells)` }
      : { tone: "warn", text: `${readiness.missingCells.length} schema${readiness.missingCells.length === 1 ? "" : "s"} missing` + (readiness.missingCells.length ? ": " + readiness.missingCells.slice(0, 4).join(", ") + (readiness.missingCells.length > 4 ? "…" : "") : "") },
    readiness.documentsConfigured
      ? { tone: "ok", text: "Documents configured for all active entity types" }
      : { tone: "neutral", text: "Using default document list (ok)" },
    readiness.sourcesConfigured
      ? { tone: "ok", text: "Sources configured" }
      : { tone: "neutral", text: "Using default sources (ok)" },
  ];

  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((it, i) => (
        <li
          key={i}
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            fontSize: 13,
            color: it.tone === "warn" ? adminColors.statusIncomplete : adminColors.text,
          }}
        >
          <span style={{ fontSize: 14 }}>
            {it.tone === "ok" ? "✅" : it.tone === "warn" ? "⚠" : "⚪"}
          </span>
          <span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}
