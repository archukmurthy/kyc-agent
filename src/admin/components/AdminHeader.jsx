import React from "react";
import { adminColors, adminStyles } from "../adminDesign";

// Sticky top bar shared by the dashboard and standalone admin views.
// Shows tenant brand, save status, and the Preview / Publish / Sign-out
// controls. The wizard renders its own slim top bar instead of this header.
export default function AdminHeader({
  tenantConfig,
  hasUnpublishedChanges,
  canPublish,
  publishing,
  onPublish,
  onPreview,
  onSignOut,
}) {
  const companyName = tenantConfig?.company?.name || "Nium";
  const logo = tenantConfig?.company?.logo;

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        background: "#fff",
        borderBottom: `1px solid ${adminColors.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {logo ? (
          <img
            src={logo}
            alt={companyName}
            style={{ width: 28, height: 28, objectFit: "contain", borderRadius: 6 }}
          />
        ) : (
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: adminColors.niumBlue,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            {companyName[0] || "N"}
          </div>
        )}
        <div style={{ fontSize: 15, fontWeight: 700, color: adminColors.text }}>
          {companyName}
        </div>
        <span style={{ color: adminColors.border }}>|</span>
        <div style={{ fontSize: 12, fontWeight: 600, color: adminColors.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Admin
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <StatusIndicator hasUnpublished={hasUnpublishedChanges} />

        <button type="button" onClick={onPreview} style={adminStyles.btnSecondary}>
          Preview
        </button>

        <button
          type="button"
          onClick={onPublish}
          disabled={!canPublish || !hasUnpublishedChanges || publishing}
          style={{
            ...adminStyles.btnPrimary,
            opacity: !canPublish || !hasUnpublishedChanges || publishing ? 0.5 : 1,
            cursor: !canPublish || !hasUnpublishedChanges || publishing ? "not-allowed" : "pointer",
          }}
          title={
            !hasUnpublishedChanges
              ? "No changes to publish"
              : !canPublish
              ? "Minimum configuration not met"
              : "Publish configuration"
          }
        >
          {publishing ? "Publishing…" : "Publish"}
        </button>

        <span style={{ color: adminColors.border }}>|</span>

        <button
          type="button"
          onClick={onSignOut}
          style={{
            ...adminStyles.btnGhost,
            color: adminColors.textMuted,
            fontSize: 12,
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

function StatusIndicator({ hasUnpublished }) {
  const color = hasUnpublished ? adminColors.amber : adminColors.statusComplete;
  const label = hasUnpublished ? "Unsaved changes" : "Published";
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: adminColors.textMuted }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: color, display: "inline-block" }} />
      {label}
    </div>
  );
}
