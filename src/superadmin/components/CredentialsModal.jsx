import React, { useState } from "react";
import { adminColors, adminStyles } from "../../admin/adminDesign";

// Shown after tenant creation OR password reset. Can only be dismissed via
// the explicit "Done" button — clicks outside and Escape are deliberately
// inert so the super-admin acknowledges they've saved the credentials.
export default function CredentialsModal({
  tenantId,
  companyName,
  password,
  adminUrl,
  customerUrl,
  onClose,
  resetMode = false,
}) {
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "yourdomain.com";
  const fullAdminUrl = origin + (adminUrl || `/admin?tenant=${tenantId}`);
  const fullCustomerUrl = origin + (customerUrl || `/?tenant=${tenantId}`);

  const formatted = [
    `Company:      ${companyName || tenantId}`,
    `Tenant ID:    ${tenantId}`,
    ``,
    `Admin URL:    ${fullAdminUrl}`,
    `Password:     ${password}`,
    ``,
    `Customer URL: ${fullCustomerUrl}`,
  ].join("\n");

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (_) {
      window.prompt("Copy these credentials:", formatted);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.7)",
        zIndex: 250,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: 28,
          width: "100%",
          maxWidth: 480,
          boxShadow: "0 24px 70px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, lineHeight: 1, color: adminColors.statusComplete }}>✅</div>
          <h3 style={{ fontSize: 20, fontWeight: 800, margin: "10px 0 4px" }}>
            {resetMode ? "Password reset" : "Tenant created successfully"}
          </h3>
          <p style={{ fontSize: 13, color: adminColors.textMuted, margin: 0 }}>
            Share these credentials with {companyName || tenantId}.
          </p>
        </div>

        <div
          style={{
            marginTop: 14,
            padding: "10px 14px",
            borderRadius: 8,
            background: adminColors.statusIncompleteBg,
            border: `1px solid ${adminColors.amber}`,
            color: adminColors.statusIncomplete,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          ⚠ Save this password now — it cannot be recovered later. You can reset it but not view it again.
        </div>

        <pre
          style={{
            marginTop: 14,
            padding: 14,
            background: "#0F172A",
            color: "#E2E8F0",
            borderRadius: 8,
            fontSize: 12,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: "14px 0 0",
          }}
        >
          {formatted}
        </pre>

        <button
          type="button"
          onClick={copyAll}
          style={{ ...adminStyles.btnPrimary, width: "100%", marginTop: 14 }}
        >
          {copied ? "✅ Copied!" : "Copy all to clipboard"}
        </button>

        <button
          type="button"
          onClick={onClose}
          style={{ ...adminStyles.btnSecondary, width: "100%", marginTop: 8 }}
        >
          Done
        </button>

        <div style={{ fontSize: 11, color: adminColors.textMuted, textAlign: "center", marginTop: 10 }}>
          Click Done to dismiss — this dialog will not close on its own.
        </div>
      </div>
    </div>
  );
}
