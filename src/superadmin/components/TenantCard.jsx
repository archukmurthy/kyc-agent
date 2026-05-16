import React, { useState } from "react";
import { adminColors, adminStyles } from "../../admin/adminDesign";

// One tenant tile in the super-admin dashboard. Nium is rendered with a
// niumBlue left rail and an "Internal" badge; nothing else is special-cased
// beyond hiding the deactivate button (Nium can never be turned off).
export default function TenantCard({ tenant, onResetPassword, onToggleStatus }) {
  const isNium = tenant.tenantId === "nium" || tenant.isInternal;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const adminUrl =
    isNium ? "/admin" : `/admin?tenant=${tenant.tenantId}`;
  const customerUrl =
    isNium ? "/" : `/?tenant=${tenant.tenantId}`;

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 12,
        border: `1px solid ${adminColors.border}`,
        borderLeft: isNium ? `4px solid ${adminColors.niumBlue}` : `1px solid ${adminColors.border}`,
        padding: 18,
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20 }}>🏢</span>
            <div style={{ fontSize: 16, fontWeight: 800, color: adminColors.text }}>
              {tenant.companyName || tenant.tenantId}
              {isNium && (
                <span style={{ fontWeight: 500, color: adminColors.textMuted, marginLeft: 6 }}>
                  (Platform Tenant)
                </span>
              )}
            </div>
            <StatusBadge isInternal={isNium} isActive={tenant.isActive !== false} isBlank={!!tenant.isBlank} />
          </div>
          <div style={{ fontSize: 11, color: adminColors.textMuted, marginTop: 4, fontFamily: "monospace" }}>
            tenant ID: {tenant.tenantId}
          </div>

          <div style={{ display: "flex", gap: 18, marginTop: 10, flexWrap: "wrap", fontSize: 12, color: adminColors.textMuted }}>
            <span>
              Created: <strong style={{ color: adminColors.text }}>{tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : "—"}</strong>
            </span>
            <span>
              Last published: <strong style={{ color: adminColors.text }}>
                {tenant.lastPublishedAt ? new Date(tenant.lastPublishedAt).toLocaleDateString() : "Never"}
              </strong>
            </span>
          </div>

          <UrlRow label="Admin URL" value={origin + adminUrl} />
          <UrlRow label="Customer URL" value={origin + customerUrl} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => window.open(adminUrl, "_blank")}
          style={adminStyles.btnSecondary}
        >
          Open Admin ↗
        </button>
        <button
          type="button"
          onClick={() => window.open(customerUrl, "_blank")}
          style={adminStyles.btnSecondary}
        >
          Open Flow ↗
        </button>
        <button
          type="button"
          onClick={() => onResetPassword(tenant)}
          style={adminStyles.btnGhost}
        >
          Reset Password
        </button>
        {!isNium && (
          <button
            type="button"
            onClick={() => onToggleStatus(tenant)}
            style={{
              ...adminStyles.btnGhost,
              color: tenant.isActive === false ? adminColors.statusComplete : adminColors.danger,
            }}
          >
            {tenant.isActive === false ? "Reactivate" : "Deactivate"}
          </button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ isInternal, isActive, isBlank }) {
  if (isInternal) {
    return <span style={{ ...adminStyles.statusBadge("complete"), background: "rgba(11,61,145,0.1)", color: adminColors.niumBlue }}>INTERNAL</span>;
  }
  if (isBlank) {
    return <span style={adminStyles.statusBadge("incomplete")}>⚠ Setup pending</span>;
  }
  if (isActive === false) {
    return (
      <span style={{ ...adminStyles.statusBadge("incomplete"), background: "#fef2f2", color: adminColors.danger }}>
        ⏸ Inactive
      </span>
    );
  }
  return <span style={adminStyles.statusBadge("complete")}>✅ Active</span>;
}

function UrlRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {
      // Fallback: open prompt
      // eslint-disable-next-line no-alert
      window.prompt("Copy this URL:", value);
    }
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: adminColors.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
        <code
          style={{
            flex: 1,
            minWidth: 0,
            padding: "6px 10px",
            background: adminColors.wizardBg,
            border: `1px solid ${adminColors.border}`,
            borderRadius: 6,
            fontSize: 12,
            color: adminColors.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          style={{ ...adminStyles.btnGhost, fontSize: 11, padding: "4px 10px" }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}
