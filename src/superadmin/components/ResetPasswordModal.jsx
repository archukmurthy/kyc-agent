import React, { useState } from "react";
import { adminColors, adminStyles } from "../../admin/adminDesign";
import { generatePassword } from "../../utils/auth";

// Compact reset-password flow. On success, the parent shows CredentialsModal
// with the same new-password reveal as the create flow.
export default function ResetPasswordModal({ tenantId, companyName, token, onClose, onSuccess }) {
  const [newPassword, setNewPassword] = useState(() => generatePassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleReset() {
    if (!newPassword.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(
        `/api/tenants?action=reset-password&tenantId=${encodeURIComponent(tenantId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ newPassword }),
        }
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onSuccess({
        tenantId,
        companyName,
        password: newPassword,
        adminUrl: `/admin?tenant=${tenantId}`,
        customerUrl: `/?tenant=${tenantId}`,
        resetMode: true,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: 24,
          width: "100%",
          maxWidth: 400,
          boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Reset Password</h3>
        <p style={{ fontSize: 13, color: adminColors.textMuted, marginTop: 6 }}>
          Reset admin password for {companyName || tenantId}{" "}
          <span style={{ fontFamily: "monospace", fontSize: 12 }}>({tenantId})</span>
        </p>

        <div style={{ marginTop: 14 }}>
          <label style={adminStyles.label}>New password</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={{ ...adminStyles.input, fontFamily: "monospace" }}
            />
            <button type="button" onClick={() => setNewPassword(generatePassword())} style={adminStyles.btnSecondary}>
              Generate new ↻
            </button>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: adminColors.danger, fontSize: 12, fontWeight: 600 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={!newPassword.trim() || busy}
            style={{ ...adminStyles.btnPrimary, opacity: !newPassword.trim() || busy ? 0.5 : 1 }}
          >
            {busy ? "Resetting…" : "Reset Password"}
          </button>
        </div>
      </div>
    </div>
  );
}
